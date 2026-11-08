import { describe, it, expect } from "vitest";
import { createReasoningFilter } from "@/lib/chat/graph";

describe("createReasoningFilter", () => {
  const run = (chunks: string[]) => {
    const f = createReasoningFilter();
    return chunks.map((c) => f.push(c)).join("") + f.flush();
  };
  it("drops an echoed reasoning block split across chunks", () => {
    const text = "<priv|ate_reasoning>\nsecret\nnotes\n</private_|reasoning>\n\nHello there".split("|");
    expect(run(text)).toBe("Hello there");
  });
  it("passes normal text and lone angle brackets through", () => {
    expect(run(["a < b and ", "<b>bold</b>"])).toBe("a < b and <b>bold</b>");
  });
});
