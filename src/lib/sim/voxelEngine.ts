import { UP, axisAngle, lerpAxis } from "@/lib/sim/axes";
import type { Collision, CollisionKind, MillSetup, Motion, ParsedProgram, ToolSpec, Vec3 } from "@/lib/sim/types";
import { buildTimeline, describePoint, lerp3, type Engine, type Pose, type Timeline } from "@/lib/sim/timeline";

/**
 * A solid stock model for what the height map cannot show: undercuts, a tilted tool, 3+2 and simultaneous 4/5-axis moves.
 * The stock is a grid of small boxes. A box is removed when the tool solid covers its centre.
 * Resolution is about 1 percent of the part size, so fine detail and thin walls are shown only roughly.
 */
export interface VoxelGrid {
  nx: number;
  ny: number;
  nz: number;
  dx: number;
  dy: number;
  dz: number;
  x0: number;
  y0: number;
  /** Stock bottom. */
  z0: number;
  top: number;
}

export interface VoxelState {
  /** 0 empty, 1 raw stock, 2 stock face made by cutting. */
  occ: Uint8Array;
}

const MAX_VOXELS = 2_500_000;
const EPS = 1e-6;
/** The shank above the cutting part. The simulator checks this length for a crash with the stock. */
const SHANK_LENGTH = 40;

export function voxelGrid(setup: MillSetup): VoxelGrid {
  const height = Math.max(setup.top - setup.bottom, 0.5);
  const longest = Math.max(setup.length, setup.width, height);
  let cell = Math.min(Math.max(longest / 150, 0.35), 1);
  const count = (size: number) => Math.max(1, Math.round(size / cell));
  while (count(setup.length) * count(setup.width) * count(height) > MAX_VOXELS) cell *= 1.1;
  const nx = count(setup.length);
  const ny = count(setup.width);
  const nz = count(height);
  return {
    nx,
    ny,
    nz,
    dx: setup.length / nx,
    dy: setup.width / ny,
    dz: height / nz,
    x0: setup.x0,
    y0: setup.y0,
    z0: setup.bottom,
    top: setup.top,
  };
}

export function freshVoxelState(grid: VoxelGrid): VoxelState {
  return { occ: new Uint8Array(grid.nx * grid.ny * grid.nz).fill(1) };
}

export function cloneVoxelState(state: VoxelState): VoxelState {
  return { occ: new Uint8Array(state.occ) };
}

interface Profile {
  /** Height of the part that can cut, from the tip along the axis. */
  cutH: number;
  maxR: number;
  radiusAt: (h: number) => number;
  /** Radius of the shaft above the cutting part. */
  shankR: number;
}

function profileOf(spec: ToolSpec): Profile {
  const r = Math.max(spec.diameter / 2, 0.2);
  if (spec.kind === "ball") {
    return { cutH: Math.max(spec.fluteLength, r), maxR: r, radiusAt: (h) => (h >= r ? r : Math.sqrt(Math.max(2 * r * h - h * h, 0))), shankR: r };
  }
  if (spec.kind === "drill") {
    return { cutH: spec.fluteLength, maxR: r, radiusAt: (h) => Math.min(r, h / 0.6), shankR: r };
  }
  if (spec.kind === "tslot") {
    const thickness = spec.thickness ?? spec.fluteLength;
    return { cutH: thickness, maxR: r, radiusAt: () => r, shankR: Math.max((spec.neck ?? spec.diameter * 0.45) / 2, 0.3) };
  }
  if (spec.kind === "dovetail") {
    const neckR = Math.max((spec.neck ?? spec.diameter * 0.5) / 2, 0.3);
    const slope = Math.tan(((spec.angle ?? 45) * Math.PI) / 180);
    return { cutH: spec.fluteLength, maxR: r, radiusAt: (h) => Math.max(r - h * slope, neckR), shankR: neckR };
  }
  return { cutH: spec.fluteLength, maxR: r, radiusAt: () => r, shankR: r };
}

