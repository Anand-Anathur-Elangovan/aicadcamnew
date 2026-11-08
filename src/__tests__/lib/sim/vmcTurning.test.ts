import { describe, expect, it } from "vitest";
import { createEngine, prepareSim } from "@/lib/sim/prepare";
import { setupFromPlan } from "@/lib/sim/fromPlan";
import { buildStagePlan } from "@/lib/studio/stages";

const job = { partName: "Hub", partNumber: "HC-100", revision: "A", material: "EN8", stockWidth: 40, stockHeight: 40, stockLength: 80, diameter: 32, bore: 16, length: 80 };

function run(stage: number) {
  const plan = buildStagePlan(job, "vmc");
  const sim = prepareSim(plan.stages[stage].gcode, setupFromPlan(plan, stage));
  expect(sim.report.collision, sim.report.collision?.message).toBeNull();
  const engine = createEngine(sim);
  engine.advanceTo(engine.duration + 1);
  const view = engine as unknown as { state: { heights: Float32Array }; grid: { nx: number; cell: number; x0: number; y0: number } };
  return (x: number, y: number): number => {
    const g = view.grid;
    return view.state.heights[Math.floor((y - g.y0) / g.cell) * g.nx + Math.floor((x - g.x0) / g.cell)];
  };
}

describe("VMC turning stages shape the part", () => {
  it("mills the corners away and leaves the round bar standing", () => {
    const heightAt = run(0);
    expect(heightAt(20, 20)).toBeCloseTo(0, 1);
    expect(heightAt(2, 2)).toBeLessThan(-60);
    expect(heightAt(20, 20 + 15)).toBeCloseTo(0, 1);
    expect(heightAt(20, 20 + 17.5)).toBeLessThan(-60);
  });

  it("opens the bore through the centre", () => {
    const heightAt = run(1);
    expect(heightAt(20, 20)).toBeLessThan(-60);
    expect(heightAt(20 + 7, 20)).toBeLessThan(-60);
    expect(heightAt(20 + 10, 20)).toBeCloseTo(0, 1);
  });

  it("refuses a boring head plunged into solid metal and accepts one in a drilled hole", () => {
    const setup = { family: "mill" as const, x0: 0, y0: 0, length: 40, width: 40, top: 0, bottom: -80, previous: [] };
    const bore = "G21 G17 G90\n(TOOL BORE D16)\nT03 M06\nS1200 M03\nG00 X20 Y20\nG43 H03 Z50.\nG99 G85 X20 Y20 Z-30 R2. F80\nG80\nG00 Z50.\nM30";
    const solid = prepareSim(bore, setup);
    expect(solid.report.collision?.kind).toBe("bite");
    expect(solid.report.collision?.message).toContain("drill it");
    const drilled = "G21 G17 G90\n(TOOL DRILL D12)\nT02 M06\nS2200 M03\nG00 X20 Y20\nG43 H02 Z50.\nG99 G81 X20 Y20 Z-34 R2. F120\nG80\nG00 Z50.\n";
    const ok = prepareSim(drilled + bore.split("\n").slice(1).join("\n"), setup);
    expect(ok.report.collision, ok.report.collision?.message).toBeNull();
  });
});