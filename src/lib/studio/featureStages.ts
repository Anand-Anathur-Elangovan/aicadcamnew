import { applyCutting } from "@/lib/cutting/planCutting";
import type { MachiningFeature, PartFeatures } from "@/lib/cad/featureExtractor";
import type { OperationType, ProcessOperation, ProcessPlan } from "@/lib/providers/capp.provider";
import { mergePartFeatures } from "@/lib/studio/mergeFeatures";
import { millProgram } from "@/lib/studio/millProgram";
import { evidenceNote } from "@/lib/studio/readingReview";
import { faceAllowance } from "@/lib/studio/stageSheets";
import {
  buildStagePlan,
  readTurningJob,
  type MachineChoice,
  type MachineId,
  type MachiningStage,
  type StagePlan,
  type TurningJob,
  type VisibleCut,
} from "@/lib/studio/stages";

const MACHINES: MachineChoice[] = [
  {
    id: "vmc",
    label: "VMC",
    recommended: false,
    reason: "A 3-axis VMC faces the stock, then cuts the features that open from the top.",
  },
  {
    id: "vmc5",
    label: "5-axis VMC",
    recommended: false,
    reason: "A complicated part with features on more than one face is shorter on a 5-axis machine.",
  },
  {
    id: "lathe",
    label: "CNC Lathe",
    recommended: false,
    reason: "A lathe is the shorter process when the finished shape is round.",
  },
];

function stockSize(features: PartFeatures): { length: number; width: number; height: number; stated: boolean } {
  const length = features.rawDimensions.length || 0;
  const width = features.rawDimensions.width || 0;
  const height = features.rawDimensions.height || features.rawDimensions.diameter || 0;
  const stated = length > 0 || width > 0 || height > 0;
  return {
    length: length || 120,
    width: width || 80,
    height: height || 25,
    stated,
  };
}

function machinesFor(features: PartFeatures): { machines: MachineChoice[]; selected: MachineId } {
  const rotational = features.partType === "rotational";
  const complex = features.partType === "complex" || features.estimatedComplexity === "high";
  const selected: MachineId = rotational ? "lathe" : complex ? "vmc5" : "vmc";
  return {
    selected,
    machines: MACHINES.map((machine) => ({ ...machine, recommended: machine.id === selected })),
  };
}

function cutFrom(feature: MachiningFeature, kind: VisibleCut["kind"], stock: { length: number; width: number; height: number }): VisibleCut {
  return {
    kind,
    count: Math.max(1, feature.count || 1),
    diameter: feature.diameter || (kind === "hole" ? 8 : 0),
    depth: feature.depth || Math.min(stock.height, kind === "pocket" ? stock.height * 0.4 : stock.height),
    width: feature.width || (kind === "slot" ? 10 : stock.width * 0.45),
    length: feature.length || (kind === "slot" ? stock.length * 0.6 : stock.length * 0.4),
    ...(feature.along != null ? { along: feature.along, across: feature.across } : {}),
    ...(feature.run ? { run: feature.run } : {}),
  };
}

interface StageDraft {
  name: string;
  type: OperationType;
  tool: string;
  toolDiameter: number;
  cuts: VisibleCut[];
  check: string;
}

