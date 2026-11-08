import { describe, expect, it } from "vitest";
import { buildStagePlan, readTurningJob } from "@/lib/studio/stages";

const DRAWING = `
HOLLOW CYLINDER FROM RECTANGULAR BAR
PART NUMBER: HC-100
REVISION: A
MATERIAL: Aluminium 6061-T6
STOCK: rectangular bar 40 x 40 x 80 mm
FINISHED OUTSIDE DIAMETER: 32 mm
BORE: 16 mm through
FINISHED LENGTH: 80 mm
`;

describe("turning stage planner", () => {
  it("reads the hollow-cylinder drawing", () => {
    const job = readTurningJob(DRAWING);
    expect(job).toMatchObject({
      partNumber: "HC-100",
      revision: "A",
      material: "Aluminium 6061-T6",
      stockWidth: 40,
      stockHeight: 40,
      stockLength: 80,
      diameter: 32,
      bore: 16,
      length: 80,
    });
  });

  it("returns null when the drawing is not this job family", () => {
    expect(readTurningJob("Wall bracket, 4 holes, cast steel")).toBeNull();
    expect(readTurningJob("rectangular bar 20 x 20 x 40\nOUTSIDE DIAMETER: 30\nBORE: 10\nFINISHED LENGTH: 40")).toBeNull();
  });

  it("plans two stages where the second starts from the first result", () => {
    const job = readTurningJob(DRAWING);
    expect(job).not.toBeNull();
    const plan = buildStagePlan(job!, "lathe");

    expect(plan.selectedMachine).toBe("lathe");
    expect(plan.machines.find((machine) => machine.recommended)?.id).toBe("lathe");
    expect(plan.stages).toHaveLength(2);
    expect(plan.stages[0]).toMatchObject({ opNumber: 10, before: "bar", after: "cylinder" });
    expect(plan.stages[1]).toMatchObject({ opNumber: 20, before: "cylinder", after: "tube" });
    expect(plan.stages[0].gcode).toContain("OP10");
    expect(plan.stages[1].gcode).toContain("OP20");
    expect(plan.stages[0].holding).toContain("chuck");
    expect(plan.plan.machineType).toBe("CNC Lathe");
    expect(plan.features.features[0]).toMatchObject({ type: "bore", diameter: 16 });
  });

  it("keeps the same solids when the user picks a VMC and changes the holding", () => {
    const job = readTurningJob(DRAWING)!;
    const plan = buildStagePlan(job, "vmc");
    expect(plan.stages[0].before).toBe("bar");
    expect(plan.stages[1].after).toBe("tube");
    expect(plan.stages[0].fixture).toContain("vice");
    expect(plan.stages[0].gcode).toContain("VMC");
    expect(plan.plan.machineType).toBe("VMC");
  });
});
