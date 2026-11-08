import { describe, expect, it } from "vitest";
import { extractFeatures, isReadableDrawingText } from "@/lib/cad/featureExtractor";
import { featuresFromDrawingJson } from "@/lib/cad/drawingRead";

describe("Studio drawing read", () => {
  it("maps only the fields the sheet returned", () => {
    const features = featuresFromDrawingJson(
      '{"partName":"Wall Bracket","partNumber":"WB-100","revision":"REV00","material":"Cast Steel","partType":"prismatic","features":[{"type":"hole","count":4,"diameter":8},{"type":"weld","count":2}]}',
      "newdrawing.pdf"
    );
    expect(features?.partNumber).toBe("WB-100");
    expect(features?.material).toBe("Cast Steel");
    expect(features?.revision).toBe("REV00");
    expect(features?.features.map((feature) => feature.type)).toEqual(["hole"]);
    expect(features?.extractionMethod).toBe("ai_vision");
  });

  it("does not reuse the revision as the part number", () => {
    const features = featuresFromDrawingJson(
      '{"partName":"Wall Bracket","partNumber":"REV00","revision":"REV00","material":"Cast Steel"}',
      "newdrawing.pdf"
    );
    expect(features?.partNumber).toBe("UNKNOWN");
    expect(features?.revision).toBe("REV00");
  });

  it("does not treat a sheet size as the part number", () => {
    const features = featuresFromDrawingJson(
      '{"partName":"Wall Bracket","partNumber":"A4 - 1 / 21","revision":"REV00","material":"Cast Steel"}',
      "newdrawing.pdf"
    );
    expect(features?.partNumber).toBe("UNKNOWN");
  });

  it("does not treat a raw image buffer as drawing text", () => {
    const buffer = Buffer.from([0, 255, 1, 2, 3, 4, 10, 13, 80, 75, 0, 8]);
    expect(isReadableDrawingText(buffer.toString("utf-8"))).toBe(false);
    const features = extractFeatures(buffer, "image/jpeg", "photo.jpg");
    expect(features.features).toEqual([]);
    expect(features.material).toBe("UNKNOWN");
  });
});
