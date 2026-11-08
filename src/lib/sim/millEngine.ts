import type { Collision, CollisionKind, MillSetup, Motion, ParsedProgram, ToolSpec, Vec3 } from "@/lib/sim/types";
import { buildTimeline, describePoint, lerp3, type Engine, type Pose, type Timeline } from "@/lib/sim/timeline";

export interface MillGrid {
  nx: number;
  ny: number;
  cell: number;
  x0: number;
  y0: number;
  top: number;
  bottom: number;
}

export interface MillState {
  heights: Float32Array;
  cut: Uint8Array;
}

export function millGrid(setup: MillSetup): MillGrid {
  const longest = Math.max(setup.length, setup.width);
  let cell = Math.min(Math.max(longest / 260, 0.1), 0.8);
  while (Math.ceil(setup.length / cell) * Math.ceil(setup.width / cell) > 80000) cell *= 1.12;
  return {
    nx: Math.max(1, Math.ceil(setup.length / cell)),
    ny: Math.max(1, Math.ceil(setup.width / cell)),
    cell,
    x0: setup.x0,
    y0: setup.y0,
    top: setup.top,
    bottom: setup.bottom,
  };
}

export function freshMillState(grid: MillGrid): MillState {
  return { heights: new Float32Array(grid.nx * grid.ny).fill(grid.top), cut: new Uint8Array(grid.nx * grid.ny) };
}

export function cloneMillState(state: MillState): MillState {
  return { heights: new Float32Array(state.heights), cut: new Uint8Array(state.cut) };
}

function toolName(spec: ToolSpec): string {
  const names: Record<string, string> = {
    ball: "ball cutter",
    flat: "end mill",
    face: "face mill",
    drill: "drill",
    bore: "boring head",
    tap: "tap",
  };
  return `${names[spec.kind] ?? "tool"} D${Math.round(spec.diameter * 10) / 10}`;
}

/** Height of the tool's underside at distance d from its axis, relative to the tip. */
function undersideOffset(kind: ToolSpec["kind"], radius: number, d: number): number {
  if (kind === "ball") return radius - Math.sqrt(Math.max(radius * radius - d * d, 0));
  if (kind === "drill") return d * 0.6;
  return 0;
}

/** A boring head enlarges a drilled hole by at most this much on each side. */
const MAX_BORE_BITE = 3;

export class MillEngine implements Engine {
  readonly grid: MillGrid;
  readonly state: MillState;
  readonly timeline: Timeline;
  collision: Collision | null = null;
  removed = 0;
  /** Metal removed by each move, in mm3. Feeds the load and tool-life estimate. */
  readonly removedByMotion: Float64Array;
  private readonly motions: Motion[];
  private readonly tools: ToolSpec[];
  private motionIndex = 0;
  private sampleIndex = 0;
  private sampleCount = 0;
  private poseIndex = 0;
  private frozen: Pose | null = null;
  private dirty = new Set<number>();

  constructor(setup: MillSetup, program: ParsedProgram, initial?: MillState) {
    this.grid = millGrid(setup);
    this.state = initial ? cloneMillState(initial) : freshMillState(this.grid);
    this.motions = program.motions;
    this.tools = program.tools;
    this.timeline = buildTimeline(program.motions);
    this.removedByMotion = new Float64Array(program.motions.length);
  }

  get duration(): number {
    return this.timeline.total;
  }

  get done(): boolean {
    return this.collision !== null || this.motionIndex >= this.motions.length;
  }

  /** Cell indexes changed since the last call. */
  takeDirty(): number[] {
    const list = [...this.dirty];
    this.dirty.clear();
    return list;
  }