function toolName(spec: ToolSpec): string {
  const names: Record<string, string> = {
    ball: "ball cutter",
    flat: "end mill",
    face: "face mill",
    drill: "drill",
    bore: "boring head",
    tap: "tap",
    tslot: "T-slot cutter",
    dovetail: "dovetail cutter",
  };
  return `${names[spec.kind] ?? "tool"} D${Math.round(spec.diameter * 10) / 10}`;
}

function basis(axis: Vec3): [Vec3, Vec3] {
  const ref: Vec3 = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const u = cross(axis, ref);
  const length = Math.hypot(u[0], u[1], u[2]) || 1;
  const un: Vec3 = [u[0] / length, u[1] / length, u[2] / length];
  return [un, cross(axis, un)];
}

export class VoxelEngine implements Engine {
  readonly voxel = true;
  readonly grid: VoxelGrid;
  readonly state: VoxelState;
  readonly timeline: Timeline;
  collision: Collision | null = null;
  removed = 0;
  /** Metal removed by each move, in mm3. Feeds the load and tool-life estimate. */
  readonly removedByMotion: Float64Array;
  private readonly motions: Motion[];
  private readonly tools: ToolSpec[];
  private readonly profiles: Profile[];
  private motionIndex = 0;
  private sampleIndex = 0;
  private sampleCount = 0;
  private poseIndex = 0;
  private frozen: Pose | null = null;
  private dirty = false;

  constructor(setup: MillSetup, program: ParsedProgram, initial?: VoxelState) {
    this.grid = voxelGrid(setup);
    this.state = initial ? cloneVoxelState(initial) : freshVoxelState(this.grid);
    this.motions = program.motions;
    this.tools = program.tools;
    this.profiles = program.tools.map(profileOf);
    this.timeline = buildTimeline(program.motions);
    this.removedByMotion = new Float64Array(program.motions.length);
  }

  get duration(): number {
    return this.timeline.total;
  }

  get done(): boolean {
    return this.collision !== null || this.motionIndex >= this.motions.length;
  }

  get cellVolume(): number {
    return this.grid.dx * this.grid.dy * this.grid.dz;
  }

  /** True once since the last call if any box was removed. */
  takeDirty(): boolean {
    const was = this.dirty;
    this.dirty = false;
    return was;
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
      this.sample(motion, lerp3(motion.from, motion.to, t), this.axisAt(motion, t));
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
    if (this.motions.length === 0) return { tip: [0, 0, 0], axis: UP, tool: 0, line: 0, motion: 0 };
    const t = Math.min(Math.max(time, 0), total);
    while (this.poseIndex < this.motions.length - 1 && starts[this.poseIndex] + durations[this.poseIndex] < t) this.poseIndex += 1;
    const motion = this.motions[this.poseIndex];
    const u = durations[this.poseIndex] > 0 ? Math.min(Math.max((t - starts[this.poseIndex]) / durations[this.poseIndex], 0), 1) : 1;
    return { tip: lerp3(motion.from, motion.to, u), axis: this.axisAt(motion, u), tool: motion.tool, line: motion.line, motion: this.poseIndex };
  }

  private axisAt(motion: Motion, t: number): Vec3 {
    if (!motion.axisFrom || !motion.axisTo) return UP;
    return lerpAxis(motion.axisFrom, motion.axisTo, t);
  }

  private samplesFor(motion: Motion): number {
    const length = Math.hypot(motion.to[0] - motion.from[0], motion.to[1] - motion.from[1], motion.to[2] - motion.from[2]);
    const spec = this.tools[motion.tool] ?? this.tools[0];
    const cell = Math.min(this.grid.dx, this.grid.dy, this.grid.dz);
    const radius = spec.diameter / 2;
    const reach = Math.min(this.profiles[motion.tool]?.cutH ?? 10, 40) + radius;
    const turn = motion.axisFrom && motion.axisTo ? (axisAngle(motion.axisFrom, motion.axisTo) * Math.PI * reach) / 180 : 0;
    const step = motion.kind === "rapid"
      ? Math.min(Math.max(Math.min(cell, radius * 0.5), 0.3), 2)
      : Math.min(Math.max(Math.min(cell * 0.6, radius * 0.3), 0.1), 1);
    return Math.min(3000, Math.max(1, Math.ceil((length + turn) / step)));
  }

