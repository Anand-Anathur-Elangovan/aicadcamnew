import { findMaterial, machineLimits, timingOf, type MachineLimits, type Material } from "@/lib/cutting/library";
import { createEngine, type SimJob } from "@/lib/sim/prepare";
import { motionSeconds, spindleRpm } from "@/lib/sim/stats";
import type { Motion, ToolKind } from "@/lib/sim/types";

/** Taylor tool-life exponent for coated carbide. Tool life falls with the fourth power of the speed. */
const TAYLOR_N = 0.25;

export interface ToolLoad {
  index: number;
  name: string;
  kind: ToolKind;
  /** Minutes this tool spends cutting metal in the program. */
  cutMinutes: number;
  /** Average surface speed while cutting, m/min. */
  vc: number;
  peakKw: number;
  /** Peak tangential cutting force, N. */
  peakForceN: number;
  /** Minutes of cutting one edge lasts at this speed. */
  lifeMinutes: number;
  /** Share of that life this program uses. */
  lifeUsedPercent: number;
}

export interface LoadReport {
  material: Material;
  recognised: boolean;
  machine: MachineLimits;
  tools: ToolLoad[];
  peakKw: number;
  averageKw: number;
  peakForceN: number;
  /** Peak spindle power as a share of the machine's rating. */
  spindleLoadPercent: number;
  cutMinutes: number;
  warnings: string[];
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

const FLUTES: Record<ToolKind, number> = { flat: 4, ball: 2, face: 5, drill: 2, tap: 1, od: 1, bore: 1, tslot: 6, dovetail: 4 };

function toolName(kind: ToolKind, diameter: number): string {
  const names: Record<ToolKind, string> = { flat: "end mill", ball: "ball cutter", face: "face mill", drill: "drill", tap: "tap", od: "turning insert", bore: "boring tool", tslot: "T-slot cutter", dovetail: "dovetail cutter" };
  return diameter > 0 ? `${names[kind]} D${Math.round(diameter * 10) / 10}` : names[kind];
}

function referenceSpeed(kind: ToolKind, material: Material): number {
  if (kind === "drill") return material.vcDrill;
  if (kind === "tap") return material.vcTap;
  if (kind === "od") return material.vcTurn;
  if (kind === "bore") return material.vcTurn * 0.8;
  if (kind === "ball") return material.vcMill * 0.85;
  return material.vcMill;
}

function chipThickness(motion: Motion, kind: ToolKind, rpm: number): number {
  const perRevolution = motion.perRev ? (motion.f > 0 ? motion.f : 0.1) : rpm > 0 ? motion.f / rpm : 0.05;
  if (kind === "od" || kind === "bore") return clamp(perRevolution * 0.95, 0.03, 1);
  if (kind === "drill") return clamp(perRevolution / 2, 0.02, 0.5);
  if (kind === "tap") return 0.05;
  return clamp((perRevolution / FLUTES[kind]) * 0.8, 0.02, 0.5);
}

/**
 * Spindle power, cutting force and tool wear for a program.
 * The simulator reports how much metal each move removes. Power then follows from the Kienzle cutting force,
 * and tool life from the Taylor equation. These are estimates for planning, good to roughly 25 percent.
 */
export function analyzeLoad(job: SimJob, materialName: string | Material | undefined, machineId?: string): LoadReport {
  const { material, recognised } = materialName && typeof materialName === "object" ? { material: materialName, recognised: true } : findMaterial(materialName);
  const machine = machineLimits(machineId ?? (job.program.lathe ? "lathe" : "vmc"));
  const engine = createEngine(job);
  engine.advanceTo(engine.duration + 1);
  const removed = (engine as unknown as { removedByMotion?: Float64Array }).removedByMotion;
  const lathe = job.program.lathe;
  const tools = new Map<number, { seconds: number; vcTime: number; peakKw: number; peakForce: number }>();
  let energy = 0;
  let seconds = 0;
  let peakKw = 0;
  let peakForce = 0;

  job.program.motions.forEach((motion, index) => {
    const volume = removed?.[index] ?? 0;
    if (motion.kind !== "feed" || volume <= 0) return;
    const time = motionSeconds(motion, lathe, timingOf(machine));
    if (time < 0.02) return;
    const spec = job.program.tools[motion.tool];
    if (!spec) return;
    const rpm = lathe && motion.css ? spindleRpm(motion, true, machine.maxRpm) : motion.s > 0 ? motion.s : 500;
    const diameter = lathe ? (spec.kind === "drill" ? spec.diameter : Math.max((Math.abs(motion.from[0]) + Math.abs(motion.to[0])) / 2, 1)) : spec.diameter;
    const vc = (Math.PI * diameter * rpm) / 1000;
    if (vc <= 0) return;
    const h = chipThickness(motion, spec.kind, rpm);
    const kc = material.kc11 * h ** -material.mc;
    const flowMm3PerSecond = volume / time;
    const cuttingWatts = kc * flowMm3PerSecond * 1e-3;
    const kw = cuttingWatts / 1000 / machine.efficiency;
    const force = (cuttingWatts * 60) / vc;
    const entry = tools.get(motion.tool) ?? { seconds: 0, vcTime: 0, peakKw: 0, peakForce: 0 };
    entry.seconds += time;
    entry.vcTime += vc * time;
    entry.peakKw = Math.max(entry.peakKw, kw);
    entry.peakForce = Math.max(entry.peakForce, force);
    tools.set(motion.tool, entry);
    energy += kw * time;
    seconds += time;
    peakKw = Math.max(peakKw, kw);
    peakForce = Math.max(peakForce, force);
  });

  const warnings: string[] = [];
  const rows: ToolLoad[] = [...tools.entries()].map(([index, entry]) => {
    const spec = job.program.tools[index];
    const vc = entry.vcTime / entry.seconds;
    const reference = referenceSpeed(spec.kind, material);
    const lifeMinutes = clamp(60 * (reference / vc) ** (1 / TAYLOR_N), 1, 999);
    const cutMinutes = entry.seconds / 60;
    const row: ToolLoad = {
      index,
      name: toolName(spec.kind, spec.diameter),
      kind: spec.kind,
      cutMinutes,
      vc,
      peakKw: entry.peakKw,
      peakForceN: entry.peakForce,
      lifeMinutes,
      lifeUsedPercent: (cutMinutes / lifeMinutes) * 100,
    };
    if (vc > reference * 1.3) warnings.push(`The ${row.name} runs at ${Math.round(vc)} m/min, well above the ${Math.round(reference)} m/min that suits ${material.label}. Expect short tool life.`);
    if (row.lifeUsedPercent > 100) warnings.push(`The ${row.name} is worn out before this program ends (${Math.round(row.lifeUsedPercent)}% of an edge). Lower the speed or plan an edge change.`);
    return row;
  });

  const loadPercent = (peakKw / machine.kw) * 100;
  if (loadPercent > 100) warnings.push(`Peak spindle power is ${peakKw.toFixed(1)} kW, above the ${machine.kw} kW of the ${machine.label}. Take lighter cuts.`);
  else if (loadPercent > 80) warnings.push(`Peak spindle power is ${peakKw.toFixed(1)} kW, ${Math.round(loadPercent)}% of the ${machine.kw} kW rating. There is little margin.`);
  if (!recognised) warnings.push(`The material "${materialName ?? "unknown"}" is not in the library, so carbon steel values are used.`);

  return {
    material,
    recognised,
    machine,
    tools: rows.sort((a, b) => a.index - b.index),
    peakKw,
    averageKw: seconds > 0 ? energy / seconds : 0,
    peakForceN: peakForce,
    spindleLoadPercent: loadPercent,
    cutMinutes: seconds / 60,
    warnings,
  };
}
