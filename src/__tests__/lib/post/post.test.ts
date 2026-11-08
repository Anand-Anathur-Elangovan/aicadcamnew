import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractFeaturesFromStep } from "@/lib/cad/featureExtractor";
import { lintPosted, postProcess } from "@/lib/post";
import { planFromReadings } from "@/lib/studio/featureStages";

const features = extractFeaturesFromStep(readFileSync("test/downloads/2-hole-bracket.step", "utf8"), "a.step");
features.features.push({ type: "thread", count: 1, diameter: 6 } as never);
const plan = planFromReadings([], [features]);
const drill = plan.stages.find((stage) => /G8[34]/.test(stage.gcode));

const MILL = `%
O0010 (T OP10)
G21 G17 G90 G40 G49
(TOOL DRILL D6.8)
T01 M06
S2000 M03
G00 X10 Y10
G43 H01 Z50.
G99 G83 X10 Y10 Z-20 R2 Q6.8 F200
X30 Y10
G80
G00 Z50.
M05
M30
%
`;

const TAP = `%
O0020 (T OP20)
G21 G17 G90 G40 G49
T02 M06
S500 M03
G43 H02 Z50.
G99 G84 X10 Y10 Z-12 R2 F625
G80
M30
%
`;

describe("post-processors", () => {
  it("fanuc keeps ISO text and adds safe start and homing", () => {
    const { text } = postProcess(MILL, { controller: "fanuc", kind: "mill" });
    expect(text).toContain("G80 G54");
    expect(text).toContain("G91 G28 Z0");
    expect(text).toContain("G83");
    expect(lintPosted(text, "fanuc")).toEqual([]);
  });

  it("haas uses G53 homing, five digit O number and M29 before rigid tap", () => {
    const { text } = postProcess(TAP, { controller: "haas", kind: "mill" });
    expect(text).toContain("O00020");
    expect(text).toContain("G53 G49 Z0");
    expect(text.indexOf("M29 S500")).toBeGreaterThan(-1);
    expect(text.indexOf("M29 S500")).toBeLessThan(text.indexOf("G84"));
    expect(lintPosted(text, "haas")).toEqual([]);
  });

  it("siemens converts canned cycles to CYCLE calls with a stack ended by MCALL", () => {
    const { text } = postProcess(MILL, { controller: "siemens", kind: "mill" });
    expect(text).toContain("MCALL CYCLE83(50,0,2,-20");
    expect(text).not.toMatch(/\bG8[0-9]\b/);
    expect(text).not.toMatch(/G43|\bH01/);
    expect(text).toContain("; TOOL DRILL D6.8");
    expect(text.trim().endsWith("M30")).toBe(true);
    expect(lintPosted(text, "siemens")).toEqual([]);
    expect(text.split("\n").filter((line) => line === "MCALL")).toHaveLength(1);
  });

  it("siemens tap pitch comes from feed over speed", () => {
    const { text } = postProcess(TAP, { controller: "siemens", kind: "mill" });
    expect(text).toContain("CYCLE84(50,0,2,-12,,0,3,,1.25");
  });

  it("warns when the program asks for more rpm than the machine has", () => {
    const { warnings } = postProcess(MILL, { controller: "fanuc", kind: "mill", maxRpm: 1500 });
    expect(warnings.join(" ")).toContain("2000 rpm");
  });

  it("every generated stage posts for every controller without leaving Fanuc cycles in Siemens", () => {
    expect(drill).toBeDefined();
    for (const stage of plan.stages) {
      for (const controller of ["fanuc", "haas", "siemens"] as const) {
        const result = postProcess(stage.gcode, { controller, kind: "mill" });
        expect(result.text.length).toBeGreaterThan(20);
        expect(lintPosted(result.text, controller), `${stage.name} ${controller}`).toEqual([]);
      }
    }
  });

  it("lathe programs post with CSS and a spindle limit", () => {
    const lathe = `%
O0100 (X OP10)
G21 G18 G40 G99
G28 U0 W0
T0101
G50 S3000
G96 S180 M03
G01 X40 F0.12
M30
%
`;
    const siemens = postProcess(lathe, { controller: "siemens", kind: "lathe" }).text;
    expect(siemens).toContain("LIMS=3000");
    expect(siemens).toContain("G96 S180 M3");
    expect(siemens).toContain("G74 X1=0 Z1=0");
    expect(postProcess(lathe, { controller: "haas", kind: "lathe" }).text).toContain("G53 X0");
  });
});
