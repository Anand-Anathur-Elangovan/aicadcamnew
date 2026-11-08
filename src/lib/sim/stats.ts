import type { Motion, ParsedProgram, Vec3 } from "@/lib/sim/types";

/** What sets how long a move takes on a given machine. */
export interface Timing {
  /** Rapid traverse, mm/min. */
  rapid: number;
  /** Highest spindle speed, rpm. A constant-surface-speed cut is held to this. */
  maxRpm: number;
  /** Highest cutting feed, mm/min. */
  maxFeed: number;
  /** Seconds for one tool change, including spindle stop and restart. */
  toolChange: number;
  /** Seconds lost to acceleration and braking on every move. */
  perMove: number;
}

export const DEFAULT_TIMING: { mill: Timing; lathe: Timing } = {
  mill: { rapid: 30000, maxRpm: 8000, maxFeed: 10000, toolChange: 6, perMove: 0.08 },
  lathe: { rapid: 24000, maxRpm: 3500, maxFeed: 3000, toolChange: 2.5, perMove: 0.08 },
};

const FALLBACK_FEED = 100;

function timingFor(lathe: boolean, timing?: Timing): Timing {
  return timing ?? (lathe ? DEFAULT_TIMING.lathe : DEFAULT_TIMING.mill);
}

function travel(motion: Motion, lathe: boolean): number {
  const dx = (motion.to[0] - motion.from[0]) / (lathe ? 2 : 1);
  return Math.hypot(dx, motion.to[1] - motion.from[1], motion.to[2] - motion.from[2]);
}

function spindleRpm(motion: Motion, lathe: boolean, maxRpm = DEFAULT_TIMING.lathe.maxRpm): number {
  if (!motion.css) return motion.s > 0 ? motion.s : 500;
  const diameter = Math.max(Math.abs(motion.to[0]), 10);
  const rpm = lathe ? (motion.s * 1000) / (Math.PI * diameter) : motion.s;
  return Math.min(Math.max(rpm, 50), maxRpm);
}

/** Seconds one move takes on the machine, with the machine's rapid rate and feed limit. */
export function motionSeconds(motion: Motion, lathe: boolean, timing?: Timing): number {
  const limits = timingFor(lathe, timing);
  const length = travel(motion, lathe);
  if (motion.kind === "rapid") return (length / limits.rapid) * 60;
  let perMinute = motion.f > 0 ? motion.f : FALLBACK_FEED;
  if (motion.perRev) perMinute = (motion.f > 0 ? motion.f : 0.1) * spindleRpm(motion, lathe, limits.maxRpm);
  perMinute = Math.min(perMinute, limits.maxFeed);
  return (length / perMinute) * 60;
}

export { spindleRpm };

export interface CycleTime {
  cutSeconds: number;
  rapidSeconds: number;
  toolChangeSeconds: number;
  /** Acceleration and braking across all moves. */
  motionSeconds: number;
  toolChanges: number;
  totalSeconds: number;
}

/** Machine time for a program: cutting, rapids, tool changes and the time lost accelerating on short moves. */
export function cycleTime(program: ParsedProgram, timing?: Timing): CycleTime {
  const limits = timingFor(program.lathe, timing);
  let cut = 0;
  let rapid = 0;
  let moves = 0;
  const used: number[] = [];
  for (const motion of program.motions) {
    const seconds = motionSeconds(motion, program.lathe, limits);
    if (motion.kind === "rapid") rapid += seconds;
    else cut += seconds;
    if (!motion.home) moves += 1;
    if (!motion.home && (used.length === 0 || used[used.length - 1] !== motion.tool)) used.push(motion.tool);
  }
  // The first tool is loaded before the cycle starts, so only later changes cost time.
  const toolChanges = Math.max(used.length - 1, 0);
  const toolChangeSeconds = toolChanges * limits.toolChange;
  const accel = moves * limits.perMove;
  return { cutSeconds: cut, rapidSeconds: rapid, toolChangeSeconds, motionSeconds: accel, toolChanges, totalSeconds: cut + rapid + toolChangeSeconds + accel };
}

/** Cut and rapid distance, estimated cycle time, cut bounding box and hole count, from the moves alone. */
export function programStats(program: ParsedProgram, timing?: Timing) {
  let cutDistance = 0;
  let rapidDistance = 0;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const motion of program.motions) {
    const length = travel(motion, program.lathe);
    if (motion.kind === "rapid") {
      rapidDistance += length;
      continue;
    }
    cutDistance += length;
    for (const point of [motion.from, motion.to]) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], point[axis]);
        max[axis] = Math.max(max[axis], point[axis]);
      }
    }
  }
  return {
    cutDistance,
    rapidDistance,
    estimatedSeconds: cycleTime(program, timing).totalSeconds,
    holes: program.holes,
    bbox: Number.isFinite(min[0]) ? { min, max } : null,
  };
}
export function formatClock(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Spreadsheet-ready list of every move. Used by the CSV export. */
export function toolpathCsv(program: ParsedProgram): string {
  const rows = ["move,kind,line,x_from,y_from,z_from,x_to,y_to,z_to,feed,rpm"];
  program.motions.forEach((motion, index) => {
    rows.push([
      index + 1,
      motion.kind,
      motion.line + 1,
      ...motion.from.map((value) => value.toFixed(3)),
      ...motion.to.map((value) => value.toFixed(3)),
      motion.f,
      motion.s,
    ].join(","));
  });
  return rows.join("\n") + "\n";
}
