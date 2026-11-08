import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractFeaturesFromStep, type PartFeatures } from "@/lib/cad/featureExtractor";
import { attachEvidence, compareReads, mergeEvidence, numbersOnSheet, ungrounded } from "@/lib/cad/readingEvidence";
import { evidenceNote, hasErrors, reviewEvidence, reviewFeatures } from "@/lib/studio/readingReview";
import { mergePartFeatures } from "@/lib/studio/mergeFeatures";

const base = extractFeaturesFromStep(readFileSync("test/downloads/2-hole-bracket.step", "utf8"), "x.step");

function read(over: Partial<PartFeatures>): PartFeatures {
  return {
    ...base,
    extractionMethod: "ai_vision",
    rawDimensions: { length: 120, width: 80, height: 25 },
    stockDimensions: { length: 123, width: 83, height: 28 },
    features: [{ type: "hole", count: 4, diameter: 8, depth: 25 }],
    ...over,
  };
}

const SHEET = `DRAWING P/N BR-100 REV B  MATERIAL 6061-T6
RAW STOCK 120 x 80 x 25
4 HOLES Ø8 THRU
ALL DIMENSIONS IN MM  Ra 3.2`;

describe("sheet numbers", () => {
  it("collects printed numbers, sizes and diameters", () => {
    const numbers = numbersOnSheet(SHEET);
    for (const value of [120, 80, 25, 4, 8, 3.2, 6061]) expect(numbers).toContain(value);
    expect(numbers).not.toContain(32);
  });
  it("reads comma decimals", () => {
    expect(numbersOnSheet("DIA 12,5 DEEP 7")).toEqual(expect.arrayContaining([12.5, 7]));
  });
});

describe("grounding a reading against the sheet text", () => {
  it("accepts values printed on the sheet", () => {
    const features = attachEvidence(read({}), SHEET);
    expect(ungrounded(features)).toEqual([]);
    expect(features.evidence?.conflicts).toEqual([]);
    expect(reviewEvidence(features).filter((issue) => issue.level === "warning")).toEqual([]);
  });

  it("catches a plausible value that is not on the sheet", () => {
    const features = attachEvidence(read({ features: [{ type: "hole", count: 4, diameter: 9, depth: 25 }] }), SHEET);
    expect(ungrounded(features).map((claim) => claim.label)).toEqual(["hole 1 diameter"]);
    const issues = reviewFeatures(features);
    expect(issues.some((issue) => /Not printed anywhere/.test(issue.message) && /hole 1 diameter 9/.test(issue.message))).toBe(true);
    expect(evidenceNote(features)).toMatch(/not yet checked/);
  });

  it("catches a size and a hole count that disagree with the text", () => {
    const features = attachEvidence(read({ rawDimensions: { length: 120, width: 80, height: 20 }, features: [{ type: "hole", count: 3, diameter: 8, depth: 20 }] }), SHEET);
    const conflicts = features.evidence?.conflicts ?? [];
    expect(conflicts.some((text) => /prints a size of 120 x 80 x 25/.test(text))).toBe(true);
    expect(conflicts.some((text) => /mentions 4 holes, but the reading has 3/.test(text))).toBe(true);
  });

  it("says plainly when there is no text to check against", () => {
    const features = attachEvidence(read({}), "");
    const issues = reviewEvidence(features);
    expect(issues[0].level).toBe("warning");
    expect(issues[0].message).toMatch(/no readable text/);
  });

  it("flags the default stock size of a sheet with no text", () => {
    const features = attachEvidence(read({ extractionMethod: "pdf_ocr", rawDimensions: { length: 100, width: 80, height: 30 } }), "");
    expect(reviewEvidence(features).some((issue) => /default/.test(issue.message))).toBe(true);
  });

  it("stops warning once the user confirms, and never nags about model files", () => {
    const features = attachEvidence(read({ features: [{ type: "hole", count: 4, diameter: 9 }] }), SHEET);
    const confirmed = { ...features, evidence: { ...features.evidence!, confirmed: true } };
    expect(reviewEvidence(confirmed)).toEqual([{ level: "info", message: "You confirmed these values against the sheet." }]);
    expect(evidenceNote(confirmed)).toBeNull();
    expect(reviewEvidence({ ...features, extractionMethod: "step_parse" })).toEqual([]);
    expect(hasErrors(reviewFeatures(confirmed))).toBe(false);
  });
});

describe("two independent reads", () => {
  it("lists what they disagree on and stays quiet when they agree", () => {
    const first = read({});
    expect(compareReads(first, read({}))).toEqual([]);
    const second = read({ rawDimensions: { length: 120, width: 80, height: 30 }, features: [{ type: "hole", count: 6, diameter: 8, depth: 25 }], material: "Steel" });
    const found = compareReads({ ...first, material: "Aluminium" }, second);
    expect(found.some((text) => /stock height: 25 and 30/.test(text))).toBe(true);
    expect(found.some((text) => /hole/.test(text))).toBe(true);
    expect(found.some((text) => /material/.test(text))).toBe(true);
  });
});

describe("evidence across several sheets", () => {
  it("is merged and survives merging the features", () => {
    const a = attachEvidence(read({}), SHEET);
    const b = attachEvidence(read({}), "SECTION A-A 45 degrees  Ø8  scale 1:1 detail view of the part");
    const merged = mergePartFeatures([a, b]);
    expect(merged.evidence?.sheetText).toBe(true);
    expect(merged.evidence?.numbers).toEqual(expect.arrayContaining([120, 45]));
    expect(mergeEvidence([undefined, undefined])).toBeUndefined();
  });
});
