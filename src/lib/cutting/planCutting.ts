import type { OperationCutting, ProcessOperation } from "@/lib/providers/capp.provider";
import { analyzeLoad } from "@/lib/cutting/load";
import { machineLimits, timingOf } from "@/lib/cutting/library";
import { setupFromPlan } from "@/lib/sim/fromPlan";
import { prepareSim, type SimJob } from "@/lib/sim/prepare";
import { cycleTime, motionSeconds, spindleRpm } from "@/lib/sim/stats";
import type { StagePlan } from "@/lib/studio/stages";

const HANDLING_MINUTES: Record<string, number> = { lathe: 1.2, vmc: 1.5, vmc5: 2 };
const BASE_SETUP_MINUTES = 15;
const SETUP_PER_TOOL_MINUTES = 4;

const round = (value: number, places = 1) => Math.round(value * 10 ** places) / 10 ** places;

/** Speed and feed of the tool that cuts longest, so the plan sheet shows the numbers that matter. */
function dominantParams(job: SimJob, machineId: string) {
  const machine = machineLimits(machineId);
  const timing = timingOf(machine);
  const lathe = job.program.lathe;
  const byTool = new Map<number, { seconds: number; rpm: number; feed: number }>();
  for (const motion of job.program.motions) {
    if (motion.kind !== "feed") continue;
    const seconds = motionSeconds(motion, lathe, timing);
    const rpm = spindleRpm(motion, lathe, machine.maxRpm);
    const feed = motion.perRev ? (motion.f > 0 ? motion.f : 0.1) * rpm : motion.f;
    const entry = byTool.get(motion.tool) ?? { seconds: 0, rpm: 0, feed: 0 };
    entry.rpm += rpm * seconds;
    entry.feed += feed * seconds;
    entry.seconds += seconds;
    byTool.set(motion.tool, entry);
  }
  let best: { seconds: number; rpm: number; feed: number } | null = null;
  for (const entry of byTool.values()) if (!best || entry.seconds > best.seconds) best = entry;
  return best && best.seconds > 0 ? { spindleSpeed: Math.round(best.rpm / best.seconds / 10) * 10, feedRate: Math.round(best.feed / best.seconds) } : null;
}

export function cuttingFor(job: SimJob, materialName: string | undefined, machineId: string, setupExtra = 0): OperationCutting {
  const machine = machineLimits(machineId);
  const time = cycleTime(job.program, timingOf(machine));
  const load = analyzeLoad(job, materialName, machineId);
  const toolCount = new Set(job.program.motions.filter((motion) => !motion.home).map((motion) => motion.tool)).size;
  return {
    material: load.material.label,
    materialRecognised: load.recognised,
    machine: machine.label,
    cutSeconds: round(time.cutSeconds),
    rapidSeconds: round(time.rapidSeconds),
    toolChangeSeconds: round(time.toolChangeSeconds),
    accelSeconds: round(time.motionSeconds),
    toolChanges: time.toolChanges,
    handlingMinutes: HANDLING_MINUTES[machineId] ?? 1.5,
    setupMinutes: round(BASE_SETUP_MINUTES + SETUP_PER_TOOL_MINUTES * toolCount + setupExtra),
    peakKw: round(load.peakKw),
    spindleLoadPercent: round(load.spindleLoadPercent),
    peakForceN: Math.round(load.peakForceN),
    tools: load.tools.map((tool) => ({
      name: tool.name,
      vc: Math.round(tool.vc),
      cutMinutes: round(tool.cutMinutes, 2),
      lifeMinutes: Math.round(tool.lifeMinutes),
      lifeUsedPercent: round(tool.lifeUsedPercent),
    })),
    warnings: load.warnings,
  };
}

/** Per-part minutes: machine time plus handling. Setup is kept apart because it is paid once per job. */
export function minutesPerPart(cutting: OperationCutting): number {
  const machineSeconds = cutting.cutSeconds + cutting.rapidSeconds + cutting.toolChangeSeconds + cutting.accelSeconds;
  return round(machineSeconds / 60 + cutting.handlingMinutes);
}

/**
 * Fills each operation with the speed, feed, load, tool life and times worked out from its own program.
 * The program is run in the simulator, so the numbers follow the real toolpath and not a guess.
 */
export function applyCutting(plan: StagePlan): StagePlan {
  const machineId = plan.selectedMachine;
  const operations: ProcessOperation[] = plan.plan.operations.map((operation, index) => {
    const stage = plan.stages[index];
    if (!stage) return operation;
    let job: SimJob;
    try {
      job = prepareSim(stage.gcode, setupFromPlan(plan, index));
    } catch {
      return operation;
    }
    const cutting = cuttingFor(job, plan.job.material, machineId, index === 0 ? 5 : 0);
    const params = dominantParams(job, machineId);
    return {
      ...operation,
      cuttingParams: params ? { ...operation.cuttingParams, ...params } : operation.cuttingParams,
      estimatedTime: minutesPerPart(cutting),
      cutting,
    };
  });
  const total = round(operations.reduce((sum, operation) => sum + operation.estimatedTime, 0));
  const notes = [...plan.plan.generalNotes];
  const unknown = operations.find((operation) => operation.cutting && !operation.cutting.materialRecognised);
  if (unknown) notes.push(`The material is not in the cutting library, so carbon steel speeds and feeds are used. Check them before cutting.`);
  return { ...plan, plan: { ...plan.plan, operations, totalEstimatedTime: total, generalNotes: notes } };
}
