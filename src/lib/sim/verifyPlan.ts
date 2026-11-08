import { prepareSim } from "@/lib/sim/prepare";
import { setupFromPlan } from "@/lib/sim/fromPlan";
import type { StagePlan } from "@/lib/studio/stages";

export interface StageCheck {
  opNumber: number;
  name: string;
  ok: boolean;
  problem: string;
  warnings: string[];
  cutCells: number;
  seconds: number;
}

/** Runs every saved stage program against the stock it really starts from. */
export function verifyPlan(plan: StagePlan): StageCheck[] {
  return plan.stages.map((stage, index) => {
    const job = prepareSim(stage.gcode, setupFromPlan(plan, index));
    const crash = job.report.collision;
    return {
      opNumber: stage.opNumber,
      name: stage.name,
      ok: !crash,
      problem: crash ? `Line ${crash.line + 1}: ${crash.message}` : "",
      warnings: job.report.warnings,
      cutCells: job.report.cutCells,
      seconds: job.report.estimatedSeconds,
    };
  });
}
