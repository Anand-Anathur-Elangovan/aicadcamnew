import type { PartFeatures } from "@/lib/cad/featureExtractor";
import { millCut, turnCut } from "@/lib/cutting/data";
import { findMaterial, machineLimits } from "@/lib/cutting/library";
import type { ProcessOperation, ProcessPlan } from "@/lib/providers/capp.provider";

/** A rectangular bar that is turned round and then bored. Other drawing families can sit beside this one. */
export interface TurningJob {
  partName: string;
  partNumber: string;
  revision: string;
  material: string;
  stockWidth: number;
  stockHeight: number;
  stockLength: number;
  diameter: number;
  bore: number;
  length: number;
}

export type MachineId = "lathe" | "vmc" | "vmc5";

export interface VisibleCut {
  kind: "hole" | "pocket" | "slot" | "face" | "profile";
  count: number;
  diameter: number;
  depth: number;
  width: number;
  length: number;
  along?: number;
  across?: number;
  run?: "length" | "width";
}

export interface MachineChoice {
  id: MachineId;
  label: string;
  recommended: boolean;
  reason: string;
}

export interface MachiningStage {
  opNumber: number;
  name: string;
  holding: string;
  fixture: string;
  tool: string;
  toolPoint: string;
  grip: number;
  before: "bar" | "cylinder" | "block";
  after: "cylinder" | "tube" | "block";
  /** Features finished when this operation ends. Earlier operations stay in the list. */
  completed?: VisibleCut[];
  gcode: string;
}

export interface StagePlan {
  family: "turning" | "machined";
  job: TurningJob;
  machines: MachineChoice[];
  selectedMachine: MachineId;
  stages: MachiningStage[];
  plan: ProcessPlan;
  features: PartFeatures;
}

const MACHINES: MachineChoice[] = [
  {
    id: "lathe",
    label: "CNC Lathe",
    recommended: true,
    reason: "The finished part is round and hollow, so a lathe turns the outside and then bores the hole from the same chuck grip.",
  },
  {
    id: "vmc",
    label: "VMC",
    recommended: false,
    reason: "A VMC can mill the bar round in layers and drill the bore with the bar standing in a vice. The lathe is the shorter process for this shape.",
  },
];

