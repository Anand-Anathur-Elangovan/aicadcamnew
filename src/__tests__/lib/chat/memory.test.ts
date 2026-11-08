import { describe, expect, it } from "vitest";
import { emptyEntities, parseMemory, recentTurns } from "@/lib/chat/memory";

describe("session memory", () => {
  it("keeps only the latest turns for the model while the caller still holds the full list", () => {
    const turns = ["1", "2", "3", "4", "5", "6", "7", "8"];
    expect(recentTurns(turns)).toEqual(["3", "4", "5", "6", "7", "8"]);
    expect(turns).toHaveLength(8);
  });

  it("keeps a remembered router when the new turn does not name one", () => {
    const memory = parseMemory(
      '{"summary":"Asked about router R-45041.","entities":{"partNumber":"WB-100","routerNo":""}}',
      { summary: "old", entities: { ...emptyEntities(), routerNo: "R-45041", partNumber: "WB-100" } }
    );
    expect(memory.summary).toBe("Asked about router R-45041.");
    expect(memory.entities.routerNo).toBe("R-45041");
    expect(memory.entities.partNumber).toBe("WB-100");
  });
});
