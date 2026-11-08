import type { Collision, CollisionKind, LatheSetup, Motion, ParsedProgram, ToolSpec, Vec3 } from "@/lib/sim/types";
import { buildTimeline, describePoint, lerp3, type Engine, type Pose, type Timeline } from "@/lib/sim/timeline";

export const LATHE_SECTORS = 120;
export const LATHE_ROW_STEP = 0.5;

export interface LatheGrid {
  rows: number;
  sectors: number;
  dz: number;
}

export interface LatheState {
  outer: Float32Array;
  inner: Float32Array;
  cut: Uint8Array;
}

export function latheGrid(setup: LatheSetup): LatheGrid {
  const dz = LATHE_ROW_STEP;
  return { rows: Math.max(2, Math.round(setup.length / dz) + 1), sectors: LATHE_SECTORS, dz };
}

export function freshLatheState(setup: LatheSetup): LatheState {
  const grid = latheGrid(setup);
  const size = grid.rows * grid.sectors;
  const outer = new Float32Array(size);
  for (let j = 0; j < grid.sectors; j += 1) {
    const angle = ((j + 0.5) / grid.sectors) * Math.PI * 2;
    let radius: number;
    if (setup.shape.kind === "round") {
      radius = setup.shape.diameter / 2;
    } else {
      const c = Math.abs(Math.cos(angle));
      const s = Math.abs(Math.sin(angle));
      radius = Math.min(c < 1e-6 ? Infinity : setup.shape.width / 2 / c, s < 1e-6 ? Infinity : setup.shape.height / 2 / s);
    }
    for (let i = 0; i < grid.rows; i += 1) outer[i * grid.sectors + j] = radius;
  }
  return { outer, inner: new Float32Array(size), cut: new Uint8Array(size) };
}

export function cloneLatheState(state: LatheState): LatheState {
  return { outer: new Float32Array(state.outer), inner: new Float32Array(state.inner), cut: new Uint8Array(state.cut) };
}

function toolName(spec: ToolSpec): string {
  return spec.kind === "bore" ? "boring bar" : spec.kind === "drill" ? "drill" : "turning tool";
}

const EPS = 0.02;
/** Most radial depth a boring bar may take in one pass. */
const MAX_BORE_BITE = 5;

export class LatheEngine implements Engine {
  readonly grid: LatheGrid;
  readonly state: LatheState;
  readonly timeline: Timeline;
  collision: Collision | null = null;
  readonly setup: LatheSetup;
  private readonly motions: Motion[];
  private readonly tools: ToolSpec[];
  private motionIndex = 0;
  private sampleIndex = 0;
  private sampleCount = 0;
  private poseIndex = 0;
  private frozen: Pose | null = null;
  dirtyRows: [number, number] | null = null;
  /** Metal removed by each move, in mm3. Feeds the load and tool-life estimate. */
  readonly removedByMotion: Float64Array;

  constructor(setup: LatheSetup, program: ParsedProgram, initial?: LatheState) {
    this.setup = setup;
    this.grid = latheGrid(setup);
    this.state = initial ? cloneLatheState(initial) : freshLatheState(setup);
    this.motions = program.motions;
    this.tools = program.tools;
    this.timeline = buildTimeline(program.motions);
    this.removedByMotion = new Float64Array(program.motions.length);
  }

  /** Volume of one sector cell between two radii. */
  private ring(from: number, to: number): number {
    const [low, high] = from < to ? [from, to] : [to, from];
    return ((high * high - low * low) / 2) * ((Math.PI * 2) / this.grid.sectors) * this.grid.dz;
  }

  get duration(): number {
    return this.timeline.total;
  }

  get done(): boolean {
    return this.collision !== null || this.motionIndex >= this.motions.length;
  }

  takeDirtyRows(): [number, number] | null {
    const rows = this.dirtyRows;
    this.dirtyRows = null;
    return rows;
  }

  advanceTo(time: number): void {
    while (!this.collision && this.motionIndex < this.motions.length) {
      const motion = this.motions[this.motionIndex];
      if (this.sampleCount === 0) {
        const length = Math.hypot((motion.to[0] - motion.from[0]) / 2, motion.to[2] - motion.from[2]);
        this.sampleCount = Math.min(4000, Math.max(1, Math.ceil(length / (motion.kind === "rapid" ? 0.5 : 0.1))));
        this.sampleIndex = 0;
      }
      const t = (this.sampleIndex + 1) / this.sampleCount;
      const when = this.timeline.starts[this.motionIndex] + this.timeline.durations[this.motionIndex] * t;
      if (when > time) break;
      this.sample(motion, lerp3(motion.from, motion.to, t));
      if (this.collision) break;
      this.sampleIndex += 1;
      if (this.sampleIndex >= this.sampleCount) {
        this.motionIndex += 1;
        this.sampleCount = 0;
      }
    }
  }

