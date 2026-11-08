import type { OperationType } from "@/lib/providers/capp.provider";
import { millCut } from "@/lib/cutting/data";
import { END_MILLS, FACE_MILLS, findMaterial, machineLimits, snapDown, tapForDrill } from "@/lib/cutting/library";
import { layoutHoles, layoutPockets, type HoleSpot, type PocketFrame } from "@/lib/studio/cutMotion";
import { faceAllowance } from "@/lib/studio/stageSheets";
import type { VisibleCut } from "@/lib/studio/stages";

export interface MillProgramInput {
  partNumber: string;
  opNumber: number;
  name: string;
  type: OperationType;
  toolDiameter: number;
  cuts: VisibleCut[];
  /** Hole cuts from earlier operations, used by tapping and deburring. */
  earlier: VisibleCut[];
  stock: { length: number; width: number; height: number };
  /** Material name from the drawing. It sets speeds, feeds and tool coating. */
  material?: string;
  /** Machine id (vmc or vmc5). It sets the spindle and feed limits. */
  machine?: string;
}

const SAFE = 50;
const PLANE = 2;

function n(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function dataFor(input: MillProgramInput, family: "face" | "flat" | "ball" | "drill" | "tap", diameter: number, options: { slot?: boolean; finish?: boolean } = {}) {
  return millCut({ material: findMaterial(input.material).material, machine: machineLimits(input.machine ?? "vmc"), family, diameter, ...options });
}

/** The largest stock end mill that is no bigger than the wanted size. A tiny feature keeps its exact size. */
function endMill(wanted: number): number {
  return wanted >= END_MILLS[0] ? snapDown(END_MILLS, wanted) : Math.round(wanted * 10) / 10;
}

function drillSpots(cuts: VisibleCut[], stock: MillProgramInput["stock"]): { cut: VisibleCut; spots: HoleSpot[] }[] {
  return cuts
    .filter((cut) => cut.kind === "hole")
    .map((cut) => ({ cut, spots: layoutHoles(cut, stock.length, stock.width, stock.height, Math.max(cut.count || 1, 1)) }));
}

function facing(input: MillProgramInput, lines: string[], toolNumber: number): void {
  const { length, width, height } = input.stock;
  const allowance = faceAllowance(height);
  const wanted = Math.min(Math.max(Math.min(length, width) * 0.8, 4), 50);
  const diameter = wanted >= FACE_MILLS[0] ? snapDown(FACE_MILLS, wanted) : endMill(wanted);
  const cut = dataFor(input, "face", diameter);
  const radius = diameter / 2;
  const outside = radius + 2;
  lines.push(`(TOOL FACE D${n(diameter)})`, `T${String(toolNumber).padStart(2, "0")} M06`, `S${cut.rpm} M03`);
  const first = width <= diameter ? width / 2 : radius * 0.6;
  const last = width <= diameter ? width / 2 : width - radius * 0.6;
  const passes = width <= diameter ? 1 : Math.ceil((last - first) / (diameter * 0.75)) + 1;
  lines.push(`G00 X${n(-outside)} Y${n(first)}`, `G43 H${String(toolNumber).padStart(2, "0")} Z${SAFE}.`, `G00 Z${n(allowance + PLANE)}`, `G01 Z0 F${cut.plunge}`);
  for (let pass = 0; pass < passes; pass += 1) {
    const y = passes === 1 ? first : first + ((last - first) * pass) / (passes - 1);
    const toEnd = pass % 2 === 0;
    if (pass > 0) lines.push(`G01 Y${n(y)} F${cut.feed}`);
    lines.push(`G01 X${n(toEnd ? length + outside : -outside)} F${cut.feed}`);
  }
  lines.push(`G00 Z${SAFE}.`);
}

function contour(input: MillProgramInput, lines: string[], toolNumber: number): void {
  const { length, width, height } = input.stock;
  const allowance = faceAllowance(height);
  const diameter = endMill(Math.min(input.toolDiameter || 16, Math.max(Math.min(length, width) * 0.6, 2)));
  const radius = diameter / 2;
  const cut = dataFor(input, "flat", diameter);
  const floor = -(height - allowance) - 0.4;
  lines.push(`(TOOL FLAT D${n(diameter)})`, `T${String(toolNumber).padStart(2, "0")} M06`, `S${cut.rpm} M03`);
  const x0 = -radius;
  const x1 = length + radius;
  const y0 = -radius;
  const y1 = width + radius;
  lines.push(`G00 X${n(x0)} Y${n(y0)}`, `G43 H${String(toolNumber).padStart(2, "0")} Z${SAFE}.`, `G00 Z${PLANE}`, `G01 Z${n(floor)} F${cut.plunge}`);
  lines.push(`G01 X${n(x1)} F${cut.feed}`, `G01 Y${n(y1)}`, `G01 X${n(x0)}`, `G01 Y${n(y0)}`, `G00 Z${SAFE}.`);
}

function pocketPath(frame: PocketFrame, input: MillProgramInput, diameter: number, depth: number, slot: boolean): string[] {
  const { length, width } = input.stock;
  const cut = dataFor(input, "flat", diameter, { slot });
  const x0 = frame.x0 + length / 2;
  const x1 = frame.x1 + length / 2;
  const y0 = frame.z0 + width / 2;
  const y1 = frame.z1 + width / 2;
  const radius = diameter / 2;
  const alongX = x1 - x0 >= y1 - y0;
  const [a0, a1, b0, b1] = alongX ? [x0, x1, y0, y1] : [y0, y1, x0, x1];
  const aStart = a0 + radius;
  const aEnd = a1 - radius;
  const shortSide = b1 - b0;
  const lines: string[] = [];
  const point = (a: number, b: number) => (alongX ? `X${n(a)} Y${n(b)}` : `X${n(b)} Y${n(a)}`);
  const rows = shortSide <= diameter + 1e-6 ? [(b0 + b1) / 2] : (() => {
    const bStart = b0 + radius;
    const bEnd = b1 - radius;
    const count = Math.max(2, Math.ceil((bEnd - bStart) / (diameter * 0.7)) + 1);
    return Array.from({ length: count }, (_, index) => bStart + ((bEnd - bStart) * index) / (count - 1));
  })();
  const layers = Math.max(1, Math.ceil(depth / 3));
  lines.push(`G00 ${point(aStart, rows[0])}`, `G00 Z${PLANE}`);
  for (let layer = 1; layer <= layers; layer += 1) {
    const z = -(depth * layer) / layers;
    lines.push(`G01 ${point(aStart, rows[0])} Z${n(z)} F${cut.plunge}`);
    rows.forEach((row, index) => {
      const toEnd = index % 2 === 0;
      lines.push(`G01 ${point(toEnd ? aEnd : aStart, row)} F${cut.feed}`);
      if (index < rows.length - 1) lines.push(`G01 ${point(toEnd ? aEnd : aStart, rows[index + 1])}`);
    });
  }
  lines.push(`G00 Z${PLANE}`);
  return lines;
}

function pockets(input: MillProgramInput, lines: string[], toolNumber: number): void {
  const { length, width, height } = input.stock;
  const allowance = faceAllowance(height);
  const frames = layoutPockets(input.cuts, length, width, height - allowance);
  const cuts = input.cuts.filter((cut) => cut.kind === "pocket" || cut.kind === "slot");
  frames.forEach((frame, index) => {
    const shortSide = Math.min(frame.x1 - frame.x0, frame.z1 - frame.z0);
    const slot = cuts[index]?.kind === "slot";
    // A slot is cut by a tool as wide as the slot. A pocket takes the largest stock end mill that fits.
    const diameter = slot
      ? Math.round(shortSide * 10) / 10
      : endMill(Math.min(input.toolDiameter || 10, Math.max(shortSide * 0.7, 1)));
    const tool = toolNumber + index;
    const cut = dataFor(input, "flat", diameter, { slot });
    lines.push(`(TOOL FLAT D${n(diameter)})`, `T${String(tool).padStart(2, "0")} M06`, `S${cut.rpm} M03`);
    lines.push(`G00 X${n(frame.x0 + length / 2)} Y${n(frame.z0 + width / 2)}`, `G43 H${String(tool).padStart(2, "0")} Z${SAFE}.`);
    lines.push(...pocketPath(frame, input, diameter, Math.min(frame.depth, height - allowance), slot));
    lines.push(`G00 Z${SAFE}.`);
  });
}

function drilling(input: MillProgramInput, lines: string[], toolNumber: number, tapping: boolean): void {
  const { height } = input.stock;
  const allowance = faceAllowance(height);
  const groups = drillSpots(tapping ? input.earlier : input.cuts, input.stock);
  groups.forEach(({ cut, spots }, index) => {
    const tool = toolNumber + index;
    const diameter = cut.diameter || input.toolDiameter || 8;
    const depth = Math.min(cut.depth, height - allowance + 1);
    // A tap is chosen from the drill that made the hole, and a rigid tap feeds one pitch per turn.
    const data = tapping ? dataFor(input, "tap", tapForDrill(diameter).nominal) : dataFor(input, "drill", diameter);
    lines.push(`(TOOL ${tapping ? "TAP" : "DRILL"} D${n(diameter)})`, `T${String(tool).padStart(2, "0")} M06`, `S${data.rpm} M03`);
    const peck = !tapping && depth > diameter * 3;
    const cycle = tapping ? "G84" : peck ? "G83" : "G81";
    const first = spots[0];
    lines.push(`G00 X${n(first.x + input.stock.length / 2)} Y${n(first.z + input.stock.width / 2)}`, `G43 H${String(tool).padStart(2, "0")} Z${SAFE}.`);
    spots.forEach((spot, spotIndex) => {
      const x = n(spot.x + input.stock.length / 2);
      const y = n(spot.z + input.stock.width / 2);
      if (spotIndex === 0) lines.push(`G99 ${cycle} X${x} Y${y} Z${n(-depth)} R${PLANE}${peck ? ` Q${n(diameter)}` : ""} F${n(data.feed)}`);
      else lines.push(`X${x} Y${y}`);
    });
    lines.push("G80", `G00 Z${SAFE}.`);
  });
}

function deburring(input: MillProgramInput, lines: string[], toolNumber: number): void {
  const { length, width, height } = input.stock;
  const thickness = height - faceAllowance(height);
  const diameter = 6;
  const cutData = dataFor(input, "ball", diameter, { finish: true });
  const radius = diameter / 2;
  const depth = Math.min(0.5, Math.max(thickness * 0.15, 0.2));
  const reach = Math.sqrt(2 * radius * depth - depth * depth);
  const offset = Math.round((reach - depth * 1.1) * 100) / 100;
  const edge = -depth;
  lines.push(`(TOOL BALL D${diameter})`, `T${String(toolNumber).padStart(2, "0")} M06`, `S${cutData.rpm} M03`);
  const x0 = -offset;
  const y0 = -offset;
  const x1 = length + offset;
  const y1 = width + offset;
  lines.push(`G00 X${n(x0)} Y${n(y0)}`, `G43 H${String(toolNumber).padStart(2, "0")} Z${SAFE}.`, `G00 Z${PLANE}`, `G01 Z${n(edge)} F${cutData.plunge}`);
  lines.push(`G01 X${n(x1)} F${cutData.feed}`, `G01 Y${n(y1)}`, `G01 X${n(x0)}`, `G01 Y${n(y0)}`, `G00 Z${PLANE}`);
  for (const { spots } of drillSpots([...input.earlier, ...input.cuts], input.stock)) {
    for (const spot of spots) {
      const inner = spot.radius - offset;
      if (inner < 0.3) continue;
      const cx = spot.x + length / 2;
      const cy = spot.z + width / 2;
      lines.push(`G00 X${n(cx + inner)} Y${n(cy)}`, `G01 Z${n(edge)} F${cutData.plunge}`, `G02 X${n(cx + inner)} Y${n(cy)} I${n(-inner)} J0 F${cutData.feed}`, `G00 Z${PLANE}`);
    }
  }
  lines.push(`G00 Z${SAFE}.`);
}

/** Real toolpaths for one machined stage. X0 Y0 is the stock corner and Z0 is the finished top face. */
export function millProgram(input: MillProgramInput): string {
  const lines: string[] = [
    "%",
    `O${String(input.opNumber).padStart(4, "0")} (${input.partNumber} OP${input.opNumber} ${input.name.toUpperCase()})`,
    "G21 G17 G90 G40 G49",
  ];
  const first = 1;
  if (input.type === "face_milling") facing(input, lines, first);
  else if (input.type === "drilling" || input.type === "boring") drilling(input, lines, first, false);
  else if (input.type === "tapping") drilling(input, lines, first, true);
  else if (input.type === "deburring") deburring(input, lines, first);
  else if (input.type === "pocket_milling" || input.cuts.some((cut) => cut.kind === "pocket" || cut.kind === "slot")) pockets(input, lines, first);
  else contour(input, lines, first);
  lines.push("M05", "M30", "%", "");
  return lines.join("\n");
}
