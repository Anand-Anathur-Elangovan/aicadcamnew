import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractFeaturesFromStep } from "@/lib/cad/featureExtractor";
import { planFromReadings } from "@/lib/studio/featureStages";
import { cncSheet, deburrSheet, packSheet, vmcSheet } from "@/lib/studio/stageSheets";

const file = "test/downloads/2-hole-bracket.step";

describe("downloaded Totem 2-hole bracket", () => {
  const text = readFileSync(file, "utf8");
  const features = extractFeaturesFromStep(text, "2-hole-bracket.step");
  const plan = planFromReadings([], [features]);

  it("keeps the real plate thickness after the face cut", () => {
    expect(features.partName).toBe("2-hole bracket");
    expect(features.rawDimensions).toEqual({ length: 21.1, width: 6, height: 2 });
    expect(features.partType).toBe("prismatic");
    expect(cncSheet(plan).facedHeight).toBe(1.8);
    expect(packSheet(plan).finished).toBe("21.1 × 6 × 1.8 mm");
  });

  it("puts the hole and the slot on the VMC and deburr sheets", () => {
    const hole = features.features.find((feature) => feature.type === "hole");
    const slot = features.features.find((feature) => feature.type === "slot");
    expect(hole).toMatchObject({ count: 1, diameter: 3.1, depth: 2 });
    expect(hole?.along).toBeCloseTo(18.55 / 21.1, 2);
    expect(hole?.across).toBeCloseTo(0.5, 2);
    expect(slot).toMatchObject({ count: 1, width: 3.1, length: 11.1, depth: 2, run: "length" });
    expect(slot?.across).toBeCloseTo(0.5, 2);
    expect(plan.selectedMachine).toBe("vmc");
    expect(plan.stages.map((stage) => stage.name)).toEqual([
      "Face the datum",
      "Profile the outline",
      "Machine slots",
      "Drill holes",
      "Deburr",
    ]);
    const marks = vmcSheet(plan).marks;
    expect(marks.find((mark) => mark.kind === "hole")).toMatchObject({ count: 1, diameter: 3.1, depth: 1.8 });
    expect(marks.find((mark) => mark.kind === "slot")).toMatchObject({ width: 3.1, length: 11.1, depth: 1.8 });
    const edges = deburrSheet(plan).edges.join(" ");
    expect(edges).toContain("Ø3.1");
    expect(edges).toContain("3.1 mm slot");
  });
});
