import { axisAngle } from "@/lib/sim/axes";
import type { Collision, Motion, Vec3 } from "@/lib/sim/types";

/** Virtual speeds. The viewport rescales the whole run to a watchable length. */
export const RAPID_SPEED = 500;
export const FEED_SPEED = 40;

export interface Timeline {
  starts: number[];
  durations: number[];
  total: number;
}

export function buildTimeline(motions: Motion[]): Timeline {
  const starts: number[] = [];
  const durations: number[] = [];
  let clock = 0;
  for (const motion of motions) {
    const turn = motion.axisFrom && motion.axisTo ? axisAngle(motion.axisFrom, motion.axisTo) * 0.25 : 0;
    const length = turn + Math.hypot(
      motion.to[0] - motion.from[0],
      motion.to[1] - motion.from[1],
      motion.to[2] - motion.from[2]
    );
    const duration = motion.kind === "rapid" ? length / RAPID_SPEED + 0.04 : length / FEED_SPEED + 0.01;
    starts.push(clock);
    durations.push(duration);
    clock += duration;
  }
  return { starts, durations, total: clock };
}

export interface Pose {
  tip: Vec3;
  /** Unit tool axis. Absent means straight down. */
  axis?: Vec3;
  tool: number;
  line: number;
  motion: number;
}

export interface Engine {
  readonly duration: number;
  readonly collision: Collision | null;
  readonly done: boolean;
  advanceTo(time: number): void;
  pose(time: number): Pose;
}

export function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function describePoint(point: Vec3, lathe: boolean): string {
  const round = (value: number) => (Math.round(value * 10) / 10).toString();
  return lathe ? `X${round(point[0])} Z${round(point[2])}` : `X${round(point[0])} Y${round(point[1])} Z${round(point[2])}`;
}
