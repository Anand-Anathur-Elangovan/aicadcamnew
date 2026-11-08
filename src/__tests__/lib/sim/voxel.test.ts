import { describe, expect, it } from "vitest";
import { UP, axisFromRotary } from "@/lib/sim/axes";
import { interpretProgram } from "@/lib/sim/interpret";
import { createEngine, prepareSim } from "@/lib/sim/prepare";
import type { MillSetup } from "@/lib/sim/types";
import { VoxelEngine } from "@/lib/sim/voxelEngine";

const block = (previous: string[] = []): MillSetup => ({ family: "mill", x0: 0, y0: 0, length: 60, width: 40, top: 0, bottom: -20, previous });

const SLOT = `(TOOL FLAT D10)
T01 M06
S3000 M03
G00 X-15 Y20 Z5
G01 Z-18 F300
G01 X75 F300
G00 Z50
`;

const UNDERCUT = `(TOOL TSLOT D20 W3 N8)
T02 M06
S2000 M03
G00 X-15 Y20 Z5
G00 Z-12
G01 X75 F200
G00 Z50
`;

function finish(text: string, previous: string[] = []) {
  const job = prepareSim(text, block(previous));
  const engine = createEngine(job) as unknown as VoxelEngine;
  engine.advanceTo(engine.duration + 1);
  return { job, engine };
}

describe("tool axis", () => {
  it("rotary words give the tool axis", () => {
    expect(axisFromRotary(0, 0, 0)).toEqual(UP);
    const a = axisFromRotary(90, 0, 0);
    expect(a[1]).toBeCloseTo(-1);
    const b = axisFromRotary(0, 90, 0);
    expect(b[0]).toBeCloseTo(1);
    const c = axisFromRotary(30, 0, 90);
    expect(Math.hypot(...c)).toBeCloseTo(1);
  });

  it("the interpreter attaches the axis to moves and flags the program", () => {
    const program = interpretProgram("G90\nG00 X0 Y0 Z5 A-30\nG01 Z-5 F100\n", { home: [0, 0, 50] });
    expect(program.multiAxis).toBe(true);
    expect(program.motions.some((motion) => motion.axisTo && motion.axisTo[1] > 0.4)).toBe(true);
    expect(interpretProgram("G90\nG00 X0 Y0 Z5\nG01 Z-5 F100\n", { home: [0, 0, 50] }).multiAxis).toBe(false);
  });

  it("a rotary-only line becomes a move", () => {
    const program = interpretProgram("G90\nG00 X0 Y0 Z5\nG00 A45\n", { home: [0, 0, 50] });
    const turn = program.motions.find((motion) => motion.axisTo);
    expect(turn).toBeDefined();
    expect(turn!.from).toEqual(turn!.to);
  });
});

describe("voxel engine", () => {
  it("uses the solid model only when the program needs it", () => {
    expect(prepareSim("G90\n(TOOL FLAT D6)\nT01 M06\nS3000 M03\nG00 X10 Y10 Z5\nG01 Z-2 F100\n", block()).initial.family).toBe("mill");
    expect(prepareSim(SLOT + UNDERCUT, block()).initial.family).toBe("voxel");
  });

  it("a T-slot cutter makes an undercut that a height map cannot hold", () => {
    const { job, engine } = finish(SLOT + UNDERCUT);
    expect(job.report.collision, job.report.collision?.message).toBeNull();
    // Inside the slot width the metal is gone. Beside the slot, at the cutter depth, the undercut is open.
    expect(engine.isSolid(30, 20, -10.5)).toBe(false);
    expect(engine.isSolid(30, 27, -10.5)).toBe(false);
    expect(engine.isSolid(30, 12, -10.5)).toBe(false);
    // Above and below the undercut the metal stays, so the cavity is hidden under a roof.
    expect(engine.isSolid(30, 27, -5)).toBe(true);
    expect(engine.isSolid(30, 27, -15)).toBe(true);
    // Beyond the cutter radius nothing was touched.
    expect(engine.isSolid(30, 36, -10.5)).toBe(true);
  });

  it("the neck of a T-slot cutter crashes if there is no slot to carry it", () => {
    const job = prepareSim(UNDERCUT, block());
    expect(job.report.collision?.kind).toBe("holder");
    expect(job.report.collision?.message).toMatch(/neck/);
  });

  it("a neck wider than the slot crashes", () => {
    const wide = UNDERCUT.replace("N8", "N14");
    const job = prepareSim(SLOT + wide, block());
    expect(job.report.collision?.kind).toBe("holder");
  });

  it("a rapid move into the stock is caught", () => {
    const job = prepareSim("G90\n(TOOL FLAT D6)\nT01 M06\nS3000 M03\nG00 X30 Y20 Z5\nG00 Z-8 A20\n", block());
    expect(job.report.collision?.kind).toBe("rapid");
  });

  it("a tilted tool cuts an angled hole", () => {
    const text = `G90
(TOOL FLAT D8)
T01 M06
S3000 M03
G00 X30 Y30 Z5 A-30
G01 X30 Y20 Z-12.32 F200
G00 X30 Y30 Z5
G00 A0 Z50
`;
    const { job, engine } = finish(text);
    expect(job.report.collision, job.report.collision?.message).toBeNull();
    // The hole leans toward -Y as it goes down, so at Z-6 its centre is near Y23.6 and not Y30.
    expect(engine.isSolid(30, 23.65, -6)).toBe(false);
    expect(engine.isSolid(30, 30, -6)).toBe(true);
    expect(engine.removed).toBeGreaterThan(100);
  });

  it("lifting a tilted tool straight up inside its own hole is a crash", () => {
    const text = "G90\n(TOOL FLAT D8)\nT01 M06\nS3000 M03\nG00 X30 Y30 Z5 A-30\nG01 X30 Y20 Z-12.32 F200\nG00 Z50\n";
    expect(prepareSim(text, block()).report.collision?.kind).toBe("rapid");
  });

  it("simultaneous rotary and linear motion runs and removes metal", () => {
    const text = `G90
(TOOL BALL D8)
T01 M06
S3000 M03
G00 X10 Y20 Z5 A0
G01 Z-2 F200
G01 X50 Y20 Z-2 A40 F300
G00 Z50 A0
`;
    const { job, engine } = finish(text);
    expect(job.report.collision, job.report.collision?.message).toBeNull();
    expect(engine.removed).toBeGreaterThan(50);
    const turned = job.program.motions.find((motion) => motion.axisFrom && motion.axisTo && motion.axisFrom[1] !== motion.axisTo[1]);
    expect(turned).toBeDefined();
  });

  it("a later operation starts from the undercut left by the earlier ones", () => {
    const later = `G90
(TOOL FLAT D4)
T01 M06
S3000 M03
G00 X10 Y8 Z5
G01 Z-3 F150
G00 Z50
`;
    const { job } = finish(later, [SLOT, UNDERCUT]);
    expect(job.initial.family).toBe("voxel");
    expect(job.report.collision, job.report.collision?.message).toBeNull();
    expect(job.report.cutCells).toBeGreaterThan(0);
  });

  it("reports metal removed per move for the load estimate", () => {
    const { engine } = finish(SLOT + UNDERCUT);
    const total = Array.from(engine.removedByMotion).reduce((sum, value) => sum + value, 0);
    // The slot alone is about 10 x 60 x 18 mm. The undercut adds more.
    expect(total).toBeGreaterThan(9000);
  });

  it("runs a whole program in a reasonable time", () => {
    const started = Date.now();
    finish(SLOT + UNDERCUT);
    expect(Date.now() - started).toBeLessThan(8000);
  });
});
