import { describe, expect, it } from "vitest";
import { dedupeCitations, mergeDocumentEvidence } from "@/lib/chat/evidence";
import { fallbackTasks, isSmallTalk, parsePlan, smallTalkReply } from "@/lib/chat/usecases";
import type { Citation } from "@/lib/types";

const cite = (chunkId: string, documentId: string, page: number | undefined, index: number): Citation =>
  ({ index, chunkId, documentId, documentName: documentId, category: "GENERAL", pageNumber: page, snippet: "", downloadUrl: "", viewUrl: "" }) as Citation;

describe("small talk", () => {
  it("recognises greetings, thanks and questions about the assistant", () => {
    for (const text of ["hi", "Hello", "hey there!", "good morning", "thanks a lot", "thank you", "ok cool", "bye", "how are you", "who are you?", "what can you do?", "help", "hii"]) {
      expect(isSmallTalk(text), text).toBe(true);
    }
  });

  it("does not take a real question for small talk", () => {
    for (const text of ["hello, what is the status of router R-45041", "What material is on the bracket?", "hi can you check WB-100", "how many were shipped", "explain climb milling"]) {
      expect(isSmallTalk(text), text).toBe(false);
    }
  });

  it("has a reply that needs no model", () => {
    expect(smallTalkReply("hi")).toMatch(/hello/i);
    expect(smallTalkReply("thanks")).toMatch(/welcome/i);
    expect(smallTalkReply("what can you do")).toMatch(/Manufacturing AI Assistant/);
  });
});

describe("routing", () => {
  it("sends a greeting to chat and never to a document search", () => {
    expect(fallbackTasks("hi")).toEqual([{ intent: "chat", question: "hi" }]);
  });

  it("sends a general question with no record cue to chat", () => {
    expect(fallbackTasks("Explain the difference between climb and conventional milling")[0].intent).toBe("chat");
  });

  it("keeps record questions on their old routes", () => {
    expect(fallbackTasks("What is the status of router R-45041?")[0].intent).toBe("shop");
    expect(fallbackTasks("How many of part WB-100 are running?")[0].intent).toBe("shop");
    expect(fallbackTasks("What material is called out on the Mounting Bracket drawing?")[0].intent).toBe("document");
    expect(fallbackTasks("List all open purchase orders")[0].intent).toBe("document");
    expect(fallbackTasks("What are the tolerances for part DWG-A901?")[0].intent).toBe("document");
  });

  it("reads a chat task from the classifier", () => {
    expect(parsePlan('{"tasks":[{"intent":"chat","question":"Explain tool wear"}]}', "x")).toEqual([{ intent: "chat", question: "Explain tool wear" }]);
  });
});

describe("sources", () => {
  it("lists one source per page and numbers them without gaps", () => {
    const list = dedupeCitations([cite("a", "d1", 1, 1), cite("b", "d1", 1, 2), cite("c", "d2", 3, 3), cite("d", "d1", 2, 4)]);
    expect(list.map((item) => `${item.documentId}:${item.pageNumber}`)).toEqual(["d1:1", "d2:3", "d1:2"]);
    expect(list.map((item) => item.index)).toEqual([1, 2, 3]);
  });

  it("merges two questions that returned the same pages", () => {
    const first = {
      citations: [cite("a", "d1", 1, 1), cite("b", "d2", 5, 2)],
      contextText: "[1] (Page 1, Doc: d1)\nalpha\n\n---\n\n[2] (Page 5, Doc: d2)\nbeta",
    };
    const second = {
      citations: [cite("b", "d2", 5, 1), cite("c", "d3", 2, 2)],
      contextText: "[1] (Page 5, Doc: d2)\nbeta\n\n---\n\n[2] (Page 2, Doc: d3)\ngamma",
    };
    const merged = mergeDocumentEvidence([first, second]);
    expect(merged.citations.map((item) => item.documentId)).toEqual(["d1", "d2", "d3"]);
    expect(merged.contexts[0]).toContain("[1] (Page 1");
    expect(merged.contexts[0]).toContain("[2] (Page 5");
    // The repeated chunk is dropped and the new one takes the next number.
    expect(merged.contexts[1]).not.toContain("beta");
    expect(merged.contexts[1]).toContain("[3] (Page 2");
  });

  it("leaves an empty result empty", () => {
    expect(mergeDocumentEvidence([{ citations: [], contextText: "" }])).toEqual({ citations: [], contexts: [""] });
  });
});
