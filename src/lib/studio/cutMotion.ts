import type { VisibleCut } from "@/lib/studio/stages";

export interface Point {
  x: number;
  y: number;
  z: number;
}

export interface HoleSpot {
  x: number;
  z: number;
  radius: number;
  depth: number;
}

export interface PocketFrame {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  depth: number;
}

export function layoutHoles(cut: VisibleCut, length: number, width: number, height: number, limit = 8): HoleSpot[] {
  const count = Math.min(Math.max(cut.count || 1, 1), limit);
  const positioned = cut.along != null && cut.across != null;
  const radius = Math.max((cut.diameter || 8) / 2, positioned ? 0.4 : 1.5);
  const depth = Math.min(Math.max(cut.depth || height * 0.6, positioned ? 0.2 : 1), height);
  if (positioned && count === 1) {
    return [{
      x: -length / 2 + (cut.along ?? 0.5) * length,
      z: -width / 2 + (cut.across ?? 0.5) * width,
      radius,
      depth,
    }];
  }
  const cols = count <= 2 ? count : count <= 6 ? 2 : 3;
  const rows = Math.ceil(count / cols);
  const insetX = Math.max(radius * 3, length * 0.18);
  const insetZ = Math.max(radius * 3, width * 0.18);
  const spots: HoleSpot[] = [];
  for (let index = 0; index < count; index += 1) {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = cols === 1 ? 0 : -length / 2 + insetX + (col * (length - insetX * 2)) / (cols - 1);
    const z = rows === 1 ? 0 : -width / 2 + insetZ + (row * (width - insetZ * 2)) / (rows - 1);
    spots.push({ x, z, radius, depth });
  }
  return spots;
}

export function layoutPockets(cuts: VisibleCut[], length: number, width: number, height: number): PocketFrame[] {
  return cuts.filter((cut) => cut.kind === "pocket" || cut.kind === "slot").map((cut, index, all) => {
    const depth = Math.min(Math.max(cut.depth || height * 0.35, 0.2), height);
    if (cut.along != null && cut.across != null) {
      const long = Math.min(cut.length || length * 0.4, length * 0.95);
      const short = Math.min(cut.width || width * 0.4, width * 0.9);
      const cx = -length / 2 + cut.along * length;
      const cz = -width / 2 + cut.across * width;
      const dx = cut.run === "width" ? short : long;
      const dz = cut.run === "width" ? long : short;
      return { x0: cx - dx / 2, x1: cx + dx / 2, z0: cz - dz / 2, z1: cz + dz / 2, depth };
    }
    const span = (length * 0.8) / all.length;
    const center = -length / 2 + length * 0.1 + span * (index + 0.5);
    const pocketLength = Math.min(cut.length || span * 0.7, span * 0.75);
    const pocketWidth = Math.min(cut.width || width * 0.4, width * 0.62);
    return {
      x0: center - pocketLength / 2,
      x1: center + pocketLength / 2,
      z0: -pocketWidth / 2,
      z1: pocketWidth / 2,
      depth: Math.min(depth, height * 0.75),
    };
  });
}

export function facePose(progress: number, length: number, width: number, millDiameter: number) {
  const step = Math.max(millDiameter * 0.62, 8);
  const passes = Math.max(1, Math.ceil(width / step));
  const cursor = Math.min(Math.max(progress, 0), 1) * passes;
  const pass = Math.min(passes - 1, Math.floor(cursor));
  const rawAlong = pass >= passes - 1 && cursor >= passes ? 1 : cursor - pass;
  const forward = pass % 2 === 0;
  const along = forward ? rawAlong : 1 - rawAlong;
  const x = -length / 2 + along * length;
  const z = -width / 2 + Math.min(width - step / 2, pass * step + step / 2);
  return { x, z, pass, passes, along, forward, step };
}

export function pocketPose(progress: number, frame: PocketFrame, toolRadius: number) {
  const plungeEnd = 0.16;
  const x0 = frame.x0 + toolRadius;
  const x1 = Math.max(frame.x1 - toolRadius, x0 + 0.1);
  const z0 = frame.z0 + toolRadius;
  const z1 = Math.max(frame.z1 - toolRadius, z0 + 0.1);
  const rows = Math.max(2, Math.ceil((z1 - z0) / Math.max(toolRadius * 1.3, 1)));
  if (progress <= plungeEnd) {
    return { x: x0, z: z0, plunge: progress / plungeEnd, cleared: 0, rows };
  }
  const travel = (progress - plungeEnd) / (1 - plungeEnd);
  const cursor = travel * rows;
  const row = Math.min(rows - 1, Math.floor(Math.min(cursor, rows - 0.0001)));
  const rawAlong = cursor >= rows ? 1 : cursor - row;
  const along = row % 2 === 0 ? rawAlong : 1 - rawAlong;
  return {
    x: x0 + along * (x1 - x0),
    z: z0 + ((z1 - z0) * row) / Math.max(rows - 1, 1),
    plunge: 1,
    cleared: Math.min(1, (row + rawAlong) / rows),
    rows,
  };
}

export function drillPose(progress: number, holes: HoleSpot[], safe: number) {
  const count = Math.max(holes.length, 1);
  const cursor = Math.min(Math.max(progress, 0), 1) * count;
  const index = Math.min(count - 1, Math.floor(cursor));
  const local = cursor >= count ? 1 : cursor - index;
  const hole = holes[index] ?? { x: 0, z: 0, radius: 3, depth: safe };
  let plunge = 0;
  if (local >= 0.22 && local < 0.78) plunge = (local - 0.22) / 0.56;
  else if (local >= 0.78) plunge = 1;
  const tipDrop = local < 0.22 ? 0 : local < 0.78 ? plunge * hole.depth : hole.depth * (1 - (local - 0.78) / 0.22);
  return { index, local, plunge, x: hole.x, z: hole.z, tipDrop, depth: hole.depth };
}

export function deburrPath(length: number, width: number, height: number, pockets: PocketFrame[], holes: HoleSpot[]): Point[] {
  const y = height;
  const points: Point[] = [];
  const rect = (x0: number, x1: number, z0: number, z1: number) => {
    points.push(
      { x: x0, y, z: z0 },
      { x: x1, y, z: z0 },
      { x: x1, y, z: z1 },
      { x: x0, y, z: z1 },
      { x: x0, y, z: z0 },
    );
  };
  rect(-length / 2, length / 2, -width / 2, width / 2);
  for (const pocket of pockets) rect(pocket.x0, pocket.x1, pocket.z0, pocket.z1);
  for (const hole of holes) {
    const steps = 14;
    for (let step = 0; step <= steps; step += 1) {
      const angle = (step / steps) * Math.PI * 2;
      points.push({
        x: hole.x + Math.cos(angle) * hole.radius,
        y,
        z: hole.z + Math.sin(angle) * hole.radius,
      });
    }
  }
  return points;
}

export function pointAlong(points: Point[], progress: number): Point {
  if (points.length === 0) return { x: 0, y: 0, z: 0 };
  if (points.length === 1 || progress <= 0) return points[0];
  const cursor = Math.min(Math.max(progress, 0), 1) * (points.length - 1);
  const index = Math.min(points.length - 2, Math.floor(cursor));
  const fraction = cursor - index;
  const from = points[index];
  const to = points[index + 1];
  return {
    x: from.x + (to.x - from.x) * fraction,
    y: from.y + (to.y - from.y) * fraction,
    z: from.z + (to.z - from.z) * fraction,
  };
}
