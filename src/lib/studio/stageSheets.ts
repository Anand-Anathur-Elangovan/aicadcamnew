import type { StagePlan } from "@/lib/studio/stages";

/** Shop order for the stage sheets. Packaging is the last sheet. */
export const STAGE_SHEET_ORDER = ["raw", "bandsaw", "cnc", "vmc", "deburr", "pack"] as const;

export const SAW_ALLOWANCE_MM = 3;

export interface RawStockSheet {
  id: "raw";
  title: "Raw stock";
  partName: string;
  partNumber: string;
  revision: string;
  material: string;
  length: number;
  width: number;
  height: number;
  note: string;
}

export function rawStockSheet(plan: StagePlan): RawStockSheet {
  const job = plan.job;
  const bar = plan.family === "turning";
  return {
    id: "raw",
    title: "Raw stock",
    partName: job.partName,
    partNumber: job.partNumber,
    revision: job.revision,
    material: job.material,
    length: job.stockLength,
    width: job.stockWidth,
    height: job.stockHeight,
    note: bar
      ? "Rectangular bar before turning. No diameter and no bore yet."
      : "Block before facing, profiling, or any feature.",
  };
}

export interface BandsawSheet {
  id: "bandsaw";
  title: "Bandsaw";
  partName: string;
  partNumber: string;
  revision: string;
  material: string;
  incomingLength: number;
  blankLength: number;
  width: number;
  height: number;
  allowance: number;
  note: string;
}

export function bandsawSheet(plan: StagePlan): BandsawSheet {
  const raw = rawStockSheet(plan);
  return {
    id: "bandsaw",
    title: "Bandsaw",
    partName: raw.partName,
    partNumber: raw.partNumber,
    revision: raw.revision,
    material: raw.material,
    incomingLength: raw.length + SAW_ALLOWANCE_MM,
    blankLength: raw.length,
    width: raw.width,
    height: raw.height,
    allowance: SAW_ALLOWANCE_MM,
    note: "One cross cut. The blank below goes to the next machine. Width and thickness are not cut.",
  };
}

export const FACE_CUT_MM = 2;

/** Face cut is 2 mm on a thick plate, and never more than a tenth of a thin one. */
export function faceAllowance(height: number): number {
  if (!(height > 0)) return 0;
  const tenth = Math.round(height * 0.1 * 10) / 10;
  return Math.min(FACE_CUT_MM, tenth);
}

export interface CncSheet {
  id: "cnc";
  title: "CNC";
  partName: string;
  partNumber: string;
  revision: string;
  material: string;
  kind: "turn" | "face";
  length: number;
  width: number;
  height: number;
  diameter: number;
  grip: number;
  facedHeight: number;
  machine: string;
  note: string;
}

function keptDepth(depth: number | undefined, rawHeight: number, facedHeight: number): number {
  if (!depth || depth >= rawHeight - 0.2) return facedHeight;
  return Math.min(depth, facedHeight);
}

export function cncSheet(plan: StagePlan): CncSheet {
  const raw = rawStockSheet(plan);
  const turning = plan.family === "turning" && plan.job.diameter > 0;
  const grip = plan.stages[0]?.grip || 0;
  const allowance = faceAllowance(raw.height);
  return {
    id: "cnc",
    title: "CNC",
    partName: raw.partName,
    partNumber: raw.partNumber,
    revision: raw.revision,
    material: raw.material,
    kind: turning ? "turn" : "face",
    length: raw.length,
    width: raw.width,
    height: raw.height,
    diameter: turning ? plan.job.diameter : 0,
    grip: turning ? grip : 0,
    facedHeight: turning ? raw.height : Math.round((raw.height - allowance) * 10) / 10,
    machine: plan.plan.machineType,
    note: turning
      ? `CNC turns the outside diameter. The ${grip} mm grip stays square. The bore is not cut on this sheet.`
      : `CNC faces ${allowance} mm off the datum. Pockets and holes are not cut on this sheet.`,
  };
}

export interface VmcMark {
  kind: "hole" | "pocket" | "slot";
  count: number;
  diameter: number;
  depth: number;
  width: number;
  length: number;
  along?: number;
  across?: number;
  run?: "length" | "width";
}

export interface VmcSheet {
  id: "vmc";
  title: "VMC";
  partName: string;
  partNumber: string;
  revision: string;
  material: string;
  kind: "bore" | "features";
  length: number;
  width: number;
  height: number;
  diameter: number;
  grip: number;
  bore: number;
  marks: VmcMark[];
  note: string;
}

