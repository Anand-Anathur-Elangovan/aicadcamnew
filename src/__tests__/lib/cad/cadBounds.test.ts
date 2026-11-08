import { describe, expect, it } from "vitest";
import { extractFeaturesFromStep } from "@/lib/cad/featureExtractor";

function stepBox(name: string, x: number, y: number, z: number): string {
  const corners = [
    [0, 0, 0], [x, 0, 0], [0, y, 0], [x, y, 0],
    [0, 0, z], [x, 0, z], [0, y, z], [x, y, z],
  ];
  const points = corners.map((corner, index) =>
    `#${index + 1}=CARTESIAN_POINT('',(${corner[0]},${corner[1]},${corner[2]}));`
  ).join("\n");
  return `ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n#10=PRODUCT('${name}','${name}','',());\n${points}\nENDSEC;\nEND-ISO-10303-21;\n`;
}

describe("3D overall size", () => {
  it("uses the STEP bounding box instead of a stand-in block", () => {
    const features = extractFeaturesFromStep(stepBox("BR-200", 150, 20, 90), "bracket.step");
    expect(features.partName).toBe("BR-200");
    expect(features.rawDimensions).toMatchObject({ length: 150, width: 90, height: 20 });
  });

  it("converts an inch STEP file to millimetres", () => {
    const text = `ISO-10303-21;\nDATA;\n#1=CONVERSION_BASED_UNIT('INCH',#2);\n#3=CARTESIAN_POINT('',(0,0,0));\n#4=CARTESIAN_POINT('',(2,1,0.5));\nENDSEC;`;
    const features = extractFeaturesFromStep(text, "inch-part.stp");
    expect(features.rawDimensions.length).toBeCloseTo(50.8);
    expect(features.rawDimensions.width).toBeCloseTo(25.4);
    expect(features.rawDimensions.height).toBeCloseTo(12.7);
  });

  it("reads IGES points the same way", () => {
    const text = "116,0.0,0.0,0.0;\n116,80.0,10.0,40.0;\n";
    const features = extractFeaturesFromStep(text, "plate.igs");
    expect(features.rawDimensions).toMatchObject({ length: 80, width: 40, height: 10 });
  });

  it("keeps the stand-in size when the file has no points", () => {
    const features = extractFeaturesFromStep("ISO-10303-21;\nDATA;\nENDSEC;", "empty.step");
    expect(features.rawDimensions).toMatchObject({ length: 100, width: 80, height: 30 });
  });
});
