import { describe, expect, it } from "vitest";
import { SAMPLE_GCODE, parseGCode } from "@/lib/gcode/parser";

describe("gcode toolpath", () => {
  it("reads a move when the axis letter and the number are separated", () => {
    const result = parseGCode("G21 G90\nG00 X 10 Y 20\nG01 Z -1 F 100\n");
    expect(result.segments.length).toBeGreaterThan(0);
    expect(result.segments.at(-1)?.to[2]).toBe(-1);
  });

  it("builds a path from the sample program", () => {
    const result = parseGCode(SAMPLE_GCODE);
    expect(result.segments.length).toBeGreaterThan(10);
    expect(result.totalLength).toBeGreaterThan(50);
  });

  it("follows an edited lathe program in X diameter and Z length", () => {
    const edited = `%
O0100 (HC-100 OP10 TURN OD)
G21 G18 G40 G99
G28 U0 W0
T0101
G96 S180 M03
G00 X21.0 Z2.
G01 X16.0 F0.25
G01 Z-34.0 F0.2
G00 X36.0
G28 U0 W0
M30
%`;
    const result = parseGCode(edited);
    expect(result.segments.map((segment) => segment.to)).toEqual([
      [2, 0, 16],
      [-34, 0, 16],
      [-34, 0, 36],
    ]);
    expect(result.segments[0].from).toEqual([2, 0, 21]);
    expect(result.segments.map((segment) => segment.type)).toEqual(["feed", "feed", "rapid"]);
    expect(result.segments.some((segment) => segment.from[0] === 0 && segment.from[2] === 0)).toBe(false);
  });

  it("keeps the original lathe cut when those words are still in the program", () => {
    const original = `%
O0100 (HC-100 OP10 TURN OD)
G21 G18 G40 G99
G28 U0 W0
T0101
G96 S180 M03
G00 X42.0 Z2.
G01 X32.0 F0.25
G01 Z-68.0 F0.2
G00 X36.0
G28 U0 W0
M30
%`;
    const turn = parseGCode(original).segments[1];
    expect(turn.to).toEqual([-68, 0, 32]);
  });
});
