import { describe, expect, it } from "vitest";
import { latheGrid } from "@/lib/sim/latheEngine";
import { createEngine, prepareSim } from "@/lib/sim/prepare";
import type { LatheSetup } from "@/lib/sim/types";

const round: LatheSetup = { family: "lathe", length: 80, shape: { kind: "round", diameter: 60 }, chuckZ: -68, chuckRadius: 40, previous: [] };

function finished(program: string, setup: LatheSetup, z: number) {
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
}

describe("lathe cycles G72 to G75 and G92", () => {
  it("G72 faces the stepped shaft in passes along X", () => {
    const program = `G21 G18
M03 S1200
G00 X62 Z2
G72 W2 R0.5
G72 P10 Q20 F0.3
N10 G00 Z0
G01 X30 F0.15
Z-15
X50
Z-40
N20 G01 X62
G70 P10 Q20
G00 X100 Z50
M30`;
    const run = finished(program, round, -5);
    expect(run.job.report.collision, run.job.report.collision?.message).toBeNull();
    expect(run.job.report.warnings).toEqual([]);
    expect(run.outer).toBeCloseTo(15, 1);
    expect(finished(program, round, -14.5).outer).toBeCloseTo(15, 1);
    expect(finished(program, round, -25).outer).toBeCloseTo(25, 1);
    expect(finished(program, round, -50).outer).toBeCloseTo(30, 1);
  });

  it("G73 repeats the contour in shrinking passes and G70 finishes it", () => {
    const roughOnly = `G21 G18
M03 S1200
G00 X62 Z2
G73 U5 W0 R4
G73 P10 Q20 U0.4 W0 F0.3
N10 G00 X20 Z1
G01 Z-20 F0.2
X40 Z-30
Z-50
N20 X62
G00 X100 Z50
M30`;
    const rough = finished(roughOnly, round, -10);
    expect(rough.job.report.collision, rough.job.report.collision?.message).toBeNull();
    expect(rough.outer).toBeGreaterThan(10.1);
    expect(rough.outer).toBeLessThan(10.5);
    const finishedProgram = roughOnly.replace("G00 X100 Z50", "G70 P10 Q20\nG00 X100 Z50");
    const done = finished(finishedProgram, round, -10);
    expect(done.job.report.collision, done.job.report.collision?.message).toBeNull();
    expect(done.outer).toBeCloseTo(10, 1);
    expect(finished(finishedProgram, round, -45).outer).toBeCloseTo(20, 1);
    expect(done.job.report.feedMoves).toBeGreaterThan(8);
  });

  it("G74 peck-drills the centre with a drill", () => {
    const program = `G21 G18 G99
(TOOL DRILL D10)
T0505
G97 S900 M03
G00 X0 Z2
G74 R0.5
G74 Z-30 Q5000 F0.1
G00 X100 Z50
M30`;
    const run = finished(program, round, -15);
    expect(run.job.report.collision, run.job.report.collision?.message).toBeNull();
    expect(run.inner).toBeCloseTo(5, 1);
    expect(finished(program, round, -35).inner).toBeCloseTo(0, 1);
    expect(run.job.report.feedMoves).toBeGreaterThanOrEqual(6);
  });

  it("G75 cuts an outside groove in steps and shifts along Z", () => {
    const program = `G21 G18 G99
M03 S800
G00 X62 Z-20
G75 R0.5
G75 X50 Z-26 P2000 Q3000 F0.05
G00 X100 Z50
M30`;
    const run = finished(program, round, -23);
    expect(run.job.report.collision, run.job.report.collision?.message).toBeNull();
    expect(run.outer).toBeCloseTo(25, 1);
    expect(finished(program, round, -8).outer).toBeCloseTo(30, 1);
    expect(run.job.report.warnings).toEqual([]);
  });

  it("G92 cuts a thread one pass per line and keeps Z until changed", () => {
    const program = `G21 G18 G99
M03 S600
G00 X30 Z5
G92 X29 Z-20 F1.5
X28.5
X28
G00 X100 Z50
M30`;
    const run = finished(program, { ...round, shape: { kind: "round", diameter: 30 } }, -10);
    expect(run.job.report.collision, run.job.report.collision?.message).toBeNull();
    expect(run.outer).toBeCloseTo(14, 1);
    expect(run.job.report.warnings).toEqual([]);
  });
});
