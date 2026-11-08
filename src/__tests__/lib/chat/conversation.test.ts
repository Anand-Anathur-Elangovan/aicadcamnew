import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AskStreamEvent } from "@/lib/chat/graph";

const state = vi.hoisted(() => ({
  chatCalls: [] as { systemPrompt: string; user: string }[],
  streamPrompts: [] as string[],
  classifier: "" as string,
  llmDown: false,
  ragCalls: [] as string[],
  tickets: 0,
  shopRows: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/providers/llm.provider", () => ({
  createLLMProvider: () => ({
    async chat({ systemPrompt, messages }: { systemPrompt: string; messages: { content: string }[] }) {
      state.chatCalls.push({ systemPrompt, user: messages[messages.length - 1].content });
      if (state.llmDown) throw new Error("model unreachable");
      if (systemPrompt.includes("intent classifier")) return state.classifier;
      if (systemPrompt.includes("reasoning step")) return "The user wants a comparison. Climb milling cuts with the feed; conventional cuts against it.";
      if (systemPrompt.includes("Update the session memory")) return "{}";
      if (systemPrompt.includes("Write one PostgreSQL SELECT")) return "SELECT router_no, status FROM shop_v_job_balance";
      return "";
    },
    async *streamChat({ systemPrompt }: { systemPrompt: string }) {
      state.streamPrompts.push(systemPrompt);
      if (state.llmDown) throw new Error("model unreachable");
      yield "Here is ";
      yield "the reply.";
    },
  }),
}));

vi.mock("@/lib/chat/sessions", () => ({
  listChatMessages: async () => [],
  getChatSession: async () => null,
  insertChatMessage: async () => ({}),
  renameChatSession: async () => undefined,
  sessionTitleFromQuestion: (question: string) => question.slice(0, 30),
  setPendingClarification: async () => undefined,
  setSessionMemory: async () => undefined,
  createChatTicket: async () => {
    state.tickets += 1;
    return { id: "T-1" };
  },
}));

vi.mock("@/lib/chat/shopQuery", () => ({
  SHOP_VIEW_GUIDE: "shop_v_job_balance: router_no, status",
  runShopSelect: async () => state.shopRows,
}));

const chunk = (id: string, doc: string, page: number, index: number) => ({
  index,
  chunkId: id,
  documentId: doc,
  documentName: `${doc}.pdf`,
  category: "DRAWING_2D",
  pageNumber: page,
  snippet: "",
  downloadUrl: "",
  viewUrl: "",
});

vi.mock("@/lib/rag/pipeline", () => ({
  runRAGPipeline: async (query: string) => {
    state.ragCalls.push(query);
    return {
      chunks: [],
      citations: [chunk("c1", "bracket", 1, 1), chunk("c2", "bracket", 1, 2), chunk("c3", "plate", 2, 3)],
      contextText: "[1] (Page 1, Doc: bracket.pdf)\nMaterial EN8\n\n---\n\n[2] (Page 1, Doc: bracket.pdf)\nFinish 1.6 Ra\n\n---\n\n[3] (Page 2, Doc: plate.pdf)\nThickness 12",
      topScore: 0.95,
    };
  },
}));

const { askGraph } = await import("@/lib/chat/graph");

async function ask(question: string): Promise<AskStreamEvent[]> {
  const events: AskStreamEvent[] = [];
  const stream = await askGraph.stream({ sessionId: "s1", title: "New chat", question }, { streamMode: "custom" });
  for await (const event of stream as AsyncIterable<AskStreamEvent>) events.push(event);
  return events;
}

const text = (events: AskStreamEvent[]) => events.filter((event) => event.type === "token").map((event) => event.text).join("");

beforeEach(() => {
  state.chatCalls = [];
  state.streamPrompts = [];
  state.classifier = "";
  state.llmDown = false;
  state.ragCalls = [];
  state.tickets = 0;
  state.shopRows = [];
});

