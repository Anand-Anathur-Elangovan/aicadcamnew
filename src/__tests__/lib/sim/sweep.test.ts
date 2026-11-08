import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractFeaturesFromStep, type MachiningFeature } from "@/lib/cad/featureExtractor";
import { verifyPlan } from "@/lib/sim/verifyPlan";
import { planFromReadings } from "@/lib/studio/featureStages";
import { buildStagePlan, type TurningJob } from "@/lib/studio/stages";

const bracket = extractFeaturesFromStep(readFileSync("test/downloads/2-hole-bracket.step", "utf8"), "x.step");

function machined(dims: { length: number; width: number; height: number }, features: Partial<MachiningFeature>[]) {
  const part = {
    ...bracket,
    rawDimensions: dims,
    stockDimensions: dims,
    features: features.map((feature) => ({ count: 1, ...feature }) as MachiningFeature),
  };
  return planFromReadings([], [part]);
}

const cases: [string, ReturnType<typeof machined>][] = [
  ["thin bracket as read from the STEP file", planFromReadings([], [bracket])],
  ["plate with a pocket and four holes", machined({ length: 120, width: 80, height: 25 }, [{ type: "pocket", width: 40, length: 50, depth: 8 }, { type: "hole", count: 4, diameter: 8, depth: 25 }])],
  ["plate with a slot and a tapped hole", machined({ length: 100, width: 60, height: 20 }, [{ type: "slot", width: 10, length: 50, depth: 6 }, { type: "hole", count: 2, diameter: 6.8, depth: 14 }, { type: "thread", diameter: 8 }])],
  ["small block with two pockets", machined({ length: 60, width: 40, height: 15 }, [{ type: "pocket", count: 2, width: 12, length: 14, depth: 5 }])],
  ["six holes in a thick block", machined({ length: 150, width: 100, height: 40 }, [{ type: "hole", count: 6, diameter: 10, depth: 40 }])],
  ["blind holes deeper than three diameters", machined({ length: 80, width: 50, height: 30 }, [{ type: "hole", count: 3, diameter: 5, depth: 22 }])],
  ["profile part with a bore", machined({ length: 70, width: 70, height: 30 }, [{ type: "profile" }, { type: "bore", diameter: 20, depth: 30 }])],
];

describe("generated mill programs", () => {
  it.each(cases)("%s runs without a collision and each cutting stage removes metal", (_name, plan) => {
    const checks = verifyPlan(plan);
    for (const check of checks) {
      expect(check.ok, `${check.name}: ${check.problem}`).toBe(true);
      expect(check.warnings, check.name).toEqual([]);
      if (/face|pocket|slot|drill|bore|deburr/i.test(check.name)) {
        expect(check.cutCells, `${check.name} removed nothing`).toBeGreaterThan(0);
      }
    }
  });
});

describe("generated turning programs", () => {
  const jobs: TurningJob[] = [
    { partName: "Hub", partNumber: "HC-100", revision: "A", material: "EN8", stockWidth: 40, stockHeight: 40, stockLength: 80, diameter: 32, bore: 16, length: 80 },
    { partName: "Sleeve", partNumber: "SL-200", revision: "B", material: "EN8", stockWidth: 50, stockHeight: 50, stockLength: 100, diameter: 45, bore: 20, length: 100 },
    { partName: "Bush", partNumber: "BU-300", revision: "A", material: "Brass", stockWidth: 30, stockHeight: 30, stockLength: 60, diameter: 25, bore: 6, length: 60 },
  ];
  it.each(jobs)("$partNumber turns and bores clean on the lathe", (job) => {
    const checks = verifyPlan(buildStagePlan(job, "lathe"));
    for (const check of checks) {
      expect(check.ok, `${check.name}: ${check.problem}`).toBe(true);
      expect(check.cutCells, `${check.name} removed nothing`).toBeGreaterThan(0);
    }
  });

  it.each(jobs)("$partNumber is milled round and drilled clean on a VMC", (job) => {
    const checks = verifyPlan(buildStagePlan(job, "vmc"));
    expect(checks).toHaveLength(2);
    for (const check of checks) {
      expect(check.ok, `${check.name}: ${check.problem}`).toBe(true);
      expect(check.warnings, check.name).toEqual([]);
      expect(check.cutCells, `${check.name} removed nothing`).toBeGreaterThan(0);
    }
  });
});
