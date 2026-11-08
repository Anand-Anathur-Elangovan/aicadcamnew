import type { SimSetup } from "@/lib/sim/types";
import { faceAllowance } from "@/lib/studio/stageSheets";
import type { StagePlan } from "@/lib/studio/stages";

/**
 * The stock and clamping that the saved programs of one plan run against.
 * Programs of earlier stages cut the stock first, so a stage starts from the real part.
 */
export function setupFromPlan(plan: StagePlan, stageIndex: number): SimSetup {
  const previous = plan.stages.slice(0, stageIndex).map((stage) => stage.gcode);
  const { job } = plan;
  if (plan.family === "turning" && plan.selectedMachine === "lathe") {
    const grip = plan.stages[stageIndex]?.grip ?? plan.stages[0]?.grip ?? 12;
    const stockLength = job.stockLength || job.length;
    return {
      family: "lathe",
      length: stockLength,
      shape: { kind: "rect", width: job.stockWidth, height: job.stockHeight },
      chuckZ: -(job.length - grip),
      chuckRadius: Math.max(job.stockWidth, job.stockHeight) * 0.72,
      previous,
    };
  }
  if (plan.family === "turning") {
    // The bar stands on end in the vice: its cross-section lies in XY and its length runs down from Z0.
    return {
      family: "mill",
      x0: 0,
      y0: 0,
      length: job.stockWidth,
      width: job.stockHeight,
      top: 0,
      bottom: -(job.stockLength || job.length),
      previous,
    };
  }
  const allowance = plan.family === "machined" ? faceAllowance(job.stockHeight) : 0;
  return {
    family: "mill",
    x0: 0,
    y0: 0,
    length: job.stockLength || job.length,
    width: job.stockWidth,
    top: allowance,
    bottom: allowance - job.stockHeight,
    previous,
  };
}
