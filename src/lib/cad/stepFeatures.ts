import type { MachiningFeature } from "@/lib/cad/featureExtractor";

interface Entity {
  type: string;
  body: string;
}

interface Frame {
  min: number[];
  max: number[];
  order: number[];
}

interface Opening {
  kind: "hole" | "slot";
  diameter: number;
  centers: number[][];
  height: number;
}

function parseEntities(text: string): Map<number, Entity> {
  const dataStart = text.indexOf("DATA;");
  const data = dataStart >= 0 ? text.slice(dataStart) : text;
  const starts: { id: number; type: string; at: number; head: number }[] = [];
  const re = /#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(data)) !== null) {
    starts.push({ id: Number(match[1]), type: match[2], at: match.index, head: match[0].length });
  }
  const entities = new Map<number, Entity>();
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    let body = data.slice(start.at + start.head, index + 1 < starts.length ? starts[index + 1].at : data.length);
    const end = body.lastIndexOf(";");
    if (end >= 0) body = body.slice(0, end);
    entities.set(start.id, { type: start.type, body: body.trim() });
  }
  return entities;
}

function refs(body: string): number[] {
  return [...body.matchAll(/#(\d+)/g)].map((match) => Number(match[1]));
}

function triple(body: string): number[] | null {
  const match = body.match(/\(\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*\)/);
  if (!match) return null;
  const point = [Number(match[1]), Number(match[2]), Number(match[3])];
  return point.every((value) => Number.isFinite(value)) ? point : null;
}

function tailNumber(body: string): number {
  const match = body.match(/([-+0-9.eE]+)\s*\)?\s*$/);
  return match ? Number(match[1]) : Number.NaN;
}

function bucket(value: number): number {
  return Math.round(value * 20) / 20;
}

function roundMm(value: number): number {
  return Math.round(value * 10) / 10;
}

function frameFrom(entities: Map<number, Entity>): Frame | null {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let count = 0;
  for (const entity of entities.values()) {
    if (entity.type !== "CARTESIAN_POINT") continue;
    const point = triple(entity.body);
    if (!point) continue;
    count += 1;
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], point[axis]);
      max[axis] = Math.max(max[axis], point[axis]);
    }
  }
  if (count < 2) return null;
  const order = [0, 1, 2].sort((a, b) => (max[b] - min[b]) - (max[a] - min[a]));
  if (max[order[0]] - min[order[0]] <= 0) return null;
  return { min, max, order };
}

function pointOf(entities: Map<number, Entity>, id: number | undefined): number[] | null {
  const entity = id == null ? undefined : entities.get(id);
  if (!entity) return null;
  if (entity.type === "CARTESIAN_POINT") return triple(entity.body);
  if (entity.type === "VERTEX_POINT") return pointOf(entities, refs(entity.body)[0]);
  return null;
}

function placementOf(entities: Map<number, Entity>, id: number | undefined): { origin: number[]; axis: number[] } | null {
  const entity = id == null ? undefined : entities.get(id);
  if (!entity || entity.type !== "AXIS2_PLACEMENT_3D") return null;
  const ids = refs(entity.body);
  const origin = pointOf(entities, ids[0]);
  const axis = triple(entities.get(ids[1])?.body ?? "");
  if (!origin || !axis) return null;
  return { origin, axis };
}

function circleOf(entities: Map<number, Entity>, id: number): { center: number[]; radius: number } | null {
  const curve = entities.get(id);
  if (!curve || curve.type !== "CIRCLE") return null;
  const place = placementOf(entities, refs(curve.body)[0]);
  const radius = tailNumber(curve.body);
  if (!place || !(radius > 0)) return null;
  return { center: place.origin, radius };
}

function loopEdges(entities: Map<number, Entity>, boundId: number): { circles: { center: number[]; radius: number }[]; points: number[][] } {
  const bound = entities.get(boundId);
  const loop = bound ? entities.get(refs(bound.body)[0]) : undefined;
  const circles: { center: number[]; radius: number }[] = [];
  const points: number[][] = [];
  if (!loop) return { circles, points };
  for (const orientedId of refs(loop.body)) {
    const oriented = entities.get(orientedId);
    if (!oriented) continue;
    const edge = entities.get(refs(oriented.body).at(-1) ?? -1);
    if (!edge || edge.type !== "EDGE_CURVE") continue;
    const edgeRefs = refs(edge.body);
    const start = pointOf(entities, edgeRefs[0]);
    const end = pointOf(entities, edgeRefs[1]);
    if (start) points.push(start);
    if (end) points.push(end);
    const circle = circleOf(entities, edgeRefs[2]);
    if (circle) circles.push(circle);
  }
  return { circles, points };
}

