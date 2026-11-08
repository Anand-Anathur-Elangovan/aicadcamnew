import { describe, expect, it } from "vitest";
import { interpretProgram } from "@/lib/sim/interpret";
import { latheGrid } from "@/lib/sim/latheEngine";
import { createEngine, prepareSim } from "@/lib/sim/prepare";
import type { LatheSetup, MillSetup } from "@/lib/sim/types";

const lathe: LatheSetup = {
  family: "lathe",
  length: 80,
  shape: { kind: "rect", width: 40, height: 40 },
  chuckZ: -68,
  chuckRadius: 29,
  previous: [],
};

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

const edited = original.replace("X42.0 Z2.", "X21.0 Z2.").replace("X32.0 F0.25", "X16.0 F0.25").replace("Z-68.0", "Z-34.0");

function radiusAt(engine: ReturnType<typeof createEngine>, z: number): number {
  if (engine.family !== "lathe") throw new Error("not lathe");
  const grid = latheGrid(lathe);
  const state = (engine as unknown as { state: { outer: Float32Array } }).state;
  const row = Math.round(-z / grid.dz);
  let min = Infinity;
  for (let j = 0; j < grid.sectors; j += 1) min = Math.min(min, state.outer[row * grid.sectors + j]);
  return min;
}

describe("interpretProgram", () => {
  it("reads the lathe program as diameter moves with a home retract", () => {
    const program = interpretProgram(edited, { home: [140, 0, 60] });
    expect(program.lathe).toBe(true);
    const feeds = program.motions.filter((motion) => motion.kind === "feed");
    expect(feeds[0].to).toEqual([16, 0, 2]);
    expect(feeds[1].to).toEqual([16, 0, -34]);
    expect(program.motions.some((motion) => motion.home)).toBe(true);
  });

  it("expands a drilling cycle into plunge moves per hole", () => {
    const program = interpretProgram(
      "(TOOL DRILL D8)\nT03 M06\nS1000 M03\nG00 X0 Y0\nG00 Z50\nG81 X10 Y10 Z-12 R2 F100\nX20 Y10\nG80\nM30",
      { home: [0, 0, 50], lathe: false }
    );
    const plunges = program.motions.filter((motion) => motion.kind === "feed");
    expect(plunges).toHaveLength(2);
    expect(plunges[0].to).toEqual([10, 10, -12]);
    expect(plunges[1].to).toEqual([20, 10, -12]);
    expect(program.tools[program.motions[0].tool].kind).toBe("drill");
  });
});

describe("lathe simulation", () => {
  it("turns the original program to 32 mm with no collision", () => {
    const job = prepareSim(original, lathe);
    expect(job.report.collision).toBeNull();
    const engine = createEngine(job);
    engine.advanceTo(engine.duration + 1);
    expect(radiusAt(engine, -10)).toBeCloseTo(16, 1);
    expect(radiusAt(engine, -70)).toBeGreaterThan(19);
  });

  it("turns the edited program to a 16 mm pin that is 34 mm long", () => {
    const job = prepareSim(edited, lathe);
    expect(job.report.collision).toBeNull();
    const engine = createEngine(job);
    engine.advanceTo(engine.duration + 1);
    expect(radiusAt(engine, -10)).toBeCloseTo(8, 1);
    expect(radiusAt(engine, -33.5)).toBeCloseTo(8, 1);
    expect(radiusAt(engine, -40)).toBeGreaterThan(19);
  });

  it("reports the chuck crash on the line that goes past the jaws", () => {
    const job = prepareSim(original.replace("Z-68.0", "Z-75.0"), lathe);
    expect(job.report.collision?.kind).toBe("chuck");
    expect(job.report.collision?.line).toBe(8);
  });

  it("reports a rapid move into the bar", () => {
    const job = prepareSim(original.replace("G01 X32.0 F0.25", "G00 X10.0 Z-5.0"), lathe);
    expect(job.report.collision?.kind).toBe("rapid");
  });

  it("reports cutting with the spindle off", () => {
    const job = prepareSim(original.replace("G96 S180 M03", "G96 S180"), lathe);
    expect(job.report.collision?.kind).toBe("spindle");
  });
});

describe("mill simulation", () => {
  const mill: MillSetup = { family: "mill", x0: 0, y0: 0, length: 60, width: 40, top: 0, bottom: -10, previous: [] };

  it("cuts a drilled hole and passes cleanly", () => {
    const job = prepareSim(
      "(TOOL DRILL D8)\nT03 M06\nS1000 M03\nG00 X0 Y0\nG00 Z50\nG81 X30 Y20 Z-6 R2 F100\nG80\nG00 Z50\nM30",
      mill
    );
    expect(job.report.collision).toBeNull();
    const engine = createEngine(job);
    engine.advanceTo(engine.duration + 1);
    const state = (engine as unknown as { state: { heights: Float32Array }; grid: { nx: number; cell: number } }).state;
    const grid = (engine as unknown as { grid: { nx: number; cell: number } }).grid;
    const centre = Math.floor(20 / grid.cell) * grid.nx + Math.floor(30 / grid.cell);
    expect(state.heights[centre]).toBeLessThan(-4);
    expect(state.heights[0]).toBe(0);
  });

  it("flags a rapid into the stock and a plunge through the bottom", () => {
    const rapid = prepareSim("(TOOL FLAT D8)\nT01 M06\nM03 S800\nG00 X30 Y20\nG00 Z-2\nM30", mill);
    expect(rapid.report.collision?.kind).toBe("rapid");
    const deep = prepareSim("(TOOL FLAT D8)\nT01 M06\nM03 S800\nG00 X30 Y20\nG00 Z5\nG01 Z-20 F100\nM30", mill);
    expect(deep.report.collision?.kind).toBe("table");
  });
});