  advanceTo(time: number): void {
    while (!this.collision && this.motionIndex < this.motions.length) {
      const motion = this.motions[this.motionIndex];
      if (this.sampleCount === 0) {
        this.sampleCount = this.samplesFor(motion);
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

  private samplesFor(motion: Motion): number {
    const length = Math.hypot(motion.to[0] - motion.from[0], motion.to[1] - motion.from[1], motion.to[2] - motion.from[2]);
    const radius = (this.tools[motion.tool]?.diameter ?? 4) / 2;
    const step = motion.kind === "rapid"
      ? Math.min(Math.max(Math.min(this.grid.cell, radius * 0.5), 0.2), 2)
      : Math.min(Math.max(Math.min(this.grid.cell * 0.5, radius * 0.25), 0.05), 1);
    return Math.min(4000, Math.max(1, Math.ceil(length / step)));
  }

  private fail(kind: CollisionKind, motion: Motion, point: Vec3, message: string): void {
    this.collision = { kind, line: motion.line, motion: this.motionIndex, point, message };
    this.frozen = { tip: point, tool: motion.tool, line: motion.line, motion: this.motionIndex };
  }

  private sample(motion: Motion, point: Vec3): void {
    const spec = this.tools[motion.tool] ?? this.tools[0];
    const radius = spec.diameter / 2;
    const { bottom, top } = this.grid;
    const lineNumber = motion.line + 1;
    const name = toolName(spec);

    const tableClear = spec.kind === "drill" ? radius * 0.6 + 1.5 : 3;
    if (point[2] < bottom - tableClear) {
      this.fail("table", motion, point, `Line ${lineNumber}: the ${name} goes to Z${Math.round(point[2] * 10) / 10}, below the stock bottom (Z${Math.round(bottom * 10) / 10}). It would crash into the vise or table.`);
      return;
    }

    if (motion.kind === "rapid") {
      if (this.touches(point, spec, radius)) {
        this.fail("rapid", motion, point, `Line ${lineNumber}: rapid move (G00) drives the ${name} into the stock at ${describePoint(point, false)}. Stock top is Z${Math.round(top * 10) / 10}. Use a feed move (G01) to cut.`);
      }
      return;
    }

    if (this.holderHits(point, spec, radius)) {
      this.fail("holder", motion, point, `Line ${lineNumber}: the ${name} is buried too deep at ${describePoint(point, false)}. Only ${Math.round(spec.fluteLength * 10) / 10} mm of the tool can cut, so the tool holder hits the stock.`);
      return;
    }

    if (spec.kind === "bore" && this.biteTooDeep(point, radius)) {
      this.fail("bite", motion, point, `Line ${lineNumber}: the ${name} would cut solid metal at ${describePoint(point, false)}. A boring head only opens a hole that exists, so drill it to within ${MAX_BORE_BITE} mm of the final size, and past the full depth so the drill point is out of the way.`);
      return;
    }

    if (!motion.spindle && this.touches(point, spec, radius)) {
      this.fail("spindle", motion, point, `Line ${lineNumber}: the ${name} cuts at ${describePoint(point, false)} with the spindle off. Add M03 before the cutting move.`);
      return;
    }

    const before = this.removed;
    this.carve(point, spec, radius);
    this.removedByMotion[this.motionIndex] += this.removed - before;
  }

  private bounds(x: number, y: number, radius: number) {
    const { cell, x0, y0, nx, ny } = this.grid;
    return {
      ix0: Math.max(0, Math.floor((x - radius - x0) / cell)),
      ix1: Math.min(nx - 1, Math.ceil((x + radius - x0) / cell)),
      iy0: Math.max(0, Math.floor((y - radius - y0) / cell)),
      iy1: Math.min(ny - 1, Math.ceil((y + radius - y0) / cell)),
    };
  }

  private touches(point: Vec3, spec: ToolSpec, radius: number): boolean {
    if (spec.kind === "tap") return false;
    const { cell, x0, y0, nx } = this.grid;
    const { heights } = this.state;
    const { ix0, ix1, iy0, iy1 } = this.bounds(point[0], point[1], radius);
    const r2 = radius * radius;
    for (let iy = iy0; iy <= iy1; iy += 1) {
      const cy = y0 + (iy + 0.5) * cell;
      for (let ix = ix0; ix <= ix1; ix += 1) {
        const cx = x0 + (ix + 0.5) * cell;
        const d2 = (cx - point[0]) ** 2 + (cy - point[1]) ** 2;
        if (d2 > r2) continue;
        const under = point[2] + undersideOffset(spec.kind, radius, Math.sqrt(d2));
        if (heights[iy * nx + ix] > under + 0.003 && heights[iy * nx + ix] > this.grid.bottom + 0.001) return true;
      }
    }
    return false;
  }

  /** True when material stands inside the core of the boring head, away from the thin ring it is allowed to cut. */
  private biteTooDeep(point: Vec3, radius: number): boolean {
    const { cell, x0, y0, nx } = this.grid;
    const { heights } = this.state;
    const core = radius - MAX_BORE_BITE;
    if (core <= 0) return false;
    const { ix0, ix1, iy0, iy1 } = this.bounds(point[0], point[1], core);
    const c2 = core * core;
    for (let iy = iy0; iy <= iy1; iy += 1) {
      const cy = y0 + (iy + 0.5) * cell;
      for (let ix = ix0; ix <= ix1; ix += 1) {
        const cx = x0 + (ix + 0.5) * cell;
        if ((cx - point[0]) ** 2 + (cy - point[1]) ** 2 > c2) continue;
        const height = heights[iy * nx + ix];
        if (height > point[2] + 0.05 && height > this.grid.bottom + 0.001) return true;
      }
    }
    return false;
  }

  private holderHits(point: Vec3, spec: ToolSpec, radius: number): boolean {
    const { cell, x0, y0, nx } = this.grid;
    const { heights } = this.state;
    const ceiling = point[2] + spec.fluteLength + 0.003;
    const { ix0, ix1, iy0, iy1 } = this.bounds(point[0], point[1], radius);
    const r2 = radius * radius;
    for (let iy = iy0; iy <= iy1; iy += 1) {
      const cy = y0 + (iy + 0.5) * cell;
      for (let ix = ix0; ix <= ix1; ix += 1) {
        const cx = x0 + (ix + 0.5) * cell;
        if ((cx - point[0]) ** 2 + (cy - point[1]) ** 2 > r2) continue;
        if (heights[iy * nx + ix] > ceiling) return true;
      }
    }
    return false;
  }

  private carve(point: Vec3, spec: ToolSpec, radius: number): void {
    if (spec.kind === "tap") return;
    const { cell, x0, y0, nx, bottom } = this.grid;
    const { heights, cut } = this.state;
    const { ix0, ix1, iy0, iy1 } = this.bounds(point[0], point[1], radius);
    const r2 = radius * radius;
    for (let iy = iy0; iy <= iy1; iy += 1) {
      const cy = y0 + (iy + 0.5) * cell;
      for (let ix = ix0; ix <= ix1; ix += 1) {
        const cx = x0 + (ix + 0.5) * cell;
        const d2 = (cx - point[0]) ** 2 + (cy - point[1]) ** 2;
        if (d2 > r2) continue;
        const under = Math.max(point[2] + undersideOffset(spec.kind, radius, Math.sqrt(d2)), bottom);
        const index = iy * nx + ix;
        if (heights[index] > under + 1e-4) {
          this.removed += (heights[index] - under) * cell * cell;
          heights[index] = under;
          cut[index] = 1;
          this.dirty.add(index);
        }
      }
    }
  }
}
