import { Annotation, Command, END, START, StateGraph } from "@langchain/langgraph";
import type { Runtime } from "@langchain/langgraph";
import { runRAGPipeline } from "@/lib/rag/pipeline";
import { createLLMProvider } from "@/lib/providers/llm.provider";
import { emptyEntities, memoryContext, parseMemory, recentTurns, type SessionEntities } from "@/lib/chat/memory";
import { SHOP_VIEW_GUIDE, runShopSelect } from "@/lib/chat/shopQuery";
import { mergeDocumentEvidence } from "@/lib/chat/evidence";
import { ASK_USE_CASES, fallbackTasks, isSmallTalk, parsePlan, smallTalkReply, type AskTask } from "@/lib/chat/usecases";
import {
  createChatTicket,
  getChatSession,
  insertChatMessage,
  listChatMessages,
  renameChatSession,
  sessionTitleFromQuestion,
  setPendingClarification,
  setSessionMemory,
} from "@/lib/chat/sessions";
import type { Citation } from "@/lib/types";

/** Voyage rerank scores below this are treated as a miss, not an answer. */
export const DOCUMENT_HIT_SCORE = 0.7;
export const MAX_REWRITES = 2;

export interface AskStreamEvent {
  type: "session" | "status" | "enhanced" | "attempt" | "citations" | "token" | "done" | "error";
  sessionId?: string;
  title?: string;
  question?: string;
  citations?: Citation[];
  text?: string;
  message?: string;
  score?: number;
  rewriteCount?: number;
}

type FailureReason = "" | "empty" | "error";
type TaskStatus = "ok" | "empty" | "error";

interface TaskResult {
  intent: AskTask["intent"];
  question: string;
  status: TaskStatus;
  rows: Record<string, unknown>[];
  contextText: string;
  citations: Citation[];
  errorMessage: string;
  rewrites: string[];
  /** Working notes from the reasoning pass on a conversational question. */
  notes: string;
}
type AskOutcome = "answer" | "clarify" | "fallback_empty" | "fallback_error";
export type AskStep = "compose_answer" | "rewrite" | "ask_clarify" | "fallback";

interface Turn {
  role: "user" | "assistant";
  content: string;
}

const AskState = Annotation.Root({
  sessionId: Annotation<string>,
  title: Annotation<string>,
  question: Annotation<string>,
  prior: Annotation<Turn[]>({ reducer: (_left, right) => right, default: () => [] }),
  enhancedQuestion: Annotation<string>({ reducer: (_left, right) => right, default: () => "" }),
  rewrites: Annotation<string[]>({ reducer: (_left, right) => right, default: () => [] }),
  rewriteCount: Annotation<number>({ reducer: (_left, right) => right, default: () => 0 }),
  clarificationAttempt: Annotation<boolean>({ reducer: (_left, right) => right, default: () => false }),
  contextText: Annotation<string>({ reducer: (_left, right) => right, default: () => "" }),
  citations: Annotation<Citation[]>({ reducer: (_left, right) => right, default: () => [] }),
  failureReason: Annotation<FailureReason>({ reducer: (_left, right) => right, default: () => "" }),
  errorMessage: Annotation<string>({ reducer: (_left, right) => right, default: () => "" }),
  outcome: Annotation<AskOutcome>({ reducer: (_left, right) => right, default: () => "answer" }),
  answer: Annotation<string>({ reducer: (_left, right) => right, default: () => "" }),
  tasks: Annotation<AskTask[]>({ reducer: (_left, right) => right, default: () => [] }),
  taskResults: Annotation<TaskResult[]>({ reducer: (_left, right) => right, default: () => [] }),
  summary: Annotation<string>({ reducer: (_left, right) => right, default: () => "" }),
  entities: Annotation<SessionEntities>({ reducer: (_left, right) => right, default: () => emptyEntities() }),
});

type AskUpdate = Partial<typeof AskState.State>;
type AskRuntime = Runtime<unknown, unknown, (event: AskStreamEvent) => void>;

