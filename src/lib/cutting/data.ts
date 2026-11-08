import { machineLimits, stockTool, tapByNominal, type Material, type MachineLimits, type ToolFamily } from "@/lib/cutting/library";

export interface CutData {
  /** Spindle speed in rpm. */
  rpm: number;
  /** Cutting feed in mm/min for mills and drills, mm/rev for turning. */
  feed: number;
  /** Feed while plunging, mm/min. */
  plunge: number;
  /** Surface speed in m/min after the machine limit. */
  vc: number;
  /** Chip load per tooth (mills) or feed per revolution (drills and lathe). */
  fz: number;
  note?: string;
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
const round = (value: number, places = 0) => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

/** Chip load per tooth for a carbide end mill, from the diameter, before the material factor. */
export function baseChipLoad(diameter: number): number {
  return clamp(0.012 + 0.0042 * diameter, 0.012, 0.13);
}

export interface MillCutInput {
  material: Material;
  machine?: MachineLimits;
  family: Exclude<ToolFamily, "od" | "bore">;
  diameter: number;
  /** Slotting cuts with the whole tool width and runs slower. */
  slot?: boolean;
  /** Finishing runs a lighter chip. */
  finish?: boolean;
}

export function millCut(input: MillCutInput): CutData {
  const machine = input.machine ?? machineLimits("vmc");
  const { material } = input;
  const diameter = Math.max(input.diameter, 0.5);
  const tool = stockTool(input.family, diameter, material);

  if (input.family === "drill") {
    const wanted = (1000 * material.vcDrill) / (Math.PI * diameter);
    const rpm = round(clamp(wanted, 100, machine.maxRpm), -1);
    const perRev = clamp(material.drillK * diameter, 0.02, 0.45);
    return { rpm, feed: round(rpm * perRev), plunge: round(rpm * perRev), vc: round((Math.PI * diameter * rpm) / 1000), fz: round(perRev, 3) };
  }

  if (input.family === "tap") {
    const tap = tapByNominal(diameter);
    const wanted = (1000 * material.vcTap) / (Math.PI * tap.nominal);
    const rpm = round(clamp(wanted, 60, Math.min(machine.maxRpm, 1500)), -1);
    // A rigid tap advances one pitch every turn, so the feed has to follow the speed.
    return { rpm, feed: round(rpm * tap.pitch), plunge: round(rpm * tap.pitch), vc: round((Math.PI * tap.nominal * rpm) / 1000), fz: tap.pitch, note: `${tap.name} x ${tap.pitch}` };
  }

  const vcBase = input.family === "ball" ? material.vcMill * 0.85 : material.vcMill;
  const vc = vcBase * (input.finish ? 1.15 : 1);
  const rpm = round(clamp((1000 * vc) / (Math.PI * diameter), 200, machine.maxRpm), -1);
  const perTooth = baseChipLoad(diameter) * material.fzScale * (input.slot ? 0.6 : 1) * (input.finish ? 0.7 : 1) * (input.family === "face" ? 0.8 : 1);
  const feed = round(clamp(rpm * tool.flutes * perTooth, 50, machine.maxFeed), -1);
  return { rpm, feed, plunge: round(Math.max(feed * 0.35, 40), -1), vc: round((Math.PI * diameter * rpm) / 1000), fz: round(perTooth, 3) };
}

export interface TurnCutInput {
  material: Material;
  machine?: MachineLimits;
  kind: "rough" | "finish" | "bore" | "drill";
  /** Drill or bore diameter, mm. */
  diameter?: number;
}

/** Turning data. Rough, finish and bore run at a constant surface speed. A drill runs at a fixed rpm. */
export function turnCut(input: TurnCutInput): CutData {
  const machine = input.machine ?? machineLimits("lathe");
  const { material } = input;
  if (input.kind === "drill") {
    const diameter = Math.max(input.diameter ?? 10, 1);
    const rpm = round(clamp((1000 * material.vcDrill) / (Math.PI * diameter), 150, machine.maxRpm), -1);
    const perRev = clamp(material.drillK * diameter, 0.03, 0.35);
    return { rpm, feed: round(perRev, 3), plunge: round(perRev, 3), vc: round((Math.PI * diameter * rpm) / 1000), fz: round(perRev, 3) };
  }
  const vc = material.vcTurn * (input.kind === "finish" ? 1.2 : input.kind === "bore" ? 0.8 : 1);
  const feed = material.feedTurn * (input.kind === "finish" ? 0.4 : input.kind === "bore" ? 0.45 : 1);
  return { rpm: machine.maxRpm, feed: round(feed, 2), plunge: round(feed * 0.5, 2), vc: round(vc), fz: round(feed, 2) };
}