  private fail(kind: CollisionKind, motion: Motion, point: Vec3, axis: Vec3, message: string): void {
    this.collision = { kind, line: motion.line, motion: this.motionIndex, point, message };
    this.frozen = { tip: point, axis, tool: motion.tool, line: motion.line, motion: this.motionIndex };
  }

  private sample(motion: Motion, point: Vec3, axis: Vec3): void {
    const spec = this.tools[motion.tool] ?? this.tools[0];
    const profile = this.profiles[motion.tool] ?? this.profiles[0];
    const lineNumber = motion.line + 1;
    const name = toolName(spec);
    const { z0, top } = this.grid;

    const lowest = Math.min(point[2], point[2] + axis[2] * profile.cutH) - profile.maxR * Math.sqrt(Math.max(1 - axis[2] * axis[2], 0));
    const tableClear = spec.kind === "drill" ? profile.maxR * 0.6 + 1.5 : 3;
    if (lowest < z0 - tableClear) {
      this.fail("table", motion, point, axis, `Line ${lineNumber}: the ${name} reaches Z${Math.round(lowest * 10) / 10}, below the stock bottom (Z${Math.round(z0 * 10) / 10}). It would crash into the vise or table.`);
      return;
    }

    if (motion.kind === "rapid") {
      const hit = this.probe(point, axis, 0, profile.cutH, profile.radiusAt) ?? this.probe(point, axis, profile.cutH, profile.cutH + SHANK_LENGTH, () => profile.shankR);
      if (hit) {
        this.fail("rapid", motion, point, axis, `Line ${lineNumber}: rapid move (G00) drives the ${name} into the stock at ${describePoint(point, false)}. Stock top is Z${Math.round(top * 10) / 10}. Use a feed move (G01) to cut.`);
      }
      return;
    }

    if (this.probe(point, axis, profile.cutH + 0.05, profile.cutH + SHANK_LENGTH, () => profile.shankR)) {
      const undercut = spec.kind === "tslot" || spec.kind === "dovetail";
      this.fail("holder", motion, point, axis, `Line ${lineNumber}: the ${name} hits the stock above its cutting part at ${describePoint(point, false)}. ${undercut ? "The neck is thinner than the cutter, so the slot must be reached through an opening wide enough for the neck." : "Only the cutting length can enter the material, so the shank or holder crashes."}`);
      return;
    }

    if (!motion.spindle && this.probe(point, axis, 0.05, profile.cutH, profile.radiusAt)) {
      this.fail("spindle", motion, point, axis, `Line ${lineNumber}: the ${name} cuts at ${describePoint(point, false)} with the spindle off. Add M03 before the cutting move.`);
      return;
    }

    const before = this.removed;
    this.carve(point, axis, spec, profile);
    this.removedByMotion[this.motionIndex] += (this.removed - before) * this.cellVolume;
  }

  /** True when stock stands at a point. Used by tests and the viewer. */
  isSolid(x: number, y: number, z: number): boolean {
    return this.occupiedAt(x, y, z);
  }