function draftsFor(features: PartFeatures, stock: { length: number; width: number; height: number }): StageDraft[] {
  const ofType = (...types: MachiningFeature["type"][]) => features.features.filter((feature) => types.includes(feature.type));
  const drafts: StageDraft[] = [];
  const hasFace = ofType("face").length > 0 || features.partType !== "rotational";
  if (hasFace) {
    drafts.push({
      name: "Face the datum",
      type: "face_milling",
      tool: "50 mm face mill",
      toolDiameter: 50,
      cuts: [{ kind: "face", count: 1, diameter: 0, depth: faceAllowance(stock.height), width: stock.width, length: stock.length }],
      check: "Datum face is flat",
    });
  }
  if (ofType("profile").length > 0 || features.partType === "complex") {
    drafts.push({
      name: "Profile the outline",
      type: "profile_milling",
      tool: "16 mm end mill",
      toolDiameter: 16,
      cuts: [{ kind: "profile", count: 1, diameter: 0, depth: stock.height, width: stock.width, length: stock.length }],
      check: "Outside profile matches the drawing",
    });
  }
  const pockets = ofType("pocket");
  if (pockets.length) {
    drafts.push({
      name: "Machine pockets",
      type: "pocket_milling",
      tool: "10 mm end mill",
      toolDiameter: 10,
      cuts: pockets.map((feature) => cutFrom(feature, "pocket", stock)),
      check: "Pocket depth and floor",
    });
  }
  const slots = ofType("slot");
  if (slots.length) {
    drafts.push({
      name: "Machine slots",
      type: "profile_milling",
      tool: "8 mm end mill",
      toolDiameter: 8,
      cuts: slots.map((feature) => cutFrom(feature, "slot", stock)),
      check: "Slot width and depth",
    });
  }
  const holes = ofType("hole", "counterbore", "countersink");
  if (holes.length) {
    const diameter = holes.find((feature) => feature.diameter)?.diameter ?? 8;
    drafts.push({
      name: "Drill holes",
      type: "drilling",
      tool: `${diameter} mm drill`,
      toolDiameter: diameter,
      cuts: holes.map((feature) => cutFrom(feature, "hole", stock)),
      check: "Hole count, diameter, and depth",
    });
  }
  const bores = ofType("bore");
  if (bores.length) {
    const diameter = bores.find((feature) => feature.diameter)?.diameter ?? 16;
    drafts.push({
      name: "Bore",
      type: "boring",
      tool: `${diameter} mm boring bar`,
      toolDiameter: diameter,
      cuts: bores.map((feature) => cutFrom(feature, "hole", stock)),
      check: "Bore diameter",
    });
  }
  const threads = ofType("thread");
  if (threads.length) {
    drafts.push({
      name: "Tap threads",
      type: "tapping",
      tool: "Tap",
      toolDiameter: threads.find((feature) => feature.diameter)?.diameter ?? 6,
      cuts: [],
      check: "Thread gauge",
    });
  }
  if (ofType("chamfer", "fillet").length || drafts.length > 0) {
    drafts.push({
      name: "Deburr",
      type: "deburring",
      tool: "Deburr tool",
      toolDiameter: 6,
      cuts: [],
      check: "Edges are broken and the part is clean",
    });
  }
  if (!drafts.length) {
    drafts.push({
      name: "Machine from the drawing",
      type: "profile_milling",
      tool: "16 mm end mill",
      toolDiameter: 16,
      cuts: [],
      check: "The finished part matches the sheets",
    });
  }
  return drafts;
}

function program(
  features: PartFeatures,
  draft: StageDraft,
  opNumber: number,
  stock: { length: number; width: number; height: number },
  earlier: VisibleCut[],
  machine: string
): string {
  return millProgram({
    partNumber: features.partNumber || "UNKNOWN",
    opNumber,
    name: draft.name,
    type: draft.type,
    toolDiameter: draft.toolDiameter,
    cuts: draft.cuts,
    earlier: earlier.filter((cut) => cut.kind === "hole"),
    stock,
    material: features.material,
    machine,
  });
}

function asOperation(stage: MachiningStage, draft: StageDraft, minutes: number): ProcessOperation {
  return {
    opNumber: stage.opNumber,
    name: stage.name,
    type: draft.type,
    description: `${stage.holding}. Fixture: ${stage.fixture}. Tool point: ${stage.toolPoint}.`,
    tool: { type: stage.tool, diameter: draft.toolDiameter, material: "Carbide", coated: true },
    cuttingParams: { spindleSpeed: 3500, feedRate: 250, depthOfCut: draft.cuts.reduce((max, cut) => Math.max(max, cut.depth), 0), coolant: "flood" },
    setup: { clampingMethod: stage.holding, datumFace: stage.toolPoint },
    estimatedTime: minutes,
    qualityChecks: [draft.check],
  };
}