function sameCenter(a: number[], b: number[], frame: Frame): boolean {
  return frame.order.slice(0, 2).every((axis) => bucket(a[axis]) === bucket(b[axis]));
}

function classify(circles: { center: number[]; radius: number }[], frame: Frame): Opening | null {
  if (!circles.length) return null;
  const radius = circles[0].radius;
  if (!circles.every((circle) => Math.abs(circle.radius - radius) < 0.05)) return null;
  const centers: number[][] = [];
  for (const circle of circles) {
    if (!centers.some((center) => sameCenter(center, circle.center, frame))) centers.push(circle.center);
  }
  const height = frame.order[2];
  if (centers.length === 1) {
    return { kind: "hole", diameter: radius * 2, centers, height: centers[0][height] };
  }
  if (centers.length === 2) {
    return { kind: "slot", diameter: radius * 2, centers, height: centers[0][height] };
  }
  return null;
}

function locate(center: number[], frame: Frame): { along: number; across: number } {
  const lengthAxis = frame.order[0];
  const widthAxis = frame.order[1];
  const lengthSpan = frame.max[lengthAxis] - frame.min[lengthAxis] || 1;
  const widthSpan = frame.max[widthAxis] - frame.min[widthAxis] || 1;
  return {
    along: (center[lengthAxis] - frame.min[lengthAxis]) / lengthSpan,
    across: (center[widthAxis] - frame.min[widthAxis]) / widthSpan,
  };
}

function average(points: number[][]): number[] {
  return [0, 1, 2].map((axis) => points.reduce((sum, point) => sum + point[axis], 0) / points.length);
}

function readSolid(text: string): { features: MachiningFeature[]; prismatic: boolean } {
  const entities = parseEntities(text);
  const frame = frameFrom(entities);
  if (!frame) return { features: [], prismatic: false };
  const spline = [...entities.values()].some((entity) => entity.type.includes("B_SPLINE"));
  let planar = 0;
  const openings: Opening[] = [];

  for (const entity of entities.values()) {
    if (entity.type !== "ADVANCED_FACE") continue;
    const ids = refs(entity.body);
    const surface = entities.get(ids.at(-1) ?? -1);
    if (surface?.type !== "PLANE") continue;
    planar += 1;
    for (const boundId of ids.slice(0, -1)) {
      const bound = entities.get(boundId);
      if (!bound || bound.type !== "FACE_BOUND") continue;
      const found = classify(loopEdges(entities, boundId).circles, frame);
      if (found) openings.push(found);
    }
  }

  const groups = new Map<string, Opening[]>();
  for (const opening of openings) {
    const where = opening.centers
      .map((center) => frame.order.slice(0, 2).map((axis) => bucket(center[axis])).join(","))
      .sort()
      .join("~");
    const key = `${opening.kind}|${roundMm(opening.diameter)}|${where}`;
    groups.set(key, [...(groups.get(key) ?? []), opening]);
  }

  const features: MachiningFeature[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    const centers = first.centers;
    const heightAxis = frame.order[2];
    const heights = group.flatMap((opening) => opening.centers.map((center) => center[heightAxis]));
    const depth = roundMm(Math.max(...heights) - Math.min(...heights));
    const spot = locate(average(centers), frame);
    if (first.kind === "hole") {
      features.push({
        type: "hole",
        count: 1,
        diameter: roundMm(first.diameter),
        depth: depth || undefined,
        along: spot.along,
        across: spot.across,
      });
      continue;
    }
    const lengthAxis = frame.order[0];
    const widthAxis = frame.order[1];
    const rise = Math.abs(centers[1][lengthAxis] - centers[0][lengthAxis]);
    const side = Math.abs(centers[1][widthAxis] - centers[0][widthAxis]);
    const span = Math.hypot(rise, side);
    features.push({
      type: "slot",
      count: 1,
      width: roundMm(first.diameter),
      length: roundMm(span + first.diameter),
      depth: depth || undefined,
      along: spot.along,
      across: spot.across,
      run: rise >= side ? "length" : "width",
    });
  }

  return { features, prismatic: planar > 0 && !spline };
}

/** Holes and slots from the faces of a STEP solid. A file with no faces returns nothing. */
export function featuresFromStepSolid(text: string): { features: MachiningFeature[]; prismatic: boolean } {
  try {
    return readSolid(text);
  } catch {
    return { features: [], prismatic: false };
  }
}