  pose(time: number): Pose {
    if (this.frozen) return this.frozen;
    const { starts, durations, total } = this.timeline;
    if (this.motions.length === 0) return { tip: [0, 0, 0], tool: 0, line: 0, motion: 0 };
    const t = Math.min(Math.max(time, 0), total);
    while (this.poseIndex < this.motions.length - 1 && starts[this.poseIndex] + durations[this.poseIndex] < t) this.poseIndex += 1;
    const motion = this.motions[this.poseIndex];
    const u = durations[this.poseIndex] > 0 ? Math.min(Math.max((t - starts[this.poseIndex]) / durations[this.poseIndex], 0), 1) : 1;
    return { tip: lerp3(motion.from, motion.to, u), tool: motion.tool, line: motion.line, motion: this.poseIndex };
  }

  private fail(kind: CollisionKind, motion: Motion, point: Vec3, message: string): void {
    this.collision = { kind, line: motion.line, motion: this.motionIndex, point, message };
    this.frozen = { tip: point, tool: motion.tool, line: motion.line, motion: this.motionIndex };
  }

  private rowRange(z: number, reach: number): [number, number] {
    const { dz, rows } = this.grid;
    const first = Math.max(0, Math.ceil(-(z + reach) / dz - 1e-6));
    const last = Math.min(rows - 1, Math.floor(-z / dz + 1e-6));
    return [first, last];
  }

  private sample(motion: Motion, point: Vec3): void {
    const spec = this.tools[motion.tool] ?? this.tools[0];
    const name = toolName(spec);
    const lineNumber = motion.line + 1;
    const radius = point[0] / 2;
    const z = point[2];
    const where = describePoint(point, true);

    if (radius < -0.05) {
      this.fail("centre", motion, point, `Line ${lineNumber}: X${Math.round(point[0] * 10) / 10} is past the spindle centre. The ${name} crosses the axis and would crash into the other side of the part.`);
      return;
    }

    if (z < this.setup.chuckZ - 0.01 && radius < this.setup.chuckRadius) {
      this.fail("chuck", motion, point, `Line ${lineNumber}: ${where} runs into the chuck jaws. The jaws start at Z${Math.round(this.setup.chuckZ * 10) / 10}. Stop the cut before that.`);
      return;
    }

    const [first, last] = this.rowRange(z, spec.fluteLength);
    const boring = spec.kind === "bore" || spec.kind === "drill";
    const reach = spec.kind === "drill" ? spec.diameter / 2 : radius;
    const { sectors } = this.grid;
    const { outer, inner, cut } = this.state;

    if (motion.kind === "rapid") {
      for (let i = first; i <= last; i += 1) {
        for (let j = 0; j < sectors; j += 1) {
          const index = i * sectors + j;
          const o = outer[index];
          const n = inner[index];
          if (o - n <= EPS) continue;
          const crash = boring ? n < reach - EPS : o > radius + EPS;
          if (crash) {
            this.fail("rapid", motion, point, `Line ${lineNumber}: rapid move (G00) drives the ${name} into the part at ${where}. Use a feed move (G01) to cut.`);
            return;
          }
        }
      }
      return;
    }

    let changed = false;
    for (let i = first; i <= last; i += 1) {
      for (let j = 0; j < sectors; j += 1) {
        const index = i * sectors + j;
        const o = outer[index];
        const n = inner[index];
        if (o - n <= EPS) continue;
        if (boring) {
          const target = Math.min(reach, o);
          if (spec.kind === "bore" && i === last && target - n > MAX_BORE_BITE) {
            this.fail("holder", motion, point, `Line ${lineNumber}: the boring bar takes a ${Math.round((target - n) * 10) / 10} mm bite into solid metal at ${where}. A boring bar cannot start a hole, so drill a pilot hole first.`);
            return;
          }
          if (target > n + 1e-4) {
            if (!motion.spindle) return this.fail("spindle", motion, point, `Line ${lineNumber}: cutting at ${where} with the spindle off. Add M03 before the cutting move.`);
            this.removedByMotion[this.motionIndex] += this.ring(n, target);
            inner[index] = target;
            cut[index] = 1;
            changed = true;
          }
        } else if (o > radius + 1e-4) {
          if (radius < n - EPS) {
            this.fail("holder", motion, point, `Line ${lineNumber}: the turning tool is inside the bored hole at ${where}. Its holder hits the hole wall.`);
            return;
          }
          if (!motion.spindle) return this.fail("spindle", motion, point, `Line ${lineNumber}: cutting at ${where} with the spindle off. Add M03 before the cutting move.`);
          this.removedByMotion[this.motionIndex] += this.ring(radius > n ? radius : n, o);
          outer[index] = Math.max(radius, n);
          cut[index] = 1;
          changed = true;
        }
      }
    }
    if (changed) {
      const rows = this.dirtyRows;
      this.dirtyRows = rows ? [Math.min(rows[0], first), Math.max(rows[1], last)] : [first, last];
    }
  }
}
