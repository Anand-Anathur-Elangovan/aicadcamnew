import { describe, expect, it } from "vitest";
import { unsupportedFeatures } from "@/lib/studio/limitations";

describe("unsupportedFeatures", () => {
  it("is silent for a plain program", () => {
    expect(unsupportedFeatures("G21 G17 G90\nG54\nG00 X0 Y0\nG01 Z-5 F100\nM30")).toEqual([]);
  });
  it("names only what the program uses and ignores comments", () => {
    const notes = unsupportedFeatures("(G41 in a comment)\nG41 D01 X10\nM98 P100\nG56\nG68 X0 Y0 R45\nG32 Z-20 F1.5");
    expect(notes).toHaveLength(5);
    expect(notes.join(" ")).toMatch(/G41/);
    expect(unsupportedFeatures("(G41 in a comment) ; M98\nG00 X0")).toEqual([]);
  });
});
