import { describe, expect, it } from "vitest";
import type { PartFeatures } from "@/lib/cad/featureExtractor";
import { planFromReadings, rebuildStagePlan } from "@/lib/studio/featureStages";
import { mergePartFeatures } from "@/lib/studio/mergeFeatures";

function sheet(overrides: Partial<PartFeatures>): PartFeatures {
  return {
    partName: "Bracket",
    partNumber: "UNKNOWN",
    revision: "A",
    material: "UNKNOWN",
    rawDimensions: { length: 0, width: 0, height: 0 },
    stockDimensions: { length: 0, width: 0, height: 0 },
    features: [],
    tolerances: [],
    surfaceFinishes: [],
    partType: "prismatic",
    estimatedComplexity: "low",
    sourceFile: "sheet.pdf",
    extractedAt: "2026-11-08T00:00:00.000Z",
    extractionMethod: "pdf_ocr",
    ...overrides,
  };
}

const TURNING = `
PART NUMBER: HC-100
REVISION: A
MATERIAL: Aluminium 6061-T6
STOCK: rectangular bar 40 x 40 x 80 mm
FINISHED OUTSIDE DIAMETER: 32 mm
BORE: 16 mm through
FINISHED LENGTH: 80 mm
`;

describe("complicated drawings", () => {
  it("keeps the hollow-cylinder sample on the turning player", () => {
    const plan = planFromReadings([TURNING], []);
    expect(plan.family).toBe("turning");
    expect(plan.stages.map((stage) => stage.name)).toEqual(["Turn outside diameter", "Bore the hole"]);
  });

  it("merges several sheets of one part", () => {
    const merged = mergePartFeatures([
      sheet({
        sourceFile: "detail.pdf",
        features: [{ type: "hole", count: 4, diameter: 8, depth: 12 }],
      }),
      sheet({
        partNumber: "BR-200",
        material: "Aluminium 6061-T6",
        sourceFile: "section.pdf",
        rawDimensions: { length: 150, width: 90, height: 20 },
        features: [
          { type: "hole", count: 2, diameter: 8, depth: 12 },
          { type: "hole", count: 2, diameter: 10, depth: 12 },
          { type: "pocket", count: 1, depth: 6, width: 30 },
        ],
      }),
    ]);
    expect(merged.partNumber).toBe("BR-200");
    expect(merged.material).toBe("Aluminium 6061-T6");
    expect(merged.rawDimensions).toMatchObject({ length: 150, width: 90, height: 20 });
    expect(merged.sourceFile).toBe("detail.pdf, section.pdf");
    expect(merged.features.find((feature) => feature.diameter === 8)?.count).toBe(4);
    expect(merged.features.find((feature) => feature.diameter === 10)?.count).toBe(2);
    expect(merged.features.some((feature) => feature.type === "pocket")).toBe(true);
  });

  it("plans a stage for each kind of feature and keeps earlier cuts", () => {
    const plan = planFromReadings([], [
      sheet({
        partNumber: "BR-200",
        rawDimensions: { length: 150, width: 90, height: 20 },
        features: [
          { type: "hole", count: 6, diameter: 8, depth: 12 },
          { type: "pocket", count: 1, depth: 6, width: 30 },
        ],
      }),
    ]);
    expect(plan.family).toBe("machined");
    expect(plan.selectedMachine).toBe("vmc");
    const names = plan.stages.map((stage) => stage.name);
    expect(names).toEqual(["Face the datum", "Machine pockets", "Drill holes", "Deburr"]);
    const drill = plan.stages.find((stage) => stage.name === "Drill holes");
    expect(drill?.completed?.some((cut) => cut.kind === "pocket")).toBe(true);
    expect(drill?.completed?.some((cut) => cut.kind === "hole" && cut.count === 6)).toBe(true);
    expect(drill?.gcode).toContain("OP30");
  });

  it("recommends a 5-axis machine for a complicated part and lets the user pick a VMC", () => {
    const features = sheet({
      partType: "complex",
      estimatedComplexity: "high",
      features: [
        { type: "profile", count: 1 },
        { type: "pocket", count: 2 },
        { type: "hole", count: 8, diameter: 6 },
        { type: "thread", count: 4, diameter: 6 },
      ],
    });
    const plan = planFromReadings([], [features]);
    expect(plan.selectedMachine).toBe("vmc5");
    expect(plan.stages.map((stage) => stage.name)).toContain("Tap threads");
    const vmc = rebuildStagePlan(plan, "vmc");
    expect(vmc.selectedMachine).toBe("vmc");
    expect(vmc.stages[0].fixture).toBe("Machine vice");
    expect(vmc.stages.map((stage) => stage.name)).toEqual(plan.stages.map((stage) => stage.name));
  });
});