  private occupiedAt(x: number, y: number, z: number): boolean {
    const { x0, y0, z0, dx, dy, dz, nx, ny, nz } = this.grid;
    const ix = Math.floor((x - x0) / dx + EPS);
    const iy = Math.floor((y - y0) / dy + EPS);
    const iz = Math.floor((z - z0) / dz + EPS);
    if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) return false;
    return this.state.occ[(iz * ny + iy) * nx + ix] !== 0;
  }

  /** Samples the tool solid between two heights along its axis. Returns a point inside stock, or null. */
  private probe(point: Vec3, axis: Vec3, h0: number, h1: number, radiusAt: (h: number) => number): Vec3 | null {
    // A box counts as removed when its centre is inside the tool, so the probe stays half a box inside the solid.
    const slack = Math.hypot(this.grid.dx, this.grid.dy, this.grid.dz) / 2;
    h0 += slack;
    h1 -= slack;
    if (h1 < h0) return null;
    const [u, w] = basis(axis);
    const step = Math.max(Math.min(this.grid.dx, this.grid.dy, this.grid.dz) * 0.9, 0.3);
    const count = Math.max(1, Math.ceil((h1 - h0) / step));
    for (let k = 0; k <= count; k += 1) {
      const h = h0 + ((h1 - h0) * k) / count;
      const radius = Math.max(radiusAt(h) - slack, 0);
      const cx = point[0] + axis[0] * h;
      const cy = point[1] + axis[1] * h;
      const cz = point[2] + axis[2] * h;
      if (this.occupiedAt(cx, cy, cz)) return [cx, cy, cz];
      if (radius < 0.05) continue;
      for (const ring of [0.5, 1]) {
        const rr = radius * ring;
        for (let a = 0; a < 8; a += 1) {
          const angle = (a / 8) * Math.PI * 2 + (ring === 1 ? Math.PI / 8 : 0);
          const cs = Math.cos(angle) * rr;
          const sn = Math.sin(angle) * rr;
          const x = cx + u[0] * cs + w[0] * sn;
          const y = cy + u[1] * cs + w[1] * sn;
          const z = cz + u[2] * cs + w[2] * sn;
          if (this.occupiedAt(x, y, z)) return [x, y, z];
        }
      }
    }
    return null;
  }

  private carve(point: Vec3, axis: Vec3, spec: ToolSpec, profile: Profile): void {
    if (spec.kind === "tap") return;
    const { nx, ny, nz, dx, dy, dz, x0, y0, z0 } = this.grid;
    const occ = this.state.occ;
    const end: Vec3 = [point[0] + axis[0] * profile.cutH, point[1] + axis[1] * profile.cutH, point[2] + axis[2] * profile.cutH];
    const reach = (k: number) => profile.maxR * Math.sqrt(Math.max(1 - axis[k] * axis[k], 0));
    const lo = (k: number) => Math.min(point[k], end[k]) - reach(k);
    const hi = (k: number) => Math.max(point[k], end[k]) + reach(k);
    const ix0 = Math.max(0, Math.floor((lo(0) - x0) / dx));
    const ix1 = Math.min(nx - 1, Math.ceil((hi(0) - x0) / dx));
    const iy0 = Math.max(0, Math.floor((lo(1) - y0) / dy));
    const iy1 = Math.min(ny - 1, Math.ceil((hi(1) - y0) / dy));
    const iz0 = Math.max(0, Math.floor((lo(2) - z0) / dz));
    const iz1 = Math.min(nz - 1, Math.ceil((hi(2) - z0) / dz));
    for (let iz = iz0; iz <= iz1; iz += 1) {
      const rz = z0 + (iz + 0.5) * dz - point[2];
      for (let iy = iy0; iy <= iy1; iy += 1) {
        const ry = y0 + (iy + 0.5) * dy - point[1];
        let index = (iz * ny + iy) * nx + ix0;
        for (let ix = ix0; ix <= ix1; ix += 1, index += 1) {
          if (occ[index] === 0) continue;
          const rx = x0 + (ix + 0.5) * dx - point[0];
          const h = rx * axis[0] + ry * axis[1] + rz * axis[2];
          if (h < 0 || h > profile.cutH) continue;
          const radius = profile.radiusAt(h);
          if (rx * rx + ry * ry + rz * rz - h * h > radius * radius) continue;
          occ[index] = 0;
          this.removed += 1;
          this.dirty = true;
          // The faces that the cut exposed take the "cut" colour.
          if (ix > 0 && occ[index - 1] === 1) occ[index - 1] = 2;
          if (ix < nx - 1 && occ[index + 1] === 1) occ[index + 1] = 2;
          if (iy > 0 && occ[index - nx] === 1) occ[index - nx] = 2;
          if (iy < ny - 1 && occ[index + nx] === 1) occ[index + nx] = 2;
          if (iz > 0 && occ[index - nx * ny] === 1) occ[index - nx * ny] = 2;
          if (iz < nz - 1 && occ[index + nx * ny] === 1) occ[index + nx * ny] = 2;
        }
      }
    }
  }
}

/** Boxes that remain. Used to compare two states. */
export function voxelCount(state: VoxelState): number {
  let total = 0;
  for (let index = 0; index < state.occ.length; index += 1) if (state.occ[index] !== 0) total += 1;
  return total;
}