export function normalizeEnhancedQuestion(raw: string, original: string): string {
  const line = raw
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part.length > 0)
    ?.replace(/^rewritten question:\s*/i, "")
    .replace(/^["']|["']$/g, "")
    .trim();
  return line || original;
}

export function decideNextStep(state: {
  failureReason: FailureReason;
  clarificationAttempt: boolean;
  rewriteCount: number;
}): AskStep {
  if (state.failureReason === "") return "compose_answer";
  if (state.clarificationAttempt) return "fallback";
  if (state.rewriteCount < MAX_REWRITES) return "rewrite";
  if (state.failureReason === "error") return "fallback";
  return "ask_clarify";
}

export function decideAfterTasks(state: {
  taskResults: { status: TaskStatus }[];
  clarificationAttempt: boolean;
}): "compose_answer" | "ask_clarify" | "fallback" {
  if (state.taskResults.length === 0) return "fallback";
  const empties = state.taskResults.some((task) => task.status === "empty");
  const errors = state.taskResults.some((task) => task.status === "error");
  const answered = state.taskResults.some((task) => task.status === "ok");
  if (empties && !state.clarificationAttempt) return "ask_clarify";
  if (empties || (errors && !answered)) return "fallback";
  return "compose_answer";
}

export function clarificationMessage(enhancedQuestion: string): string {
  return `I could not find this in the records. I searched for: "${enhancedQuestion}". Reply with the corrected part, drawing, or question and I will try once more.`;
}

export function missingRecordMessage(enhancedQuestion: string): string {
  return `This is not in the records. I searched for: "${enhancedQuestion}". If this should be there, reach an admin.`;
}

export function ticketMessage(ticketId: string): string {
  return `I could not complete this. Ticket ${ticketId} has been raised. Please reach an admin.`;
}

const OPEN_TAG = "<private_reasoning>";
const CLOSE_TAG = "</private_reasoning>";

/** Streaming filter that drops any private reasoning block the model echoes. */
export function createReasoningFilter() {
  let buffer = "";
  let hidden = false;
  let started = false;
  const drain = (final: boolean): string => {
    let out = "";
    for (;;) {
      if (hidden) {
        const end = buffer.indexOf(CLOSE_TAG);
        if (end < 0) {
          if (final) buffer = "";
          else buffer = buffer.slice(-(CLOSE_TAG.length - 1));
          return out;
        }
        buffer = buffer.slice(end + CLOSE_TAG.length).replace(/^\s+/, "");
        hidden = false;
        continue;
      }
      const open = buffer.indexOf(OPEN_TAG);
      if (open >= 0) {
        out += buffer.slice(0, open);
        buffer = buffer.slice(open + OPEN_TAG.length);
        hidden = true;
        continue;
      }
      if (final) {
        out += buffer;
        buffer = "";
        return out;
      }
      let keep = 0;
      for (let n = Math.min(OPEN_TAG.length - 1, buffer.length); n > 0; n--) {
        if (OPEN_TAG.startsWith(buffer.slice(-n))) { keep = n; break; }
      }
      out += buffer.slice(0, buffer.length - keep);
      buffer = buffer.slice(buffer.length - keep);
      return out;
    }
  };
  return {
    push(token: string) {
      buffer += token;
      const out = drain(false);
      if (!started && out) started = true;
      return out;
    },
    flush() {
      return drain(true);
    },
  };
}

function emitText(runtime: AskRuntime, text: string) {
  runtime.writer({ type: "token", text });
}

async function loadSession(state: typeof AskState.State): Promise<AskUpdate> {
  const [messages, session] = await Promise.all([
    listChatMessages(state.sessionId),
    getChatSession(state.sessionId),
  ]);
  const pending = session?.pendingClarification;
  return {
    prior: messages.map((message) => ({ role: message.role, content: message.content })),
    clarificationAttempt: Boolean(pending),
    rewrites: pending?.rewrites ?? [],
    summary: session?.summary ?? "",
    entities: session?.entities ?? emptyEntities(),
  };
}

async function saveUser(state: typeof AskState.State, runtime: AskRuntime): Promise<AskUpdate> {
  await insertChatMessage({ sessionId: state.sessionId, role: "user", content: state.question });
  let title = state.title;
  if (state.prior.length === 0) {
    title = sessionTitleFromQuestion(state.question);
    await renameChatSession(state.sessionId, title);
  }
  runtime.writer({ type: "session", sessionId: state.sessionId, title });
  runtime.writer({ type: "status", message: "Understanding your question" });
  return { title };
}

function isRateLimit(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /rate limit|reduced rate limits|429/i.test(message);
}

function shopClock(now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
  const [year, month, day] = today.split("-").map(Number);
  const monthStart = `${month === 1 ? year - 1 : year}-${String(month === 1 ? 12 : month - 1).padStart(2, "0")}-01`;
  const thisMonth = `${year}-${String(month).padStart(2, "0")}-01`;
  const week = new Date(Date.UTC(year, month - 1, day));
  week.setUTCDate(week.getUTCDate() - 6);
  return { today, monthStart, thisMonth, weekStart: week.toISOString().slice(0, 10) };
}

async function classify(state: typeof AskState.State, runtime: AskRuntime): Promise<AskUpdate> {
  const clock = shopClock();
  const examples = ASK_USE_CASES.map((useCase) => `${useCase.id} (${useCase.intent}): ${useCase.example}`).join("\n");
  let tasks = fallbackTasks(state.question);
  // A greeting or thanks needs no model call to route and no record search.
  if (isSmallTalk(state.question)) {
    const only: AskTask[] = [{ intent: "chat", question: state.question }];
    runtime.writer({ type: "enhanced", question: "chat" });
    return { tasks: only, enhancedQuestion: state.question };
  }
  try {
    const llm = createLLMProvider();
    const raw = await llm.chat({
      systemPrompt: `You are the intent classifier for a manufacturing assistant. Split the latest user message into separate questions. Classify each as "shop", "document" or "chat".
Shop questions are about routers, machines, operators, quantities, hours, scrap, rework, shipments, and where pieces sit by stage (stores, an operation, outside process, finished goods, or shipped). Document questions are about uploaded drawings and their notes.
Chat covers everything that needs no record lookup: greetings, thanks, questions about the assistant, follow-ups that ask to explain or rephrase an earlier answer, opinions, and general manufacturing or engineering knowledge such as how a process works or how to choose a tool. When unsure between chat and a lookup, choose the lookup only if the message names a router, part, machine, operator, drawing or date.
A message with two questions must become two tasks. Resolve pronouns from the conversation.
Today is ${clock.today}. Last month is ${clock.monthStart} up to ${clock.thisMonth}. Last week starts ${clock.weekStart}.
Use cases:
${examples}
Return only JSON: {"tasks":[{"intent":"shop","question":"..."}]}`,
      messages: [
        {
          role: "user",
          content: `${memoryContext(state)}\n\nLatest message:\n${state.question}`,
        },
      ],
    });
    const parsed = parsePlan(raw, state.question);
    if (parsed.length > 0) tasks = parsed;
  } catch (err) {
    console.error("[ask-graph] classify failed", err);
  }
  runtime.writer({
    type: "enhanced",
    question: tasks.map((task) => `${task.intent}: ${task.question}`).join(" | "),
  });
  return { tasks, enhancedQuestion: tasks.map((task) => task.question).join(" | ") };
}

async function runOneTask(
  task: AskTask,
  state: typeof AskState.State,
  runtime: AskRuntime
): Promise<TaskResult> {
  let question = task.question;
  const rewrites: string[] = [];
  let rewriteCount = 0;
  let status: TaskStatus = "empty";
  let rows: Record<string, unknown>[] = [];
  let contextText = "";
  let citations: Citation[] = [];
  let errorMessage = "";

  if (task.intent === "chat") {
    runtime.writer({ type: "status", message: isSmallTalk(task.question) ? "Replying" : "Reasoning through your question" });
    const notes = isSmallTalk(task.question) ? "" : await reasonAbout(task.question, state);
    return { intent: "chat", question: task.question, status: "ok", rows: [], contextText: "", citations: [], errorMessage: "", rewrites: [], notes };
  }
  runtime.writer({ type: "status", message: task.intent === "shop" ? "Checking shop records" : "Searching your documents" });

  while (true) {
    try {
      if (task.intent === "shop") {
        rows = await runShopSelect(await shopSql(question, errorMessage));
        contextText = "";
        citations = [];
        status = rows.length > 0 ? "ok" : "empty";
        errorMessage = "";
      } else {
        const retrieved = await searchDocuments(question);
        const hit = retrieved.contextText.trim().length > 0 && retrieved.topScore >= DOCUMENT_HIT_SCORE;
        rows = [];
        contextText = hit ? retrieved.contextText : "";
        citations = hit ? retrieved.citations : [];
        status = hit ? "ok" : "empty";
        errorMessage = "";
        runtime.writer({ type: "attempt", question, score: retrieved.topScore, rewriteCount });
      }
    } catch (err) {
      status = "error";
      rows = [];
      errorMessage = err instanceof Error ? err.message : "Search failed";
      runtime.writer({ type: "attempt", question, rewriteCount, message: errorMessage });
    }

    const step = decideNextStep({
      failureReason: status === "ok" ? "" : status,
      clarificationAttempt: state.clarificationAttempt,
      rewriteCount,
    });
    if (step !== "rewrite") break;
    question = await rewriteQuestion(question, task.intent, errorMessage);
    rewrites.push(question);
    rewriteCount += 1;
    runtime.writer({ type: "enhanced", question });
  }

  return { intent: task.intent, question, status, rows, contextText, citations, errorMessage, rewrites, notes: "" };
}

/**
 * A short thinking pass before a conversational answer. It pins down what is really being asked,
 * what the conversation already established, and how to answer, so the reply is reasoned and not a reflex.
 */
async function reasonAbout(question: string, state: typeof AskState.State): Promise<string> {
  try {
    const llm = createLLMProvider();
    const raw = await llm.chat({
      systemPrompt: `You are the reasoning step of a manufacturing assistant. Do not answer the user. Write working notes in at most 120 words:
1. What the user is really asking, with any pronoun or "that" resolved from the conversation.
2. Facts from the conversation or remembered entities that matter.
3. What general engineering knowledge applies, and any assumption that must be stated.
4. The best way to answer: how long, what order, whether to ask one clarifying question.
Never invent shop figures, part data or drawing details.`,
      messages: [{ role: "user", content: `${memoryContext(state)}\n\nQuestion:\n${question}` }],
    });
    return raw.trim().slice(0, 1200);
  } catch (err) {
    console.error("[ask-graph] reasoning failed", err);
    return "";
  }
}

async function shopSql(question: string, previousError: string): Promise<string> {
  const clock = shopClock();
  const llm = createLLMProvider();
  return llm.chat({
    systemPrompt: `Write one PostgreSQL SELECT for the question. Read only these views:
${SHOP_VIEW_GUIDE}
Today is ${clock.today}. Last month is ${clock.monthStart} inclusive to ${clock.thisMonth} exclusive. Last week starts ${clock.weekStart}.
Use ILIKE for names. is_running is boolean. Questions about when a job shipped must filter shipped_on, not released_on or due_on. A reject is a shop_v_quality row with result = 'reject'. Where pieces sit now is shop_v_stages with is_current true. Do not add passed stages into that count. Return only the SQL. No comments and no semicolon.`,
    messages: [
      {
        role: "user",
        content: previousError ? `Question:\n${question}\n\nThe previous SQL failed:\n${previousError}` : question,
      },
    ],
  });
}

async function searchDocuments(query: string) {
  try {
    return await runRAGPipeline(query);
  } catch (err) {
    if (!isRateLimit(err)) throw err;
    await new Promise((resolve) => setTimeout(resolve, 21000));
    return runRAGPipeline(query);
  }
}

async function rewriteQuestion(question: string, intent: AskTask["intent"], errorMessage: string): Promise<string> {
  try {
    const llm = createLLMProvider();
    const raw = await llm.chat({
      systemPrompt:
        intent === "shop"
          ? "Rewrite the shop-floor question so it names the router, part, machine, operator, or date more clearly. Return only the question."
          : "Rewrite the question so a document index is more likely to match the same fact. Return only the question.",
      messages: [{ role: "user", content: `Question:\n${question}\n\nProblem:\n${errorMessage || "No matching records."}` }],
    });
    return normalizeEnhancedQuestion(raw, question);
  } catch (err) {
    console.error("[ask-graph] rewrite failed", err);
    return question;
  }
}

async function orchestrate(state: typeof AskState.State, runtime: AskRuntime): Promise<AskUpdate> {
  const tasks = state.tasks.length > 0 ? state.tasks : fallbackTasks(state.question);
  const taskResults: TaskResult[] = [];
  for (const task of tasks) {
    taskResults.push(await runOneTask(task, state, runtime));
  }
  // Two document questions number their excerpts separately and often return the same page, so merge them into one list of sources.
  const documentTasks = taskResults.filter((task) => task.intent === "document");
  const merged = mergeDocumentEvidence(documentTasks.map((task) => ({ citations: task.citations, contextText: task.contextText })));
  documentTasks.forEach((task, index) => {
    task.contextText = merged.contexts[index];
  });
  const citations = merged.citations;
  const failureReason: FailureReason = taskResults.some((task) => task.status === "error")
    ? "error"
    : taskResults.some((task) => task.status === "empty")
      ? "empty"
      : "";
  return {
    taskResults,
    citations,
    failureReason,
    errorMessage: taskResults.filter((task) => task.status === "error").map((task) => task.errorMessage).join("; "),
    rewrites: taskResults.flatMap((task) => task.rewrites),
    contextText: taskResults.map((task) => task.contextText).filter(Boolean).join("\n\n"),
  };
}

function evidenceText(results: TaskResult[]): string {
  return results
    .filter((task) => task.status === "ok" && task.intent !== "chat")
    .map((task, index) =>
      task.intent === "shop"
        ? `Question ${index + 1}: ${task.question}\nShop rows:\n${JSON.stringify(task.rows).slice(0, 12000)}`
        : `Question ${index + 1}: ${task.question}\nDocuments:\n${task.contextText}`
    )
    .join("\n\n");
}

const ANSWER_RULES = `Answer every question in the user message, in the same order. Use a short heading for each.
Shop numbers, hours, names, and statuses must come only from the shop rows. When actual hours are higher than standard hours, state the difference and the quality reason in those rows. Do not invent a cause that is not written there.
Document facts must come only from the document excerpts. Cite them as [1], [2].
If a question has no rows and no excerpts, say that part is not in the records.
Close with a Summary of the figures in a few lines.
Close every answer with a Summary.
Add a Recommendation when the rows show any issue, not only long hours. An issue is any of these: scrap, reject, rework, hold, hours above standard, a late or missed shipment, an open job past its due date, or a quality reason. One or two lines must name that issue and the next check. Do not suggest tooling, programs, or inspections that are not written in the rows.
If the rows show no issue, stop after the Summary and do not add a Recommendation.`;

const PERSONA = `You are the Manufacturing AI Assistant for a factory. You talk like a knowledgeable, friendly colleague: natural, direct, and never robotic.
How you reason:
- Work out what the person really wants, using the conversation and remembered details. Resolve "it", "that", and "the same one".
- Think the problem through before you answer. Give the conclusion first, then the reasons that matter.
- Match the length to the question. A greeting gets one or two warm sentences. A technical question gets a clear, structured answer.
- Separate what you know from the records from general engineering knowledge. Label general knowledge as such ("In general, ...") and say so when you are unsure.
- Never invent shop figures, part numbers, tolerances, or drawing details. If the records do not hold something, say so plainly and suggest what to ask or upload.
- Do not list sources at the end of your answer. The page already shows them.`;

export function composePrompt(evidence: string, chatTasks: { question: string; notes: string }[]): string {
  const parts = [PERSONA];
  if (evidence) {
    parts.push(`${ANSWER_RULES}\n\nUse only the records below for shop numbers and document facts.\n\n--- RECORDS ---\n${evidence}\n--- END RECORDS ---`);
    if (chatTasks.length > 0) parts.push("The message also has conversational or general parts. Answer those naturally and briefly in their place, without a Summary of their own.");
  } else if (chatTasks.length === 0) {
    parts.push("No records were found for this question. Say so briefly.");
  }
  const noted = chatTasks.filter((task) => task.notes);
  if (noted.length > 0) {
    parts.push(`Your private reasoning about the conversational part is inside the tags below. It is for you only: never print it, quote it, or mention that you made notes. Start your reply with the answer itself.\n<private_reasoning>\n${noted.map((task) => `${task.question}\n${task.notes}`).join("\n\n")}\n</private_reasoning>`);
  }
  return parts.join("\n\n");
}

async function answer(state: typeof AskState.State, runtime: AskRuntime): Promise<AskUpdate | Command> {
  const errors = state.taskResults.filter((task) => task.status === "error");
  let ticketNote = "";
  if (errors.length > 0) {
    const ticket = await createChatTicket({
      sessionId: state.sessionId,
      originalQuestion: state.question,
      enhancedQuestion: errors.map((task) => task.question).join(" | "),
      rewrites: state.rewrites,
      errorMessage: state.errorMessage || "Search failed",
    });
    ticketNote = `\n\n${ticketMessage(ticket.id)}`;
  }
  runtime.writer({ type: "citations", citations: state.citations });
  runtime.writer({ type: "status", message: "Writing the answer" });
  const llm = createLLMProvider();
  const evidence = evidenceText(state.taskResults);
  const chatTasks = state.taskResults.filter((task) => task.intent === "chat");
  const smallTalkOnly = chatTasks.length > 0 && chatTasks.length === state.taskResults.length && isSmallTalk(state.question);
  let text = "";
  try {
    const filter = createReasoningFilter();
    const send = (piece: string) => {
      if (!piece) return;
      text += piece;
      runtime.writer({ type: "token", text: piece });
    };
    for await (const token of llm.streamChat({
      systemPrompt: composePrompt(evidence, chatTasks),
      messages: [...recentTurns(state.prior), { role: "user", content: `${memoryContext(state)}\n\n${state.question}` }],
    })) {
      send(filter.push(token));
    }
    send(filter.flush());
    if (ticketNote) {
      text += ticketNote;
      emitText(runtime, ticketNote);
    }
    return { answer: text, outcome: "answer" };
  } catch (err) {
    // A greeting must never raise a ticket because the model was unreachable.
    if (smallTalkOnly && !text) {
      const reply = smallTalkReply(state.question);
      emitText(runtime, reply);
      return { answer: reply, outcome: "answer" };
    }
    const message = err instanceof Error ? err.message : "Answer failed";
    return new Command({
      goto: "fallback",
      update: { failureReason: "error", errorMessage: message, answer: "" },
    });
  }
}

async function askClarify(state: typeof AskState.State, runtime: AskRuntime): Promise<AskUpdate> {
  const empties = state.taskResults.filter((task) => task.status === "empty");
  const answered = evidenceText(state.taskResults);
  let text = "";
  if (answered) {
    const llm = createLLMProvider();
    text = await llm.chat({
      systemPrompt: ANSWER_RULES,
      messages: [{ role: "user", content: `${state.question}\n\n${answered}` }],
    });
    text += "\n\n";
  }
  const clarify = (empties.length > 0 ? empties : [{ question: state.enhancedQuestion || state.question }])
    .map((task) => clarificationMessage(task.question))
    .join("\n\n");
  text += clarify;
  emitText(runtime, text);
  return { answer: text, outcome: "clarify", citations: state.citations };
}

async function fallback(state: typeof AskState.State, runtime: AskRuntime): Promise<AskUpdate> {
  const errors = state.taskResults.filter((task) => task.status === "error");
  const empties = state.taskResults.filter((task) => task.status === "empty");
  const parts: string[] = [];
  if (state.failureReason === "error" || errors.length > 0) {
    const ticket = await createChatTicket({
      sessionId: state.sessionId,
      originalQuestion: state.question,
      enhancedQuestion: state.enhancedQuestion || state.question,
      rewrites: state.rewrites,
      errorMessage: state.errorMessage || "Search failed",
    });
    parts.push(ticketMessage(ticket.id));
  }
  const missing = empties.length > 0 ? empties : state.failureReason === "error" ? [] : [{ question: state.enhancedQuestion || state.question }];
  parts.push(...missing.map((task) => missingRecordMessage(task.question)));
  const text = parts.filter(Boolean).join("\n\n");
  emitText(runtime, text);
  return { answer: text, outcome: errors.length > 0 || state.failureReason === "error" ? "fallback_error" : "fallback_empty", citations: [] };
}

async function saveAssistant(state: typeof AskState.State, runtime: AskRuntime): Promise<AskUpdate> {
  await insertChatMessage({
    sessionId: state.sessionId,
    role: "assistant",
    content: state.answer,
    citations: state.citations,
  });
  if (state.outcome === "clarify") {
    await setPendingClarification(state.sessionId, {
      enhancedQuestion: state.enhancedQuestion || state.question,
      rewrites: state.rewrites,
    });
  } else {
    await setPendingClarification(state.sessionId, null);
  }
  runtime.writer({ type: "done" });
  return {};
}

async function remember(state: typeof AskState.State): Promise<AskUpdate> {
  try {
    const llm = createLLMProvider();
    const raw = await llm.chat({
      systemPrompt:
        'Update the session memory. Return only JSON: {"summary":"a short recall of older turns","entities":{"partNumber":"","partName":"","routerNo":"","operatorName":"","machineName":""}}. Keep a previous entity when this turn does not name a new one. The summary must keep router, part, machine, and operator facts that later questions can refer to.',
      messages: [
        {
          role: "user",
          content: `Previous summary:\n${state.summary || "(none)"}\nPrevious entities:\n${JSON.stringify(state.entities)}\n\nUser:\n${state.question}\n\nAssistant:\n${state.answer.slice(0, 2000)}`,
        },
      ],
    });
    const memory = parseMemory(raw, { summary: state.summary, entities: state.entities });
    await setSessionMemory(state.sessionId, memory.summary, memory.entities);
    return memory;
  } catch (err) {
    console.error("[ask-graph] remember failed", err);
    return {};
  }
}

const builder = new StateGraph(AskState)
  .addNode("load_session", loadSession)
  .addNode("save_user", saveUser)
  .addNode("classify", classify)
  .addNode("orchestrate", orchestrate)
  .addNode("compose_answer", answer)
  .addNode("ask_clarify", askClarify)
  .addNode("fallback", fallback)
  .addNode("save_assistant", saveAssistant)
  .addNode("remember", remember)
  .addEdge(START, "load_session")
  .addEdge("load_session", "save_user")
  .addEdge("save_user", "classify")
  .addEdge("classify", "orchestrate")
  .addConditionalEdges("orchestrate", decideAfterTasks, {
    compose_answer: "compose_answer",
    ask_clarify: "ask_clarify",
    fallback: "fallback",
  })
  .addEdge("compose_answer", "save_assistant")
  .addEdge("ask_clarify", "save_assistant")
  .addEdge("fallback", "save_assistant")
  .addEdge("save_assistant", "remember")
  .addEdge("remember", END);

export const askGraph = builder.compile();

export async function streamAskGraph(input: {
  sessionId: string;
  title: string;
  question: string;
}): Promise<AsyncIterable<AskStreamEvent>> {
  return askGraph.stream(
    { sessionId: input.sessionId, title: input.title, question: input.question },
    { streamMode: "custom" }
  ) as Promise<AsyncIterable<AskStreamEvent>>;
}