export function buildFeatureStagePlan(features: PartFeatures, machineId?: MachineId): StagePlan {
  const stock = stockSize(features);
  const choice = machinesFor(features);
  const selected = machineId ?? choice.selected;
  const machine = choice.machines.find((item) => item.id === selected) ?? choice.machines[0];
  const holding = machine.id === "lathe"
    ? "3-jaw chuck grips one end of the part"
    : machine.id === "vmc5"
      ? "Fixture on a 5-axis trunnion holds the part"
      : "Machine vice holds the long sides";
  const fixture = machine.id === "lathe" ? "3-jaw chuck" : machine.id === "vmc5" ? "5-axis trunnion fixture" : "Machine vice";
  const drafts = draftsFor(features, stock);
  let completed: VisibleCut[] = [];
  const stages: MachiningStage[] = drafts.map((draft, index) => {
    const previousCuts = completed;
    completed = [...completed, ...draft.cuts];
    const opNumber = (index + 1) * 10;
    const added = draft.cuts.reduce((sum, cut) => sum + cut.count, 0);
    const stage: MachiningStage = {
      opNumber,
      name: draft.name,
      holding,
      fixture,
      tool: draft.tool,
      toolPoint: added > 0
        ? `On the top face, cutting ${added} feature${added === 1 ? "" : "s"}`
        : "Along the finished edges",
      grip: 0,
      before: "block",
      after: "block",
      completed: [...completed],
      gcode: program(features, draft, opNumber, stock, previousCuts, machine.id),
    };
    return stage;
  });

  const job: TurningJob = {
    partName: features.partName || "Machined part",
    partNumber: features.partNumber || "UNKNOWN",
    revision: features.revision || "A",
    material: features.material || "UNKNOWN",
    stockWidth: stock.width,
    stockHeight: stock.height,
    stockLength: stock.length,
    diameter: features.rawDimensions.diameter ?? 0,
    bore: 0,
    length: stock.length,
  };
  const notes = [
    machine.reason,
    features.sourceFile ? `Read from ${features.sourceFile}.` : "",
    evidenceNote(features) ?? "",
    stock.stated ? "" : "The sheets did not state an overall size, so the 3D stock is a stand-in of 120 x 80 x 25 mm.",
  ].filter(Boolean);

  const plan: ProcessPlan = {
    partName: job.partName,
    partNumber: job.partNumber,
    revision: job.revision,
    material: job.material,
    machineType: machine.label,
    totalEstimatedTime: stages.length * 6,
    operations: stages.map((stage, index) => asOperation(stage, drafts[index], 6)),
    generalNotes: notes,
    generatedAt: new Date().toISOString(),
    model: "stage-planner",
  };

  return applyCutting({
    family: "machined",
    job,
    machines: choice.machines,
    selectedMachine: machine.id,
    stages,
    plan,
    features,
  });
}

export function planFromReadings(texts: string[], extracted: PartFeatures[]): StagePlan {
  const job = readTurningJob(texts.join("\n"));
  if (job) return applyCutting(buildStagePlan(job, "lathe"));
  const features = extracted.length ? mergePartFeatures(extracted) : emptySheet();
  return buildFeatureStagePlan(features);
}

export function rebuildStagePlan(plan: StagePlan, machineId: MachineId): StagePlan {
  if (plan.family === "machined") return buildFeatureStagePlan(plan.features, machineId);
  return applyCutting(buildStagePlan(plan.job, machineId === "vmc5" ? "vmc" : machineId));
}

function emptySheet(): PartFeatures {
  return {
    partName: "Machined part",
    partNumber: "UNKNOWN",
    revision: "A",
    material: "UNKNOWN",
    rawDimensions: { length: 0, width: 0, height: 0 },
    stockDimensions: { length: 0, width: 0, height: 0 },
    features: [],
    tolerances: [],
    surfaceFinishes: [],
    partType: "complex",
    estimatedComplexity: "medium",
    sourceFile: "",
    extractedAt: new Date().toISOString(),
    extractionMethod: "manual",
  };
}
