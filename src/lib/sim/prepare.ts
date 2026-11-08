import { interpretProgram } from "@/lib/sim/interpret";
import { programStats } from "@/lib/sim/stats";
import { LatheEngine, freshLatheState, type LatheState } from "@/lib/sim/latheEngine";
import { MillEngine, freshMillState, millGrid, type MillState } from "@/lib/sim/millEngine";
import type { Engine } from "@/lib/sim/timeline";
import { VoxelEngine, freshVoxelState, voxelGrid, type VoxelState } from "@/lib/sim/voxelEngine";
import type { InterpretOptions, LatheSetup, MillSetup, ParsedProgram, SimReport, SimSetup, Vec3 } from "@/lib/sim/types";

export type InitialState = { family: "mill"; state: MillState } | { family: "voxel"; state: VoxelState } | { family: "lathe"; state: LatheState };

export interface SimJob {
  setup: SimSetup;
  program: ParsedProgram;
  initial: InitialState;
  report: SimReport;
}

export function homeFor(setup: SimSetup): Vec3 {
  if (setup.family === "lathe") {
    const reach = setup.shape.kind === "round"
      ? setup.shape.diameter
      : Math.hypot(setup.shape.width, setup.shape.height);
    return [Math.ceil(reach) + 60, 0, 60];
  }
  return [setup.x0, setup.y0, Math.max(setup.top, 0) + 50];
}

function optionsFor(setup: SimSetup): InterpretOptions {
  return { home: homeFor(setup), lathe: setup.family === "lathe" };
}

export function createEngine(job: SimJob): Engine & { family: SimSetup["family"]; state: object } {
  if (job.setup.family === "lathe" && job.initial.family === "lathe") {
    return Object.assign(new LatheEngine(job.setup, job.program, job.initial.state), { family: "lathe" as const });
  }
  if (job.setup.family === "mill" && job.initial.family === "mill") {
    return Object.assign(new MillEngine(job.setup, job.program, job.initial.state), { family: "mill" as const });
  }
  if (job.setup.family === "mill" && job.initial.family === "voxel") {
    return Object.assign(new VoxelEngine(job.setup, job.program, job.initial.state), { family: "mill" as const });
  }
  throw new Error("Simulator setup does not match its stock.");
}

function changedCells(before: InitialState, after: { heights?: Float32Array; outer?: Float32Array; inner?: Float32Array; occ?: Uint8Array }): number {
  const compare = (a: Float32Array, b: Float32Array | undefined) => {
    let total = 0;
    if (!b) return total;
    for (let index = 0; index < a.length; index += 1) if (Math.abs(a[index] - b[index]) > 1e-4) total += 1;
    return total;
  };
  if (before.family === "voxel") {
    let total = 0;
    if (!after.occ) return total;
    for (let index = 0; index < after.occ.length; index += 1) if ((before.state.occ[index] !== 0) !== (after.occ[index] !== 0)) total += 1;
    return total;
  }
  if (before.family === "mill") return compare(before.state.heights, after.heights);
  return compare(before.state.outer, after.outer) + compare(before.state.inner, after.inner);
}

function runToEnd(engine: Engine): void {
  engine.advanceTo(engine.duration + 1);
}

/** Cuts every saved earlier program into fresh stock so this program starts from the real part. */
function buildStock(setup: SimSetup, solid: boolean): { initial: InitialState; warnings: string[] } {
  const warnings: string[] = [];
  const options = optionsFor(setup);
  if (setup.family === "lathe") {
    let state = freshLatheState(setup);
    setup.previous.forEach((text, index) => {
      const engine = new LatheEngine(setup, interpretProgram(text, options), state);
      runToEnd(engine);
      state = engine.state;
      if (engine.collision) warnings.push(`Earlier operation ${index + 1} collides: ${engine.collision.message}`);
    });
    return { initial: { family: "lathe", state }, warnings };
  }
  const earlier = setup.previous.map((text) => interpretProgram(text, options));
  if (solid || earlier.some((program) => program.multiAxis)) {
    let voxels: VoxelState = freshVoxelState(voxelGrid(setup));
    earlier.forEach((program, index) => {
      const engine = new VoxelEngine(setup, program, voxels);
      runToEnd(engine);
      voxels = engine.state;
      if (engine.collision) warnings.push(`Earlier operation ${index + 1} collides: ${engine.collision.message}`);
    });
    return { initial: { family: "voxel", state: voxels }, warnings };
  }
  let state: MillState = freshMillState(millGrid(setup));
  setup.previous.forEach((text, index) => {
    const engine = new MillEngine(setup, interpretProgram(text, options), state);
    runToEnd(engine);
    state = engine.state;
    if (engine.collision) warnings.push(`Earlier operation ${index + 1} collides: ${engine.collision.message}`);
  });
  return { initial: { family: "mill", state }, warnings };
}

/** Parses the program, builds the stock it starts from, and runs a silent pre-check for collisions. */
export function prepareSim(text: string, setup: SimSetup): SimJob {
  const program = interpretProgram(text, optionsFor(setup));
  const { initial, warnings } = buildStock(setup, Boolean(program.multiAxis));
  const job: SimJob = {
    setup,
    program,
    initial,
    report: { ...programStats(program), cutCells: 0, collision: null, warnings: [], moves: program.motions.length, feedMoves: 0, duration: 0 },
  };
  const engine = createEngine(job);
  runToEnd(engine);
  job.report = {
    ...programStats(program),
    cutCells: changedCells(job.initial, engine.state as never),
    collision: engine.collision,
    warnings: [...warnings, ...program.warnings],
    moves: program.motions.length,
    feedMoves: program.motions.filter((motion) => motion.kind === "feed").length,
    duration: engine.duration,
  };
  return job;
}

/** Guesses a stock for programs that have no job behind them, such as pasted code. */
export function inferSetup(text: string): SimSetup {
  const probe = interpretProgram(text, { home: [0, 0, 0] });
  if (probe.lathe) {
    let maxX = 0;
    let minZ = 0;
    for (const motion of probe.motions) {
      if (motion.home) continue;
      for (const point of [motion.from, motion.to]) {
        if (point[2] < 80) minZ = Math.min(minZ, point[2]);
        if (point[0] < 400) maxX = Math.max(maxX, point[0]);
      }
    }
    const diameter = Math.max(20, Math.ceil((maxX * 0.95) / 5) * 5);
    const length = Math.max(20, Math.ceil((-minZ + 10) / 5) * 5);
    const setup: LatheSetup = {
      family: "lathe",
      length,
      shape: { kind: "round", diameter },
      chuckZ: -(length - 12),
      chuckRadius: diameter * 0.72,
      previous: [],
    };
    return setup;
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = 0;
  for (const motion of probe.motions) {
    if (motion.home || motion.kind !== "feed") continue;
    for (const point of [motion.from, motion.to]) {
      minX = Math.min(minX, point[0]);
      maxX = Math.max(maxX, point[0]);
      minY = Math.min(minY, point[1]);
      maxY = Math.max(maxY, point[1]);
      minZ = Math.min(minZ, point[2]);
    }
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    maxX = 60;
    minY = 0;
    maxY = 40;
  }
  const margin = 10;
  const setup: MillSetup = {
    family: "mill",
    x0: Math.floor(minX - margin),
    y0: Math.floor(minY - margin),
    length: Math.ceil(maxX - minX + margin * 2),
    width: Math.ceil(maxY - minY + margin * 2),
    top: 0,
    bottom: Math.min(-10, Math.floor(minZ - 4)),
    previous: [],
  };
  return setup;
}
