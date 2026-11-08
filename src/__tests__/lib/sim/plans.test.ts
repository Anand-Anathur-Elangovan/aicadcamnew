import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractFeaturesFromStep } from "@/lib/cad/featureExtractor";
import { setupFromPlan } from "@/lib/sim/fromPlan";
import { prepareSim } from "@/lib/sim/prepare";
import { planFromReadings } from "@/lib/studio/featureStages";
import { buildStagePlan, type TurningJob } from "@/lib/studio/stages";

describe("generated programs run clean in the simulator", () => {
  it("bracket stages cut without a collision and the cuts show", () => {
    const features = extractFeaturesFromStep(readFileSync("test/downloads/2-hole-bracket.step", "utf8"), "2-hole-bracket.step");
    const plan = planFromReadings([], [features]);
    plan.stages.forEach((stage, index) => {
      const job = prepareSim(stage.gcode, setupFromPlan(plan, index));
      expect(job.report.collision, `${stage.name}: ${job.report.collision?.message}`).toBeNull();
      expect(job.report.feedMoves, stage.name).toBeGreaterThan(0);
    });
  });

  it("a generic plate with pockets and holes also runs clean", () => {
    const features = extractFeaturesFromStep(readFileSync("test/downloads/2-hole-bracket.step", "utf8"), "x.step");
    features.rawDimensions = { length: 120, width: 80, height: 25 };
    features.features.push(
      { type: "pocket", count: 1, width: 40, length: 50, depth: 8 } as never,
      { type: "hole", count: 4, diameter: 8, depth: 25 } as never,
      { type: "thread", count: 1, diameter: 6 } as never
    );
    const plan = planFromReadings([], [features]);
    plan.stages.forEach((stage, index) => {
      const job = prepareSim(stage.gcode, setupFromPlan(plan, index));
      expect(job.report.collision, `${stage.name}: ${job.report.collision?.message}`).toBeNull();
    });
  });

  it("HC-100 turning plan runs clean on the lathe", () => {
    const job: TurningJob = {
      partName: "Hub",
      partNumber: "HC-100",
      revision: "A",
      material: "EN8",
      stockWidth: 40,
      stockHeight: 40,
      stockLength: 80,
      diameter: 32,
      bore: 16,
      length: 80,
    };
    const plan = buildStagePlan(job, "lathe");
    plan.stages.forEach((stage, index) => {
      const run = prepareSim(stage.gcode, setupFromPlan(plan, index));
      expect(run.report.collision, `${stage.name}: ${run.report.collision?.message}`).toBeNull();
    });
  });
});
