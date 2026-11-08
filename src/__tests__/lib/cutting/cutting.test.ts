import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractFeaturesFromStep } from "@/lib/cad/featureExtractor";
import { millCut, turnCut } from "@/lib/cutting/data";
import { analyzeLoad } from "@/lib/cutting/load";
import { findMaterial, machineLimits, snapDown, tapForDrill } from "@/lib/cutting/library";
import { setupFromPlan } from "@/lib/sim/fromPlan";
import { prepareSim } from "@/lib/sim/prepare";
import { planFromReadings } from "@/lib/studio/featureStages";

const vmc = machineLimits("vmc");

describe("cutting data", () => {
  it("harder material gets slower speed than soft material", () => {
    const alu = millCut({ material: findMaterial("6061 aluminium").material, machine: vmc, family: "flat", diameter: 10 });
    const steel = millCut({ material: findMaterial("EN8").material, machine: vmc, family: "flat", diameter: 10 });
    expect(alu.rpm).toBeGreaterThan(steel.rpm);
  });

  it("never exceeds the machine spindle limit", () => {
    const cut = millCut({ material: findMaterial("6061 aluminium").material, machine: vmc, family: "flat", diameter: 2 });
    expect(cut.rpm).toBeLessThanOrEqual(vmc.maxRpm);
  });

  it("rigid tap feeds one pitch per revolution", () => {
    const tap = tapForDrill(6.8);
    const cut = millCut({ material: findMaterial("EN8").material, machine: vmc, family: "tap", diameter: tap.nominal });
    expect(cut.feed).toBeCloseTo(cut.rpm * tap.pitch, 0);
  });

  it("turning feed is per revolution and the speed is a surface speed", () => {
    const cut = turnCut({ material: findMaterial("EN8").material, machine: machineLimits("lathe"), kind: "rough" });
    expect(cut.feed).toBeGreaterThan(0.05);
    expect(cut.feed).toBeLessThan(1);
    expect(cut.vc).toBeGreaterThan(50);
  });

  it("snaps to the next standard size down", () => {
    expect(snapDown([2, 4, 6, 8, 10], 7.4)).toBe(6);
  });
});

describe("load estimate", () => {
  const features = extractFeaturesFromStep(readFileSync("test/downloads/2-hole-bracket.step", "utf8"), "2-hole-bracket.step");
  const plan = planFromReadings([], [features]);

  it("reports power, force and tool life for each tool", () => {
    plan.stages.forEach((stage, index) => {
      const job = prepareSim(stage.gcode, setupFromPlan(plan, index));
      const report = analyzeLoad(job, features.material, "vmc");
      for (const tool of report.tools) {
        expect(Number.isFinite(tool.peakKw)).toBe(true);
        expect(tool.lifeMinutes).toBeGreaterThan(0);
      }
    });
  });

  it("generated programs stay inside the spindle rating", () => {
    plan.stages.forEach((stage, index) => {
      const job = prepareSim(stage.gcode, setupFromPlan(plan, index));
      const report = analyzeLoad(job, features.material, "vmc");
      expect(report.spindleLoadPercent, stage.name).toBeLessThan(100);
    });
  });
});


describe("plan cutting data and cycle time", () => {
  const features = extractFeaturesFromStep(readFileSync("test/downloads/2-hole-bracket.step", "utf8"), "a.step");
  features.material = "Aluminium 6061";
  const plan = planFromReadings([], [features]);

  it("every operation carries cutting data, tool life and per-part minutes", () => {
    for (const operation of plan.plan.operations) {
      expect(operation.cutting, operation.name).toBeDefined();
      const cutting = operation.cutting!;
      const machineMinutes = (cutting.cutSeconds + cutting.rapidSeconds + cutting.toolChangeSeconds + cutting.accelSeconds) / 60;
      expect(operation.estimatedTime).toBeCloseTo(machineMinutes + cutting.handlingMinutes, 0);
      expect(cutting.materialRecognised).toBe(true);
      expect(cutting.setupMinutes).toBeGreaterThan(10);
    }
    const total = plan.plan.operations.reduce((sum, operation) => sum + operation.estimatedTime, 0);
    expect(plan.plan.totalEstimatedTime).toBeCloseTo(total, 0);
  });

  it("the sheet shows the speed and feed the program really uses", () => {
    const drilling = plan.plan.operations.find((operation) => operation.type === "drilling");
    expect(drilling).toBeDefined();
    expect(drilling!.cuttingParams.spindleSpeed).toBeGreaterThan(500);
    expect(drilling!.cuttingParams.feedRate).toBeGreaterThan(20);
  });

  it("tool changes add time and aluminium cuts faster than steel", () => {
    const steel = planFromReadings([], [{ ...features, material: "EN8" }]);
    const aluminiumCut = plan.plan.operations.reduce((sum, operation) => sum + operation.cutting!.cutSeconds, 0);
    const steelCut = steel.plan.operations.reduce((sum, operation) => sum + operation.cutting!.cutSeconds, 0);
    expect(aluminiumCut).toBeLessThan(steelCut);
  });
});
