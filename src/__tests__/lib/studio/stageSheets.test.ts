import { describe, expect, it } from "vitest";
import { buildStagePlan, readTurningJob } from "@/lib/studio/stages";
import { buildFeatureStagePlan } from "@/lib/studio/featureStages";
import { bandsawSheet, cncSheet, deburrSheet, packSheet, rawStockSheet, vmcSheet } from "@/lib/studio/stageSheets";
import type { PartFeatures } from "@/lib/cad/featureExtractor";

describe("raw stock sheet", () => {
  it("draws the hollow-cylinder bar before any turning", () => {
    const job = readTurningJob(`
      PART NUMBER: HC-100
      REVISION: A
      MATERIAL: Aluminium 6061-T6
      rectangular bar 40 x 40 x 80
      OUTSIDE DIAMETER: 32
      BORE: 16
      FINISHED LENGTH: 80
    `);
    const sheet = rawStockSheet(buildStagePlan(job!, "lathe"));
    expect(sheet.id).toBe("raw");
    expect(sheet).toMatchObject({
      partNumber: "HC-100",
      material: "Aluminium 6061-T6",
      length: 80,
      width: 40,
      height: 40,
    });
    expect(sheet.note).toContain("before turning");
  });

  it("draws the block for a prismatic part", () => {
    const features: PartFeatures = {
      partName: "Bracket",
      partNumber: "BR-200",
      revision: "B",
      material: "Aluminium 6061-T6",
      rawDimensions: { length: 150, width: 90, height: 20 },
      stockDimensions: { length: 153, width: 93, height: 23 },
      features: [{ type: "hole", count: 4, diameter: 8, depth: 12 }],
      tolerances: [],
      surfaceFinishes: [],
      partType: "prismatic",
      estimatedComplexity: "low",
      sourceFile: "br-200-detail.pdf",
      extractedAt: "2026-11-08T00:00:00.000Z",
      extractionMethod: "pdf_ocr",
    };
    const sheet = rawStockSheet(buildFeatureStagePlan(features));
    expect(sheet).toMatchObject({ partNumber: "BR-200", length: 150, width: 90, height: 20 });
    expect(sheet.note).toContain("before facing");
  });

  it("cuts 3 mm off the incoming bar and keeps the raw blank", () => {
    const job = readTurningJob(`
      PART NUMBER: HC-100
      REVISION: A
      MATERIAL: Aluminium 6061-T6
      rectangular bar 40 x 40 x 80
      OUTSIDE DIAMETER: 32
      BORE: 16
      FINISHED LENGTH: 80
    `);
    const sheet = bandsawSheet(buildStagePlan(job!, "lathe"));
    expect(sheet).toMatchObject({
      id: "bandsaw",
      partNumber: "HC-100",
      incomingLength: 83,
      blankLength: 80,
      width: 40,
      height: 40,
      allowance: 3,
    });
  });

  it("turns only the outside diameter on the CNC sheet", () => {
    const job = readTurningJob(`
      PART NUMBER: HC-100
      REVISION: A
      MATERIAL: Aluminium 6061-T6
      rectangular bar 40 x 40 x 80
      OUTSIDE DIAMETER: 32
      BORE: 16
      FINISHED LENGTH: 80
    `);
    const sheet = cncSheet(buildStagePlan(job!, "lathe"));
    expect(sheet).toMatchObject({ id: "cnc", kind: "turn", diameter: 32, grip: 12, length: 80, height: 40 });
    expect(sheet.note).toContain("bore is not cut");
  });

  it("faces the datum on a prismatic CNC sheet and leaves the holes for later", () => {
    const features: PartFeatures = {
      partName: "Bracket",
      partNumber: "BR-200",
      revision: "B",
      material: "Aluminium 6061-T6",
      rawDimensions: { length: 150, width: 90, height: 20 },
      stockDimensions: { length: 153, width: 93, height: 23 },
      features: [{ type: "hole", count: 4, diameter: 8, depth: 12 }],
      tolerances: [],
      surfaceFinishes: [],
      partType: "prismatic",
      estimatedComplexity: "low",
      sourceFile: "br-200-detail.pdf",
      extractedAt: "2026-11-08T00:00:00.000Z",
      extractionMethod: "pdf_ocr",
    };
    const sheet = cncSheet(buildFeatureStagePlan(features));
    expect(sheet).toMatchObject({ kind: "face", height: 20, facedHeight: 18, diameter: 0 });
    expect(sheet.note).toContain("holes are not cut");
  });

  it("bores the turned cylinder on the VMC sheet", () => {
    const job = readTurningJob(`
      PART NUMBER: HC-100
      REVISION: A
      MATERIAL: Aluminium 6061-T6
      rectangular bar 40 x 40 x 80
      OUTSIDE DIAMETER: 32
      BORE: 16
      FINISHED LENGTH: 80
    `);
    const sheet = vmcSheet(buildStagePlan(job!, "lathe"));
    expect(sheet).toMatchObject({ id: "vmc", kind: "bore", diameter: 32, bore: 16, grip: 12 });
  });

  it("puts the bracket holes on the VMC sheet", () => {
    const features: PartFeatures = {
      partName: "Bracket",
      partNumber: "BR-200",
      revision: "B",
      material: "Aluminium 6061-T6",
      rawDimensions: { length: 150, width: 90, height: 20 },
      stockDimensions: { length: 153, width: 93, height: 23 },
      features: [
        { type: "hole", count: 4, diameter: 8, depth: 12 },
        { type: "pocket", count: 1, depth: 6, width: 30 },
      ],
      tolerances: [],
      surfaceFinishes: [],
      partType: "prismatic",
      estimatedComplexity: "low",
      sourceFile: "br-200-detail.pdf",
      extractedAt: "2026-11-08T00:00:00.000Z",
      extractionMethod: "pdf_ocr",
    };
    const sheet = vmcSheet(buildFeatureStagePlan(features));
    expect(sheet.kind).toBe("features");
    expect(sheet.height).toBe(18);
    expect(sheet.marks).toEqual([
      { kind: "hole", count: 4, diameter: 8, depth: 12, width: 0, length: 0 },
      { kind: "pocket", count: 1, diameter: 0, depth: 6, width: 30, length: 60 },
    ]);
  });

  it("lists the bore edges and the bracket edges that need deburring", () => {
    const job = readTurningJob(`
      PART NUMBER: HC-100
      REVISION: A
      MATERIAL: Aluminium 6061-T6
      rectangular bar 40 x 40 x 80
      OUTSIDE DIAMETER: 32
      BORE: 16
      FINISHED LENGTH: 80
    `);
    const turned = deburrSheet(buildStagePlan(job!, "lathe"));
    expect(turned.id).toBe("deburr");
    expect(turned.edges).toEqual([
      "Bore rim, Ø16 mm, at the open end",
      "Free end of the Ø32 mm diameter",
      "Shoulder where the square grip meets the diameter",
    ]);

    const features: PartFeatures = {
      partName: "Bracket",
      partNumber: "BR-200",
      revision: "B",
      material: "Aluminium 6061-T6",
      rawDimensions: { length: 150, width: 90, height: 20 },
      stockDimensions: { length: 153, width: 93, height: 23 },
      features: [
        { type: "hole", count: 4, diameter: 8, depth: 12 },
        { type: "pocket", count: 1, depth: 6, width: 30 },
      ],
      tolerances: [],
      surfaceFinishes: [],
      partType: "prismatic",
      estimatedComplexity: "low",
      sourceFile: "br-200-detail.pdf",
      extractedAt: "2026-11-08T00:00:00.000Z",
      extractionMethod: "pdf_ocr",
    };
    const bracket = deburrSheet(buildFeatureStagePlan(features));
    expect(bracket.edges).toEqual([
      "Top outside edge of the finished block",
      "Rim of 4 × Ø8 mm holes",
      "Top edge of the 6 mm pocket",
    ]);
  });

  it("packs one finished piece and does not add another cut", () => {
    const job = readTurningJob(`
      PART NUMBER: HC-100
      REVISION: A
      MATERIAL: Aluminium 6061-T6
      rectangular bar 40 x 40 x 80
      OUTSIDE DIAMETER: 32
      BORE: 16
      FINISHED LENGTH: 80
    `);
    const turned = packSheet(buildStagePlan(job!, "lathe"));
    expect(turned).toMatchObject({
      id: "pack",
      partNumber: "HC-100",
      quantity: 1,
      finished: "Ø32 × 80 mm, bore Ø16 mm",
    });
    expect(turned.checks).toHaveLength(3);
    expect(turned.note).toContain("No more cutting");

    const features: PartFeatures = {
      partName: "Bracket",
      partNumber: "BR-200",
      revision: "B",
      material: "Aluminium 6061-T6",
      rawDimensions: { length: 150, width: 90, height: 20 },
      stockDimensions: { length: 153, width: 93, height: 23 },
      features: [{ type: "hole", count: 4, diameter: 8, depth: 12 }],
      tolerances: [],
      surfaceFinishes: [],
      partType: "prismatic",
      estimatedComplexity: "low",
      sourceFile: "br-200-detail.pdf",
      extractedAt: "2026-11-08T00:00:00.000Z",
      extractionMethod: "pdf_ocr",
    };
    const bracket = packSheet(buildFeatureStagePlan(features));
    expect(bracket.finished).toBe("150 × 90 × 18 mm");
    expect(bracket.quantity).toBe(1);
  });
});