export function readTurningJob(text: string): TurningJob | null {
  const stock = /rectangular bar\s+(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i.exec(text);
  const diameter = /outside diameter:\s*(\d+(?:\.\d+)?)/i.exec(text);
  const bore = /bore:\s*(\d+(?:\.\d+)?)/i.exec(text);
  const length = /finished length:\s*(\d+(?:\.\d+)?)/i.exec(text);
  if (!stock || !diameter || !bore || !length) return null;

  const stockWidth = Number(stock[1]);
  const stockHeight = Number(stock[2]);
  const stockLength = Number(stock[3]);
  const od = Number(diameter[1]);
  const id = Number(bore[1]);
  const finishedLength = Number(length[1]);
  if (od >= Math.min(stockWidth, stockHeight)) return null;
  if (id >= od || finishedLength > stockLength) return null;

  const partNumber = /part number:\s*([A-Z0-9-]+)/i.exec(text)?.[1] ?? "HC-100";
  const revision = /revision:\s*([A-Z0-9]+)/i.exec(text)?.[1] ?? "A";
  const material = /material:\s*([^\n]+)/i.exec(text)?.[1]?.trim() ?? "Aluminium 6061-T6";

  return {
    partName: "Hollow cylinder",
    partNumber,
    revision,
    material,
    stockWidth,
    stockHeight,
    stockLength,
    diameter: od,
    bore: id,
    length: finishedLength,
  };
}

function gripLength(job: TurningJob): number {
  return Math.min(12, Math.round(job.length * 0.15));
}

function latheProgram(job: TurningJob, stage: "turn" | "bore"): string {
  const grip = gripLength(job);
  const cut = (job.length - grip).toFixed(1);
  const material = findMaterial(job.material).material;
  const machine = machineLimits("lathe");
  const rough = turnCut({ material, machine, kind: "rough" });
  const pilotSize = job.bore > 8 ? Math.max(job.bore * 0.75, job.bore - 4) : job.bore;
  const drillData = turnCut({ material, machine, kind: "drill", diameter: pilotSize });
  const boreData = turnCut({ material, machine, kind: "bore", diameter: job.bore });
  const boreRpm = Math.round(Math.min(Math.max((1000 * boreData.vc) / (Math.PI * Math.max(job.bore, 1)), 300), machine.maxRpm) / 10) * 10;
  if (stage === "turn") {
    return `%
O0100 (${job.partNumber} OP10 TURN OD)
G21 G18 G40 G99
G28 U0 W0
T0101
G50 S${machine.maxRpm}
G96 S${rough.vc} M03
G00 X${(Math.max(job.stockWidth, job.stockHeight) + 2).toFixed(1)} Z2.
G01 X${job.diameter.toFixed(1)} F${rough.plunge}
G01 Z-${cut} F${rough.feed}
G00 X${(job.diameter + 4).toFixed(1)}
G28 U0 W0
M30
%
`;
  }
  const bore = job.bore;
  const pilot = bore > 8 ? Math.max(bore * 0.75, bore - 4) : bore;
  const pilotText = `(TOOL DRILL D${pilot.toFixed(1)})
T0505
G97 S${drillData.rpm} M03
G00 X0 Z2.
G01 Z-${cut} F${drillData.feed}
G00 Z2.
G28 U0 W0
`;
  const boreText = bore > 8
    ? `(TOOL BORE D${(bore - 4).toFixed(1)})
T0303
G97 S${boreRpm} M03
G00 X${(pilot - 1).toFixed(1)} Z2.
G01 X${bore.toFixed(1)} F${boreData.plunge}
G01 Z-${cut} F${boreData.feed}
G01 X${(bore - 1).toFixed(1)}
G00 Z2.
G28 U0 W0
`
    : "";
  return `%
O0200 (${job.partNumber} OP20 DRILL AND BORE)
G21 G18 G40 G99
G28 U0 W0
${pilotText}${boreText}M30
%
`;
}

function ringRadii(job: TurningJob, toolRadius: number): number[] {
  const finish = job.diameter / 2 + toolRadius;
  const corner = Math.hypot(job.stockWidth / 2, job.stockHeight / 2);
  const step = toolRadius * 1.4;
  const radii = [finish];
  while (radii[radii.length - 1] + toolRadius < corner + 0.5) radii.push(radii[radii.length - 1] + step);
  return radii.reverse();
}

function fixed(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/** Bar stands on end in a vice. A flat end mill circles the bar down in layers, then a boring head opens the bore. No rotary axis is needed. */
function vmcProgram(job: TurningJob, stage: "turn" | "bore"): string {
  const grip = gripLength(job);
  const cut = job.length - grip;
  const cx = job.stockWidth / 2;
  const cy = job.stockHeight / 2;
  const material = findMaterial(job.material).material;
  const machine = machineLimits("vmc");
  if (stage === "turn") {
    const toolDiameter = 16;
    const radius = toolDiameter / 2;
    const data = millCut({ material, machine, family: "flat", diameter: toolDiameter });
    const rings = ringRadii(job, radius);
    const outside = job.stockWidth + radius + 2;
    const layers = Math.max(1, Math.ceil(cut / 6));
    const lines = [
      "%",
      `O0110 (${job.partNumber} OP10 PROFILE OD ON VMC)`,
      "G21 G17 G90 G40 G49",
      `(TOOL FLAT D${toolDiameter})`,
      "T01 M06",
      `S${data.rpm} M03`,
      `G00 X${fixed(outside)} Y${fixed(cy)}`,
      "G43 H01 Z50.",
      "G00 Z2.",
    ];
    for (let layer = 1; layer <= layers; layer += 1) {
      lines.push(`G01 Z${fixed(-(cut * layer) / layers)} F${data.plunge}`);
      for (const ring of rings) {
        lines.push(`G01 X${fixed(cx + ring)} F${data.feed}`, `G02 X${fixed(cx + ring)} Y${fixed(cy)} I${fixed(-ring)} J0 F${data.feed}`);
      }
      lines.push(`G01 X${fixed(outside)} F${data.feed}`);
    }
    lines.push("G00 Z50.", "M05", "M30", "%", "");
    return lines.join("\n");
  }
  const pilot = job.bore > 8 ? Math.max(job.bore * 0.75, job.bore - 4) : job.bore;
  const tool = (number: number, diameter: number, boring: boolean) => {
    const drillData = millCut({ material, machine, family: "drill", diameter });
    const headRpm = Math.round(Math.min(Math.max((1000 * material.vcTurn * 0.8) / (Math.PI * Math.max(diameter, 1)), 300), machine.maxRpm) / 10) * 10;
    const headFeed = Math.round(headRpm * 0.08);
    return [
    `(TOOL ${boring ? "BORE" : "DRILL"} D${fixed(diameter)})`,
    `T${String(number).padStart(2, "0")} M06`,
    boring ? `S${headRpm} M03` : `S${drillData.rpm} M03`,
    `G00 X${fixed(cx)} Y${fixed(cy)}`,
    `G43 H${String(number).padStart(2, "0")} Z50.`,
    boring
      ? `G99 G85 X${fixed(cx)} Y${fixed(cy)} Z${fixed(-cut)} R2. F${headFeed}`
      : `G99 G83 X${fixed(cx)} Y${fixed(cy)} Z${fixed(-cut - diameter * 0.3)} R2. Q${fixed(Math.min(diameter, 10))} F${drillData.feed}`,
    "G80",
    "G00 Z50.",
    ];
  };
  return [
    "%",
    `O0210 (${job.partNumber} OP20 DRILL AND BORE ON VMC)`,
    "G21 G17 G90 G40 G49",
    ...tool(2, pilot, false),
    ...(job.bore > 8 ? tool(3, job.bore, true) : []),
    "M05",
    "M30",
    "%",
    "",
  ].join("\n");
}

function operation(stage: MachiningStage, minutes: number): ProcessOperation {
  return {
    opNumber: stage.opNumber,
    name: stage.name,
    type: stage.after === "tube" ? "boring" : "turning",
    description: `${stage.holding}. Fixture: ${stage.fixture}. Tool point: ${stage.toolPoint}.`,
    tool: {
      type: stage.tool,
      diameter: stage.after === "tube" ? 12 : 16,
      material: "Carbide",
      coated: true,
    },
    cuttingParams: {
      spindleSpeed: stage.after === "tube" ? 900 : 1800,
      feedRate: stage.after === "tube" ? 120 : 200,
      depthOfCut: 2,
      coolant: "flood",
    },
    setup: { clampingMethod: stage.holding, datumFace: stage.toolPoint },
    estimatedTime: minutes,
    qualityChecks: [
      stage.after === "tube" ? "Bore diameter and that the hole stops clear of the jaws" : "Outside diameter along the turned length",
    ],
  };
}

export function buildStagePlan(job: TurningJob, machineId: MachineId): StagePlan {
  const machine = MACHINES.find((item) => item.id === machineId) ?? MACHINES[0];
  const grip = gripLength(job);
  const program = machine.id === "lathe" ? latheProgram : vmcProgram;
  const holding = machine.id === "lathe"
    ? `3-jaw chuck grips ${grip} mm of the bar`
    : `Vice with soft jaws grips ${grip} mm. The bar stands on end, so no rotary axis is needed.`;
  const fixture = machine.id === "lathe" ? "3-jaw chuck" : "Machine vice with soft jaws";
  const stages: MachiningStage[] = [
    {
      opNumber: 10,
      name: "Turn outside diameter",
      holding,
      fixture,
      tool: machine.id === "lathe" ? "CNMG turning insert" : "16 mm carbide end mill",
      toolPoint: `At the free end, cutting the square corners down to Ø${job.diameter} mm`,
      grip,
      before: "bar",
      after: "cylinder",
      gcode: program(job, "turn"),
    },
    {
      opNumber: 20,
      name: "Bore the hole",
      holding,
      fixture,
      tool: machine.id === "lathe" ? `Ø${job.bore > 8 ? Math.max(job.bore * 0.75, job.bore - 4) : job.bore} mm drill, then Ø${job.bore} boring bar` : `Ø${job.bore > 8 ? Math.max(job.bore * 0.75, job.bore - 4) : job.bore} mm drill${job.bore > 8 ? `, then Ø${job.bore} mm boring head` : ""}`,
      toolPoint: `On center at the free end, opening a Ø${job.bore} mm hole`,
      grip,
      before: "cylinder",
      after: "tube",
      gcode: program(job, "bore"),
    },
  ];

  const features: PartFeatures = {
    partName: job.partName,
    partNumber: job.partNumber,
    revision: job.revision,
    material: job.material,
    rawDimensions: { length: job.stockLength, width: job.stockWidth, height: job.stockHeight },
    stockDimensions: { length: job.stockLength, width: job.stockWidth, height: job.stockHeight },
    features: [{ type: "bore", count: 1, diameter: job.bore, depth: job.length - grip }],
    tolerances: [],
    surfaceFinishes: [],
    partType: "rotational",
    estimatedComplexity: "low",
    sourceFile: `${job.partNumber}.pdf`,
    extractedAt: new Date().toISOString(),
    extractionMethod: "pdf_ocr",
  };

  const plan: ProcessPlan = {
    partName: job.partName,
    partNumber: job.partNumber,
    revision: job.revision,
    material: job.material,
    machineType: machine.label,
    totalEstimatedTime: 11,
    operations: [operation(stages[0], 6), operation(stages[1], 5)],
    generalNotes: [machine.reason],
    generatedAt: new Date().toISOString(),
    model: "stage-planner",
  };

  return { family: "turning", job, machines: MACHINES, selectedMachine: machine.id, stages, plan, features };
}
