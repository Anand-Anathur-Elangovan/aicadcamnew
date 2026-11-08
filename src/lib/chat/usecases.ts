export type AskIntent = "shop" | "document" | "chat";

export interface AskUseCase {
  id: string;
  intent: AskIntent | "both";
  example: string;
}

/** Questions the classifier is expected to route. */
export const ASK_USE_CASES: AskUseCase[] = [
  { id: "greeting", intent: "chat", example: "Hi, hello, thanks, good morning" },
  { id: "about", intent: "chat", example: "What can you do?" },
  { id: "general", intent: "chat", example: "Explain the difference between climb and conventional milling." },
  { id: "followup", intent: "chat", example: "Why did you say that? Can you explain that more simply?" },
  { id: "drawing", intent: "document", example: "What material is called out on the Mounting Bracket drawing?" },
  { id: "router_status", intent: "shop", example: "What is the status of router R-45041?" },
  { id: "part_wip", intent: "shop", example: "How many of part WB-100 are running?" },
  { id: "machine_now", intent: "shop", example: "What part is running on HAAS-VF4-01 right now?" },
  { id: "machine_history", intent: "shop", example: "What ran on HAAS-VF2-01 on 3 Nov 2026?" },
  { id: "operator_history", intent: "shop", example: "Which machines did Ravi Menon run in October 2026, and which part numbers?" },
  { id: "long_hours", intent: "shop", example: "Why did part WB-100 run long hours in the week of 3 Nov 2026, and what is the issue?" },
  { id: "rejects", intent: "shop", example: "How many of router R-45041 were rejected and why?" },
  { id: "shipments", intent: "shop", example: "How many pieces shipped against router R-45021?" },
  {
    id: "stage_location",
    intent: "shop",
    example: "Where are the pieces on router R-45041 right now, and how many of part WB-100 are at an outside processor?",
  },
  {
    id: "mixed",
    intent: "both",
    example: "What is the status of router R-45041, and what part number is on the Mounting Bracket drawing?",
  },
];

export interface AskTask {
  intent: AskIntent;
  question: string;
}

const SHOP_CUE = /\b(router|machine|operator|running|shipped|shipment|scrap|rework|hours|heat|status|stage|stores|outside|vendor|plating|heat treat)\b/i;
const DOC_CUE = /\b(drawing|document|tolerance|revision|uploaded|material|inspection|purchase|order|orders|inventory|stock|batch|bracket|catalog|dwg|po)\b/i;

const FILLER = new Set([
  "hi", "hii", "hiii", "hello", "hey", "heya", "hola", "namaste", "yo", "sup", "there", "good", "morning", "afternoon", "evening", "night",
  "thanks", "thank", "you", "thx", "ok", "okay", "cool", "great", "nice", "awesome", "perfect", "fine", "bye", "goodbye", "see", "later",
  "please", "again", "how", "are", "doing", "whats", "what", "s", "up", "buddy", "bot", "assistant", "friend", "test", "testing", "hmm", "yes", "no",
  "sure", "got", "it", "a", "lot", "lots", "many", "the", "help", "me", "very", "much", "so", "well", "done", "ha", "haha", "lol", "welcome",
]);

const ABOUT_ME = /^(?:who|what)(?:'s| is| are)?\s+(?:you|your name)\b|\bwhat can you (?:do|help)|\bhow (?:do|can) i use (?:you|this)|\bwhat do you do\b|^help\b[\s?!.]*$|\bintroduce yourself\b/i;

/** Greetings, thanks, and questions about the assistant itself. These need no record search. */
export function isSmallTalk(text: string): boolean {
  const clean = text.toLowerCase().replace(/[^a-z0-9'\s]/g, " ").replace(/'/g, " ").trim();
  if (!clean) return false;
  if (ABOUT_ME.test(text.trim().toLowerCase())) return true;
  const words = clean.split(/\s+/);
  return words.length <= 8 && words.every((word) => FILLER.has(word));
}

/** A reply that needs no model, used when the model is unreachable for a greeting. */
export function smallTalkReply(text: string): string {
  const lower = text.toLowerCase();
  if (/\b(thanks|thank|thx)\b/.test(lower)) return "You're welcome. Ask me anything else about your jobs, machines or drawings.";
  if (/\b(bye|goodbye|see you|later)\b/.test(lower)) return "Goodbye. I'm here whenever you need to check a job, a machine or a drawing.";
  if (ABOUT_ME.test(lower.trim())) {
    return "I'm the Manufacturing AI Assistant. I can look up routers, machines, operators, hours, scrap and shipments, read your uploaded drawings and reports, and talk through manufacturing questions. What would you like to know?";
  }
  return "Hello! I can check routers, machines, operators and shipments, search your drawings and reports, or talk through a manufacturing question. What would you like to look at?";
}

export function parsePlan(raw: string, original: string): AskTask[] {
  const fromModel = readTasks(raw);
  if (fromModel.length > 0) return fromModel;
  return fallbackTasks(original);
}

function readTasks(raw: string): AskTask[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { tasks?: unknown };
    if (!Array.isArray(parsed.tasks)) return [];
    return parsed.tasks
      .map((item) => {
        const task = item as { intent?: string; question?: string };
        const question = typeof task.question === "string" ? task.question.trim() : "";
        if (!question) return null;
        if (task.intent === "shop" || task.intent === "document" || task.intent === "chat") return { intent: task.intent, question };
        return null;
      })
      .filter((task): task is AskTask => task !== null);
  } catch {
    return [];
  }
}

export function fallbackTasks(original: string): AskTask[] {
  if (isSmallTalk(original)) return [{ intent: "chat", question: original }];
  const shop = SHOP_CUE.test(original);
  const document = DOC_CUE.test(original);
  if (shop && document) {
    const parts = original.split(/\s+and\s+/i).map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return parts.map((question) => ({
        intent: SHOP_CUE.test(question) && !DOC_CUE.test(question) ? "shop" : DOC_CUE.test(question) && !SHOP_CUE.test(question) ? "document" : shop ? "shop" : "document",
        question,
      }));
    }
  }
  if (!shop && !document) return [{ intent: "chat", question: original }];
  return [{ intent: shop && !document ? "shop" : "document", question: original }];
}