describe("lathe cycles", () => {
  const round: LatheSetup = { family: "lathe", length: 80, shape: { kind: "round", diameter: 60 }, chuckZ: -68, chuckRadius: 40, previous: [] };
  const finished = (program: string, setup: LatheSetup, z: number) => {
    const job = prepareSim(program, setup);
    const engine = createEngine(job);
    engine.advanceTo(engine.duration + 1);
    const grid = latheGrid(setup);
    const row = Math.round(-z / grid.dz);
    const state = (engine as unknown as { state: { outer: Float32Array; inner: Float32Array } }).state;
    let outer = Infinity;
    let inner = 0;
    for (let j = 0; j < grid.sectors; j += 1) {
      outer = Math.min(outer, state.outer[row * grid.sectors + j]);
      inner = Math.max(inner, state.inner[row * grid.sectors + j]);
    }
    return { job, outer, inner };
  };

  it("G71 roughs and G70 finishes the stepped shaft from the reference example", () => {
    const program = `G21 G18
M03 S1200
G00 X62 Z2
G71 U2 R0.5 P10 Q20 F0.3
N10 G00 X24
G01 Z-15 F0.15
X36 Z-25
G01 Z-40
X50
N20 G01 Z-60
G70 P10 Q20 F0.12
G00 X100 Z50
M30`;
    expect(finished(program, round, -10).outer).toBeCloseTo(12, 1);
    expect(finished(program, round, -10).job.report.collision).toBeNull();
    expect(finished(program, round, -35).outer).toBeCloseTo(18, 1);
    expect(finished(program, round, -50).outer).toBeCloseTo(25, 1);
    expect(finished(program, round, -70).outer).toBeCloseTo(30, 1);
  });

  it("G90 turns in passes and G94 faces", () => {
    const turn = "G21 G18 G99\nM03 S800\nG00 X42 Z2\nG90 X36 Z-30 F0.2\nX32\nX28\nG00 X100 Z50\nM30";
    expect(finished(turn, round, -10).outer).toBeCloseTo(14, 1);
    expect(finished(turn, round, -33).outer).toBeCloseTo(30, 1);
    const face = "G21 G18 G99\nM03 S800\nG00 X64 Z2\nG94 X0 Z-1 F0.1\nG00 X100 Z50\nM30";
    expect(finished(face, round, 0).outer).toBeCloseTo(0, 1);
    expect(finished(face, round, -3).outer).toBeCloseTo(30, 1);
  });

  it("G76 cuts a thread to the root diameter", () => {
    const thread = "G21 G18 G99\nM03 S600\nG00 X30 Z5\nG76 X27 Z-20 P1500 Q300 F1.5\nG00 X100 Z50\nM30";
    const run = finished(thread, { ...round, shape: { kind: "round", diameter: 30 } }, -10);
    expect(run.job.report.collision).toBeNull();
    expect(run.outer).toBeCloseTo(13.5, 1);
  });

  it("drills a pilot hole and bores it, but refuses a boring bar plunged into solid", () => {
    const rect: LatheSetup = { ...lathe, previous: [original] };
    const good = `O0200
G21 G18 G40 G99
G28 U0 W0
(TOOL DRILL D12)
T0505
G97 S900 M03
G00 X0 Z2.
G01 Z-68.0 F0.12
G00 Z2.
G28 U0 W0
(TOOL BORE D12)
T0303
G97 S1200 M03
G00 X11.0 Z2.
G01 X16.0 F0.1
G01 Z-68.0 F0.12
G01 X15.0
G00 Z2.
G28 U0 W0
M30`;
    const ok = finished(good, rect, -30);
    expect(ok.job.report.collision, ok.job.report.collision?.message).toBeNull();
    expect(ok.inner).toBeCloseTo(8, 1);
    const bad = prepareSim("G21 G18 G99\nT0303\nG97 S900 M03\nG00 X16.0 Z2.\nG01 Z-30.0 F0.12\nG00 Z2.\nM30", rect);
    expect(bad.report.collision?.message).toContain("pilot hole");
  });
});

describe("report statistics", () => {
  it("counts cutting distance, holes, time and the cut box", () => {
    const mill: MillSetup = { family: "mill", x0: 0, y0: 0, length: 60, width: 40, top: 0, bottom: -10, previous: [] };
    const job = prepareSim("(TOOL DRILL D6)\nT03 M06\nS1000 M03\nG00 X0 Y0\nG00 Z50\nG99 G81 X10 Y10 Z-5 R2 F120\nX30 Y10\nG80\nG00 Z50\nM30", mill);
    expect(job.report.holes).toBe(2);
    expect(job.report.cutDistance).toBeCloseTo(14, 0);
    expect(job.report.estimatedSeconds).toBeGreaterThan(5);
    expect(job.report.bbox?.max[0]).toBe(30);
  });
});