export function vmcSheet(plan: StagePlan): VmcSheet {
  const cnc = cncSheet(plan);
  const marks: VmcMark[] = [];
  for (const feature of plan.features.features) {
    if (feature.type === "hole" || feature.type === "counterbore" || feature.type === "countersink") {
      marks.push({
        kind: "hole",
        count: feature.count || 1,
        diameter: feature.diameter || 8,
        depth: keptDepth(feature.depth, cnc.height, cnc.facedHeight),
        width: 0,
        length: 0,
        ...(feature.along != null ? { along: feature.along, across: feature.across } : {}),
      });
    } else if (feature.type === "pocket" || feature.type === "slot") {
      marks.push({
        kind: feature.type === "slot" ? "slot" : "pocket",
        count: feature.count || 1,
        diameter: 0,
        depth: keptDepth(feature.depth, cnc.height, cnc.facedHeight),
        width: feature.width || cnc.width * 0.4,
        length: feature.length || cnc.length * 0.4,
        ...(feature.along != null ? { along: feature.along, across: feature.across } : {}),
        ...(feature.run ? { run: feature.run } : {}),
      });
    }
  }
  const bore = plan.family === "turning" ? plan.job.bore : 0;
  return {
    id: "vmc",
    title: "VMC",
    partName: cnc.partName,
    partNumber: cnc.partNumber,
    revision: cnc.revision,
    material: cnc.material,
    kind: bore > 0 ? "bore" : "features",
    length: cnc.length,
    width: cnc.width,
    height: cnc.kind === "face" ? cnc.facedHeight : cnc.height,
    diameter: cnc.diameter,
    grip: cnc.grip,
    bore,
    marks,
    note: bore > 0
      ? `Bore Ø${bore} mm through the turned diameter. The grip stays square.`
      : marks.length
        ? "VMC cuts the pockets and holes. The faced outline is already done."
        : "This part has no pocket or hole for the VMC.",
  };
}

export interface DeburrSheet {
  id: "deburr";
  title: "Deburr";
  partName: string;
  partNumber: string;
  revision: string;
  material: string;
  edges: string[];
  note: string;
}

export function deburrSheet(plan: StagePlan): DeburrSheet {
  const vmc = vmcSheet(plan);
  const edges = vmc.kind === "bore"
    ? [
      `Bore rim, Ø${vmc.bore} mm, at the open end`,
      `Free end of the Ø${vmc.diameter} mm diameter`,
      "Shoulder where the square grip meets the diameter",
    ]
    : ["Top outside edge of the finished block"];
  if (vmc.kind === "features") {
    for (const mark of vmc.marks) {
      edges.push(mark.kind === "hole"
        ? `Rim of ${mark.count} × Ø${mark.diameter} mm holes`
        : mark.kind === "slot"
          ? `Edge of ${mark.count} × ${mark.width} mm slot`
          : `Top edge of the ${mark.depth} mm pocket`);
    }
  }
  const identity = vmc;
  return {
    id: "deburr",
    title: "Deburr",
    partName: identity.partName,
    partNumber: identity.partNumber,
    revision: identity.revision,
    material: identity.material,
    edges,
    note: "Break only the edges marked in orange. No more material is removed from the size.",
  };
}

export interface PackSheet {
  id: "pack";
  title: "Pack";
  partName: string;
  partNumber: string;
  revision: string;
  material: string;
  finished: string;
  quantity: number;
  checks: string[];
  note: string;
}

export function packSheet(plan: StagePlan): PackSheet {
  const vmc = vmcSheet(plan);
  const deburr = deburrSheet(plan);
  const finished = vmc.kind === "bore"
    ? `Ø${vmc.diameter} × ${vmc.length} mm, bore Ø${vmc.bore} mm`
    : `${vmc.length} × ${vmc.width} × ${vmc.height} mm`;
  return {
    id: "pack",
    title: "Pack",
    partName: vmc.partName,
    partNumber: vmc.partNumber,
    revision: vmc.revision,
    material: vmc.material,
    finished,
    quantity: 1,
    checks: [
      "Part number and revision on the label match this sheet",
      `All ${deburr.edges.length} deburr edges are broken`,
      vmc.kind === "bore" ? "Bore is open, clean, and free of chips" : "Holes and pockets are clean and dry",
    ],
    note: "One finished piece. No more cutting. Protect the machined faces in the pack.",
  };
}
