import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractFeaturesFromStep } from "@/lib/cad/featureExtractor";
import { verifyPlan } from "@/lib/sim/verifyPlan";
import { buildFeatureStagePlan } from "@/lib/studio/featureStages";
import { hasErrors, reviewFeatures, reviewPlan, reviewTurning } from "@/lib/studio/readingReview";
import { buildStagePlan, type TurningJob } from "@/lib/studio/stages";

const bracket = extractFeaturesFromStep(readFileSync("test/downloads/2-hole-bracket.step", "utf8"), "x.step");

const job: TurningJob = { partName: "Hub", partNumber: "HC-100", revision: "A", material: "EN8", stockWidth: 40, stockHeight: 40, stockLength: 80, diameter: 32, bore: 16, length: 80 };

describe("drawing reading review", () => {
  it("accepts a complete turning reading", () => {
    expect(reviewTurning(job)).toEqual([]);
  });

  it("stops a turning reading that cannot be made", () => {
    expect(hasErrors(reviewTurning({ ...job, diameter: 45 }))).toBe(true);
    expect(hasErrors(reviewTurning({ ...job, bore: 33 }))).toBe(true);
    expect(hasErrors(reviewTurning({ ...job, length: 90 }))).toBe(true);
    expect(reviewTurning({ ...job, diameter: 20, bore: 18 }).some((issue) => /wall/.test(issue.message))).toBe(true);
  });

  it("warns about missing sizes and holes that do not fit", () => {
    const part = { ...bracket, rawDimensions: { length: 0, width: 0, height: 0 }, partNumber: "UNKNOWN", features: [{ type: "hole" as const, count: 2 }, { type: "hole" as const, count: 1, diameter: 90, depth: 10 }] };
    const issues = reviewFeatures(part);
    expect(issues.some((issue) => /full stock size/.test(issue.message))).toBe(true);
    expect(issues.some((issue) => /part number/.test(issue.message))).toBe(true);
    expect(issues.some((issue) => /no diameter/.test(issue.message))).toBe(true);
    expect(hasErrors(issues)).toBe(true);
  });

  it("rebuilding after the user corrects a reading gives programs that run clean", () => {
    const broken = {
      ...bracket,
      rawDimensions: { length: 60, width: 40, height: 15 },
      stockDimensions: { length: 60, width: 40, height: 15 },
      features: [{ type: "hole" as const, count: 2, diameter: 60, depth: 15 }],
    };
    expect(hasErrors(reviewPlan(buildFeatureStagePlan(broken)))).toBe(true);
    const fixed = buildFeatureStagePlan({ ...broken, features: [{ type: "hole", count: 2, diameter: 8, depth: 15 }] });
    expect(hasErrors(reviewPlan(fixed))).toBe(false);
    for (const check of verifyPlan(fixed)) expect(check.ok, `${check.name}: ${check.problem}`).toBe(true);
  });

  it("reviews the plan of the active family", () => {
    expect(reviewPlan(buildStagePlan(job, "lathe"))).toEqual([]);
  });
});
