import { describe, expect, it } from "vitest";
import { askGraph, decideAfterTasks, decideNextStep, normalizeEnhancedQuestion } from "@/lib/chat/graph";
import { guardShopSql } from "@/lib/chat/shopQuery";
import { parsePlan } from "@/lib/chat/usecases";

describe("ask graph", () => {
  it("keeps a standalone question unchanged when the rewrite is empty", () => {
    expect(normalizeEnhancedQuestion("", "What material is the Wall Bracket?")).toBe(
      "What material is the Wall Bracket?"
    );
  });

  it("uses the first line of a rewrite and drops wrapping quotes", () => {
    expect(normalizeEnhancedQuestion('"What material does the Wall Bracket use?"\nextra', "it")).toBe(
      "What material does the Wall Bracket use?"
    );
  });

  it("answers on a hit, rewrites twice, then asks once, then falls back", () => {
    expect(decideNextStep({ failureReason: "", clarificationAttempt: false, rewriteCount: 0 })).toBe(
      "compose_answer"
    );
    expect(decideNextStep({ failureReason: "empty", clarificationAttempt: false, rewriteCount: 0 })).toBe(
      "rewrite"
    );
    expect(decideNextStep({ failureReason: "empty", clarificationAttempt: false, rewriteCount: 1 })).toBe(
      "rewrite"
    );
    expect(decideNextStep({ failureReason: "empty", clarificationAttempt: false, rewriteCount: 2 })).toBe(
      "ask_clarify"
    );
    expect(decideNextStep({ failureReason: "empty", clarificationAttempt: true, rewriteCount: 0 })).toBe(
      "fallback"
    );
    expect(decideNextStep({ failureReason: "error", clarificationAttempt: false, rewriteCount: 0 })).toBe(
      "rewrite"
    );
    expect(decideNextStep({ failureReason: "error", clarificationAttempt: false, rewriteCount: 2 })).toBe(
      "fallback"
    );
  });

  it("registers the classifier, the orchestrator, and the fallback nodes", () => {
    const names = Object.keys(askGraph.getGraph().nodes);
    expect(names).toEqual(
      expect.arrayContaining(["classify", "orchestrate", "ask_clarify", "fallback", "compose_answer", "save_assistant"])
    );
  });

  it("answers when every part succeeds, clarifies a miss, and falls back after a clarification", () => {
    expect(decideAfterTasks({ taskResults: [{ status: "ok" }, { status: "ok" }], clarificationAttempt: false })).toBe(
      "compose_answer"
    );
    expect(decideAfterTasks({ taskResults: [{ status: "ok" }, { status: "empty" }], clarificationAttempt: false })).toBe(
      "ask_clarify"
    );
    expect(decideAfterTasks({ taskResults: [{ status: "empty" }], clarificationAttempt: true })).toBe("fallback");
    expect(decideAfterTasks({ taskResults: [{ status: "error" }], clarificationAttempt: false })).toBe("fallback");
  });

  it("splits a two-part message and keeps shop SQL on the views", () => {
    const tasks = parsePlan(
      '{"tasks":[{"intent":"shop","question":"What is the status of router R-45041?"},{"intent":"document","question":"What part number is on the Mounting Bracket drawing?"}]}',
      "ignored"
    );
    expect(tasks.map((task) => task.intent)).toEqual(["shop", "document"]);
    expect(guardShopSql("SELECT router_no, status FROM shop_v_job_balance WHERE router_no = 'R-45041'")).toContain(
      "LIMIT 50"
    );
    expect(() => guardShopSql("DELETE FROM shop_v_labor")).toThrow(/SELECT/);
    expect(() => guardShopSql("SELECT * FROM shop_routers")).toThrow(/views/);
    expect(guardShopSql("SELECT stage_name, qty FROM shop_v_stages WHERE router_no = 'R-45041' AND is_current")).toContain(
      "shop_v_stages"
    );
  });
});