describe("conversation", () => {
  it("answers a greeting as a conversation, with no record search, no ticket and no sources", async () => {
    for (const greeting of ["hi", "Hello!", "hey there", "thanks", "good morning"]) {
      state.chatCalls = [];
      state.ragCalls = [];
      const events = await ask(greeting);
      expect(text(events), greeting).toBe("Here is the reply.");
      expect(state.ragCalls).toEqual([]);
      expect(state.chatCalls.some((call) => call.systemPrompt.includes("intent classifier"))).toBe(false);
      expect(events.some((event) => event.type === "attempt")).toBe(false);
      expect(events.find((event) => event.type === "citations")?.citations).toEqual([]);
      expect(text(events)).not.toMatch(/not in the records/i);
      expect(events.at(-1)?.type).toBe("done");
    }
    expect(state.tickets).toBe(0);
  });

  it("still greets, with a built-in reply, when the model is unreachable", async () => {
    state.llmDown = true;
    const events = await ask("hello");
    expect(text(events)).toMatch(/hello/i);
    expect(state.tickets).toBe(0);
    expect(events.some((event) => event.type === "error")).toBe(false);
  });

  it("reasons through a general question before it answers, without searching records", async () => {
    state.classifier = '{"tasks":[{"intent":"chat","question":"Explain climb versus conventional milling."}]}';
    const events = await ask("Explain climb versus conventional milling.");
    expect(state.ragCalls).toEqual([]);
    expect(state.chatCalls.some((call) => call.systemPrompt.includes("reasoning step"))).toBe(true);
    const prompt = state.streamPrompts[0];
    expect(prompt).toContain("Manufacturing AI Assistant");
    expect(prompt).toContain("<private_reasoning>");
    expect(prompt).toContain("Climb milling cuts with the feed");
    expect(prompt).not.toContain("--- RECORDS ---");
    expect(text(events)).toBe("Here is the reply.");
  });

  it("reports what it is doing, starting at once", async () => {
    state.classifier = '{"tasks":[{"intent":"chat","question":"Why is stainless hard to machine?"}]}';
    const events = await ask("Why is stainless hard to machine?");
    const statuses = events.filter((event) => event.type === "status").map((event) => event.message);
    expect(statuses[0]).toBe("Understanding your question");
    expect(statuses).toContain("Reasoning through your question");
    expect(statuses.at(-1)).toBe("Writing the answer");
  });

  it("lists each source page once, and numbers match the excerpts the model sees", async () => {
    state.classifier = '{"tasks":[{"intent":"document","question":"What material is on the bracket drawing?"},{"intent":"document","question":"What finish is on the bracket drawing?"}]}';
    const events = await ask("What material and finish are on the bracket drawing?");
    const citations = events.find((event) => event.type === "citations")?.citations ?? [];
    expect(citations.map((citation) => `${citation.documentId}:${citation.pageNumber}`)).toEqual(["bracket:1", "plate:2"]);
    expect(citations.map((citation) => citation.index)).toEqual([1, 2]);
    const prompt = state.streamPrompts[0];
    expect(prompt).toContain("[1] (Page 1");
    expect(prompt).toContain("[2] (Page 2");
    expect(prompt).not.toContain("[3] (Page");
    // The second question returned the same chunks, so they are not repeated.
    expect(prompt.match(/Material EN8/g)).toHaveLength(1);
  });

  it("keeps the record path unchanged for a shop question", async () => {
    state.classifier = '{"tasks":[{"intent":"shop","question":"What is the status of router R-45041?"}]}';
    state.shopRows = [{ router_no: "R-45041", status: "running" }];
    const events = await ask("What is the status of router R-45041?");
    const prompt = state.streamPrompts[0];
    expect(prompt).toContain("--- RECORDS ---");
    expect(prompt).toContain("R-45041");
    expect(prompt).toContain("Close every answer with a Summary");
    expect(state.chatCalls.some((call) => call.systemPrompt.includes("reasoning step"))).toBe(false);
    expect(text(events)).toBe("Here is the reply.");
  });

  it("answers a record question and a chat part in one message", async () => {
    state.classifier = '{"tasks":[{"intent":"shop","question":"Status of router R-45041?"},{"intent":"chat","question":"Explain what a router is in a job shop."}]}';
    state.shopRows = [{ router_no: "R-45041", status: "running" }];
    await ask("Status of router R-45041? Also explain what a router is in a job shop.");
    const prompt = state.streamPrompts[0];
    expect(prompt).toContain("--- RECORDS ---");
    expect(prompt).toContain("conversational or general parts");
  });

  it("a miss in the records still asks to clarify, as before", async () => {
    state.classifier = '{"tasks":[{"intent":"shop","question":"Status of router R-99999?"}]}';
    state.shopRows = [];
    const events = await ask("Status of router R-99999?");
    expect(text(events)).toMatch(/could not find this in the records/i);
  });
});

