import { UP, axisFromRotary, isTilted, sameAxis } from "@/lib/sim/axes";
import type { InterpretOptions, Motion, ParsedProgram, ToolKind, ToolSpec, Vec3 } from "@/lib/sim/types";

const WORD = /([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g;

const DEFAULT_DIAMETER: Record<ToolKind, number> = {
  ball: 8,
  flat: 8,
  face: 32,
  drill: 8,
  tap: 6,
  od: 0,
  bore: 0,
  tslot: 20,
  dovetail: 16,
};

function specFor(kind: ToolKind, diameter?: number, extra: { width?: number; neck?: number; angle?: number } = {}): ToolSpec {
  const size = diameter && diameter > 0 ? diameter : DEFAULT_DIAMETER[kind];
  if (kind === "tslot") {
    const thickness = extra.width && extra.width > 0 ? extra.width : Math.max(size * 0.15, 2);
    const neck = Math.min(extra.neck && extra.neck > 0 ? extra.neck : size * 0.45, size * 0.9);
    return { kind, diameter: size, fluteLength: thickness, thickness, neck };
  }
  if (kind === "dovetail") {
    const angle = Math.min(Math.max(extra.angle && extra.angle > 0 ? extra.angle : 45, 10), 80);
    const neck = Math.min(extra.neck && extra.neck > 0 ? extra.neck : size * 0.5, size * 0.9);
    const height = (size / 2 - neck / 2) / Math.tan((angle * Math.PI) / 180);
    return { kind, diameter: size, fluteLength: height, neck, angle };
  }
  const insert = kind === "od" || kind === "bore";
  const flute = insert ? 6 : kind === "face" ? 10 : kind === "drill" ? Math.max(size * 6, 20) : Math.max(size * 3, 12);
  return { kind, diameter: size, fluteLength: flute };
}

/**
 * `(TOOL BALL D6)`, `(TOOL DRILL D8.5)`, `(TOOL OD)`, `(TOOL BORE D16)`.
 * Undercut cutters take extra words: `(TOOL TSLOT D20 W3 N8)` is a 20 mm disc, 3 mm thick, on an 8 mm neck.
 * `(TOOL DOVETAIL D16 A45)` is a 16 mm cutter with 45 degree flanks.
 */
export function toolFromComment(text: string): ToolSpec | null {
  const match = /TOOL\s+(BALL|FLAT|FACE|DRILL|TAP|OD|BORE|TSLOT|DOVETAIL)\b((?:\s*[DWNA]\s*\d+(?:\.\d+)?)*)/i.exec(text);
  if (!match) return null;
  const value = (letter: string) => {
    const found = new RegExp(`${letter}\\s*(\\d+(?:\\.\\d+)?)`, "i").exec(match[2]);
    return found ? Number(found[1]) : undefined;
  };
  return specFor(match[1].toLowerCase() as ToolKind, value("D"), { width: value("W"), neck: value("N"), angle: value("A") });
}

function kindFromWords(text: string, lathe: boolean): ToolKind | null {
  if (/\bBORE\b|BORING/i.test(text)) return lathe ? "bore" : "flat";
  if (lathe) return null;
  if (/DRILL/i.test(text)) return "drill";
  if (/\bTAP\b|TAPPING/i.test(text)) return "tap";
  if (/FACE\s*MILL|FACING|FACE THE|FACE THE DATUM/i.test(text)) return "face";
  if (/DEBURR/i.test(text)) return "ball";
  return null;
}

function isLatheText(text: string): boolean {
  if (/\bG18\b/i.test(text)) return true;
  const turning = /\bG(96|97)\b/i.test(text) && /\bG99\b|\bG98\b|\bT\d{4}\b/i.test(text);
  return turning && !/\bY\s*[-+]?\d/i.test(text);
}

interface Cycle {
  kind: number;
  z: number;
  r: number;
  q: number;
}

interface Entry {
  text: string;
  src: number;
  injected: boolean;
}

function arcPoints(
  from: Vec3,
  to: Vec3,
  axes: [number, number],
  center: [number, number],
  clockwise: boolean,
  radiusScale: (axis: number) => number
): Vec3[] {
  const a0 = from[axes[0]] * radiusScale(axes[0]);
  const b0 = from[axes[1]] * radiusScale(axes[1]);
  const a1 = to[axes[0]] * radiusScale(axes[0]);
  const b1 = to[axes[1]] * radiusScale(axes[1]);
  const start = Math.atan2(b0 - center[1], a0 - center[0]);
  let end = Math.atan2(b1 - center[1], a1 - center[0]);
  const radius = Math.hypot(a0 - center[0], b0 - center[1]);
  const closed = Math.hypot(a1 - a0, b1 - b0) < 1e-6;
  if (clockwise) {
    if (end >= start || closed) end -= Math.PI * 2;
  } else if (end <= start || closed) {
    end += Math.PI * 2;
  }
  const sweep = end - start;
  const steps = Math.max(8, Math.ceil(Math.abs(sweep) / (Math.PI / 36)));
  const third = 3 - axes[0] - axes[1];
  const points: Vec3[] = [];
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const angle = start + sweep * t;
    const point: Vec3 = [0, 0, 0];
    point[axes[0]] = (center[0] + radius * Math.cos(angle)) / radiusScale(axes[0]);
    point[axes[1]] = (center[1] + radius * Math.sin(angle)) / radiusScale(axes[1]);
    point[third] = from[third] + (to[third] - from[third]) * t;
    points.push(point);
  }
  points[points.length - 1] = [to[0], to[1], to[2]];
  return points;
}

/** Diameter at which G71 roughing stops cutting along Z, for one roughing pass. */
function roughEnd(contour: [number, number][], diameter: number, zStart: number): number {
  const eps = 1e-6;
  for (let i = 0; i < contour.length - 1; i += 1) {
    const [x0, z0] = contour[i];
    const [x1, z1] = contour[i + 1];
    if (i === 0 && x0 > diameter + eps) return zStart;
    if (x1 > diameter + eps && x0 <= diameter + eps) {
      const t = (diameter - x0) / (x1 - x0 || eps);
      return z0 + (z1 - z0) * Math.min(Math.max(t, 0), 1);
    }
  }
  return contour[contour.length - 1][1];
}

/** X (diameter) of the finished contour at a Z plane, used by G72 face roughing. */
function faceEnd(contour: [number, number][], z: number): number | null {
  for (let i = 0; i < contour.length - 1; i += 1) {
    const [x0, z0] = contour[i];
    const [x1, z1] = contour[i + 1];
    if (Math.abs(z1 - z0) < 1e-9) continue;
    if (z > Math.max(z0, z1) + 1e-9 || z < Math.min(z0, z1) - 1e-9) continue;
    const t = Math.min(Math.max((z - z0) / (z1 - z0), 0), 1);
    return x0 + (x1 - x0) * t;
  }
  return null;
}

/** Fanuc writes G74/G75 steps as whole micrometres (P3000 = 3 mm). Small values are already mm. */
function microns(value: number): number {
  return value >= 20 ? value / 1000 : value;
}

/** Turns program text into straight moves the simulator can walk. Cycles and arcs are expanded. */
export function interpretProgram(text: string, options: InterpretOptions): ParsedProgram {
  const lathe = options.lathe ?? isLatheText(text);
  const motions: Motion[] = [];
  const tools: ToolSpec[] = [lathe ? specFor("od") : specFor("ball")];
  const warnings = new Set<string>();
  const start: Vec3 = [options.home[0], options.home[1], options.home[2]];
  let pos: Vec3 = [...start];
  let absolute = true;
  let inches = false;
  let plane: "xy" | "xz" | "yz" = lathe ? "xz" : "xy";
  let modal = 0;
  let spindle = false;
  let toolIndex = 0;
  let cycle = null as Cycle | null;
  let turnCycle = null as { kind: 90 | 92 | 94; z?: number; r?: number } | null;
  let retractToInitial = true;
  let initialZ = pos[2];
  let commentKind: ToolKind | null = null;
  let explicitTool = false;
  let ended = false;
  let feed = 0;
  let perRev = lathe;
  let speed = 0;
  let css = false;
  let holes = 0;
  let roughDepth = 1;
  let roughRetract = 0.5;
  let faceDepth = 1;
  let faceRetract = 0.5;
  const patternRelief: [number, number] = [0, 0];
  let patternCount = 3;
  let grooveRetract = 0.5;
  let skipUntil: number | null = null;
  const contours = new Map<number, Entry[]>();

  const radiusScale = (axis: number) => (lathe && axis === 0 ? 0.5 : 1);

  const addTool = (spec: ToolSpec) => {
    if (!lathe && spec.kind === "bore") {
      // On a mill a boring head is a long single-point tool that runs at its own diameter.
      const diameter = spec.diameter > 0 ? spec.diameter : 16;
      spec = { ...spec, diameter, fluteLength: Math.max(diameter * 6, 20) };
    }
    tools.push(spec);
    toolIndex = tools.length - 1;
  };

  // Rotary words (A, B, C) tilt the tool. The axis in force at the end of the last move is axisStart.
  const tilt: Vec3 = [0, 0, 0];
  let axisNow: Vec3 = UP;
  let axisStart: Vec3 = UP;

  const push = (kind: Motion["kind"], from: Vec3, to: Vec3, line: number, home = false, feedOverride?: number) => {
    const turning = !sameAxis(axisStart, axisNow);
    if (Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) < 1e-6 && !turning) return;
    const axes = isTilted(axisStart) || isTilted(axisNow) ? { axisFrom: axisStart, axisTo: axisNow } : {};
    axisStart = axisNow;
    motions.push({
      ...axes,
      kind,
      from: [...from],
      to: [...to],
      line,
      tool: toolIndex,
      spindle,
      home,
      f: feedOverride ?? feed,
      perRev,
      s: speed,
      css,
    });
  };

  const queue: Entry[] = text.replace(/\r\n/g, "\n").split("\n").map((value, index) => ({ text: value, src: index, injected: false }));
  for (let at = 0; at < queue.length && !ended; at += 1) {
    const entry = queue[at];
    const lineIndex = entry.src;
    const original = entry.text;
    const commentText = [...original.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]).join(" ") + (/;(.*)$/.exec(original)?.[1] ?? "");
    const spec = toolFromComment(commentText);
    if (spec && !entry.injected) {
      addTool(spec);
      explicitTool = true;
    } else if (commentText) {
      commentKind = kindFromWords(commentText, lathe) ?? commentKind;
    }

    let line = original.replace(/\([^)]*\)/g, " ").replace(/;.*$/, "").trim().toUpperCase();
    if (!line || line === "%" || line.startsWith("/")) continue;
    const blockNumber = /\bN(\d+)\b/.exec(line);
    line = line.replace(/\bN\d+\b/g, " ");
    if (skipUntil !== null && !entry.injected) {
      if (blockNumber && Number(blockNumber[1]) === skipUntil) skipUntil = null;
      continue;
    }

    const words: Record<string, number> = {};
    const gcodes: number[] = [];
    const mcodes: number[] = [];
    WORD.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WORD.exec(line)) !== null) {
      const code = match[1];
      const value = Number(match[2]);
      if (code === "G") gcodes.push(value);
      else if (code === "M") mcodes.push(value);
      else words[code] = value;
    }

    for (const m of mcodes) {
      if (m === 3 || m === 4) spindle = true;
      if (m === 5) spindle = false;
      if (m === 30 || m === 2) ended = true;
    }
    if (words.F !== undefined) feed = words.F * (inches && !perRev ? 25.4 : 1);
    if (words.S !== undefined) speed = words.S;

    let rotary = false;
    if (!lathe && (words.A !== undefined || words.B !== undefined || words.C !== undefined)) {
      const rotaryWords: [string, number][] = [["A", 0], ["B", 1], ["C", 2]];
      for (const [name, index] of rotaryWords) {
        if (words[name] === undefined) continue;
        tilt[index] = absolute ? words[name] : tilt[index] + words[name];
      }
      axisNow = axisFromRotary(tilt[0], tilt[1], tilt[2]);
      rotary = true;
    }
    if (!lathe && gcodes.some((g) => g === 68.2 || g === 43.4 || g === 43.5)) {
      warnings.add("Tilted work plane (G68.2) and tool-centre-point codes (G43.4, G43.5) are not applied. The A, B and C words set the tool axis directly.");
    }

    if (words.T !== undefined) {
      const number = Math.round(words.T);
      if (explicitTool) {
        explicitTool = false;
      } else if (lathe) {
        const turret = Math.floor(number / 100) || number;
        const kind: ToolKind = commentKind === "bore" || turret === 3 || turret === 4 ? "bore" : "od";
        addTool(specFor(kind, kind === "bore" ? tools[toolIndex].diameter : 0));
      } else if (commentKind) {
        addTool(specFor(commentKind));
      }
    }

    let homing = false;
    let moveCode: number | null = null;
    let cycleCode: number | null = null;
    let latheCode: number | null = null;
    for (const g of gcodes) {
      if (g === 0 || g === 1 || g === 2 || g === 3) {
        moveCode = g;
        cycle = null;
        turnCycle = null;
      } else if (g === 17) plane = "xy";
      else if (g === 18) plane = "xz";
      else if (g === 19) plane = "yz";
      else if (g === 20) inches = true;
      else if (g === 21) inches = false;
      else if (g === 90 && !lathe) absolute = true;
      else if (g === 91 && !lathe) absolute = false;
      else if (g === 98) {
        retractToInitial = true;
        if (lathe) perRev = false;
      } else if (g === 99) {
        retractToInitial = false;
        if (lathe) perRev = true;
      } else if (g === 94 && !lathe) perRev = false;
      else if (g === 95 && !lathe) perRev = true;
      else if (g === 96) css = true;
      else if (g === 97) css = false;
      else if (g === 80) cycle = null;
      else if (g === 28) homing = true;
      else if (!lathe && [73, 81, 82, 83, 84, 85, 86, 89].includes(g)) cycleCode = g;
      else if (lathe && (g === 90 || g === 92 || g === 94)) {
        turnCycle = { kind: g as 90 | 92 | 94, z: turnCycle?.kind === g ? turnCycle.z : undefined, r: turnCycle?.kind === g ? turnCycle.r : undefined };
        latheCode = g;
      } else if (lathe && [70, 71, 72, 73, 74, 75, 76].includes(g)) latheCode = g;
    }

    const unit = inches ? 25.4 : 1;
    const target: Vec3 = [...pos];
    let hasMove = false;
    const lathePlain = latheCode === null || latheCode === 90 || latheCode === 92 || latheCode === 94;
    if (lathe) {
      if (words.X !== undefined) { target[0] = words.X * unit; hasMove = true; }
      if (lathePlain && words.U !== undefined) { target[0] = pos[0] + words.U * unit; hasMove = true; }
      if (words.Z !== undefined) { target[2] = words.Z * unit; hasMove = true; }
      if (lathePlain && words.W !== undefined) { target[2] = pos[2] + words.W * unit; hasMove = true; }
    } else {
      const axes: [string, number][] = [["X", 0], ["Y", 1], ["Z", 2]];
      for (const [name, index] of axes) {
        if (words[name] === undefined) continue;
        hasMove = true;
        const value = words[name] * unit;
        target[index] = absolute ? value : pos[index] + value;
      }
    }

    if (homing) {
      const away: Vec3 = [...pos];
      if (lathe) {
        if (words.U !== undefined || words.X !== undefined) away[0] = options.home[0];
        if (words.W !== undefined || words.Z !== undefined) away[2] = options.home[2];
      } else {
        if (words.X !== undefined) away[0] = options.home[0];
        if (words.Y !== undefined) away[1] = options.home[1];
        if (words.Z !== undefined || (words.X === undefined && words.Y === undefined)) away[2] = options.home[2];
      }
      push("rapid", pos, away, lineIndex, true);
      pos = away;
      continue;
    }

    // ---- Lathe cycles --------------------------------------------------------------------
    if (lathe && latheCode === 71) {
      if (words.P === undefined || words.Q === undefined) {
        if (words.U !== undefined) roughDepth = Math.max(words.U * unit, 0.05);
        if (words.R !== undefined) roughRetract = words.R * unit;
        continue;
      }
      if (words.U !== undefined && words.R !== undefined) {
        roughDepth = Math.max(words.U * unit, 0.05);
        roughRetract = words.R * unit;
      }
      const first = Math.round(words.P);
      const last = Math.round(words.Q);
      const block: Entry[] = [];
      let collecting = false;
      for (let k = at + 1; k < queue.length; k += 1) {
        const candidate = queue[k];
        const number = /\bN(\d+)\b/.exec(candidate.text.toUpperCase());
        if (number && Number(number[1]) === first) collecting = true;
        if (collecting) block.push(candidate);
        if (collecting && number && Number(number[1]) === last) break;
      }
      if (!block.length) {
        warnings.add(`G71 refers to blocks N${first} to N${last}, but they were not found after it.`);
        continue;
      }
      contours.set(first, block);
      skipUntil = last;
      const xs = pos[0];
      const zs = pos[2];
      const probe = interpretProgram(block.map((item) => item.text).join("\n"), { home: [xs, 0, zs], lathe: true });
      const path: [number, number][] = [];
      probe.motions.forEach((motion, index) => {
        if (index === 0) {
          const approach = motion.kind === "rapid" && Math.abs(motion.from[2] - motion.to[2]) < 1e-6;
          if (!approach) path.push([motion.from[0], motion.from[2]]);
        }
        path.push([motion.to[0], motion.to[2]]);
      });
      if (path.length < 2) continue;
      const minDiameter = Math.min(...path.map((point) => point[0]));
      const step = roughDepth * 2;
      const diameters: number[] = [];
      for (let d = xs - step; d > minDiameter + 1e-6; d -= step) diameters.push(d);
      diameters.push(minDiameter);
      let current: Vec3 = [...pos];
      for (const d of diameters) {
        const zEnd = roughEnd(path, d, zs);
        if (zEnd >= zs - 1e-6) continue;
        const rapidIn: Vec3 = [d, 0, zs];
        push("rapid", current, rapidIn, lineIndex);
        const cutEnd: Vec3 = [d, 0, zEnd];
        push("feed", rapidIn, cutEnd, lineIndex);
        const out: Vec3 = [d + roughRetract * 2, 0, Math.min(zEnd + roughRetract, zs)];
        push("feed", cutEnd, out, lineIndex);
        const back: Vec3 = [out[0], 0, zs];
        push("rapid", out, back, lineIndex);
        current = back;
      }
      push("rapid", current, [xs, 0, zs], lineIndex);
      pos = [xs, 0, zs];
      continue;
    }

    if (lathe && (latheCode === 72 || latheCode === 73)) {
      const cycleName = `G${latheCode}`;
      if (words.P === undefined || words.Q === undefined) {
        if (latheCode === 72) {
          if (words.W !== undefined) faceDepth = Math.max(Math.abs(words.W * unit), 0.05);
          if (words.R !== undefined) faceRetract = Math.abs(words.R * unit);
        } else {
          if (words.U !== undefined) patternRelief[0] = words.U * unit;
          if (words.W !== undefined) patternRelief[1] = words.W * unit;
          if (words.R !== undefined) patternCount = Math.min(Math.max(Math.round(words.R), 1), 60);
        }
        continue;
      }
      const first = Math.round(words.P);
      const last = Math.round(words.Q);
      const block: Entry[] = [];
      let collecting = false;
      for (let k = at + 1; k < queue.length; k += 1) {
        const candidate = queue[k];
        const number = /\bN(\d+)\b/.exec(candidate.text.toUpperCase());
        if (number && Number(number[1]) === first) collecting = true;
        if (collecting) block.push(candidate);
        if (collecting && number && Number(number[1]) === last) break;
      }
      if (!block.length) {
        warnings.add(`${cycleName} refers to blocks N${first} to N${last}, but they were not found after it.`);
        continue;
      }
      contours.set(first, block);
      skipUntil = last;
      const xs = pos[0];
      const zs = pos[2];
      const probe = interpretProgram(block.map((item) => item.text).join("\n"), { home: [xs, 0, zs], lathe: true });
      if (!probe.motions.length) continue;
      const approach = probe.motions[0].kind === "rapid";
      const profile = approach ? probe.motions.slice(1) : probe.motions;
      const begin: Vec3 = approach ? probe.motions[0].to : probe.motions[0].from;

      if (latheCode === 72) {
        const path: [number, number][] = [[begin[0], begin[2]], ...profile.map((m): [number, number] => [m.to[0], m.to[2]])];
        if (path.length < 2) continue;
        const zTop = Math.max(...path.map((point) => point[1]));
        const zBottom = Math.min(...path.map((point) => point[1]));
        const found = new Set<number>([Math.round(zBottom * 1000) / 1000]);
        for (let z = zTop - faceDepth; z > zBottom + 1e-6; z -= faceDepth) found.add(Math.round(z * 1000) / 1000);
        for (const point of path) if (point[1] < zTop - 1e-6 && point[1] > zBottom + 1e-6) found.add(Math.round(point[1] * 1000) / 1000);
        const levels = [...found].sort((a, b) => b - a);
        let current: Vec3 = [...pos];
        for (const z of levels) {
          const xEnd = faceEnd(path, z);
          if (xEnd === null || xEnd >= xs - 1e-6) continue;
          push("rapid", current, [xs, 0, z], lineIndex);
          push("feed", [xs, 0, z], [xEnd, 0, z], lineIndex);
          const lift: Vec3 = [xEnd, 0, z + faceRetract];
          push("feed", [xEnd, 0, z], lift, lineIndex);
          const out: Vec3 = [xs, 0, z + faceRetract];
          push("rapid", lift, out, lineIndex);
          current = out;
        }
        push("rapid", current, [xs, 0, zs], lineIndex);
        pos = [xs, 0, zs];
        continue;
      }

      const finish = Math.abs(words.U ?? 0) * unit / 2;
      const relief = [Math.abs(patternRelief[0]), patternRelief[1]];
      let current: Vec3 = [...pos];
      for (let pass = 1; pass <= patternCount; pass += 1) {
        const share = patternCount > 1 ? (patternCount - pass) / (patternCount - 1) : 0;
        const dx = finish + Math.abs(relief[0]) * (patternCount > 1 ? share : 1);
        const dz = (words.W ?? 0) * unit + relief[1] * (patternCount > 1 ? share : 1);
        const shift = (point: Vec3): Vec3 => [point[0] + dx * 2, 0, point[2] + dz];
        const start = shift(begin);
        push("rapid", current, [start[0], 0, current[2]], lineIndex);
        push("rapid", [start[0], 0, current[2]], start, lineIndex);
        let prev = start;
        for (const move of profile) {
          const next = shift(move.to);
          push(move.kind, prev, next, lineIndex, false, move.f > 0 ? move.f : undefined);
          prev = next;
        }
        const clear: Vec3 = [xs, 0, prev[2]];
        push("rapid", prev, clear, lineIndex);
        const home: Vec3 = [xs, 0, zs];
        push("rapid", clear, home, lineIndex);
        current = home;
      }
      push("rapid", current, [xs, 0, zs], lineIndex);
      pos = [xs, 0, zs];
      continue;
    }

    if (lathe && (latheCode === 74 || latheCode === 75)) {
      const hasTarget = words.X !== undefined || words.U !== undefined || words.Z !== undefined || words.W !== undefined;
      if (!hasTarget) {
        if (words.R !== undefined) grooveRetract = Math.abs(words.R * unit);
        continue;
      }
      const xs = pos[0];
      const zs = pos[2];
      const xT = words.X !== undefined ? words.X * unit : words.U !== undefined ? xs + words.U * unit : xs;
      const zT = words.Z !== undefined ? words.Z * unit : words.W !== undefined ? zs + words.W * unit : zs;
      const stepX = words.P !== undefined && words.P > 0 ? microns(words.P) * unit : 0;
      const stepZ = words.Q !== undefined && words.Q > 0 ? microns(words.Q) * unit : 0;
      const retract = grooveRetract;
      let current: Vec3 = [...pos];
      if (latheCode === 74) {
        // Face groove or centre peck drill: pecks along Z, columns step along X.
        const columns: number[] = [xs];
        if (stepX > 0 && Math.abs(xT - xs) > 1e-6) {
          const sign = Math.sign(xT - xs);
          for (let x = xs + sign * stepX * 2; sign * (xT - x) > 1e-6; x += sign * stepX * 2) columns.push(x);
          columns.push(xT);
        }
        for (const x of columns) {
          push("rapid", current, [x, 0, zs], lineIndex);
          let level = zs;
          while (level > zT + 1e-6) {
            const next = stepZ > 0 ? Math.max(level - stepZ, zT) : zT;
            push("feed", [x, 0, level], [x, 0, next], lineIndex);
            level = next;
            if (level <= zT + 1e-6) break;
            const up: Vec3 = [x, 0, Math.min(level + retract, zs)];
            push("rapid", [x, 0, level], up, lineIndex);
            push("rapid", up, [x, 0, Math.min(level + 0.2, zs)], lineIndex);
          }
          push("rapid", [x, 0, level], [x, 0, zs], lineIndex);
          current = [x, 0, zs];
        }
      } else {
        // Outside or inside groove: plunges along X, columns step along Z.
        const rows: number[] = [zs];
        if (stepZ > 0 && Math.abs(zT - zs) > 1e-6) {
          const sign = Math.sign(zT - zs);
          for (let z = zs + sign * stepZ; sign * (zT - z) > 1e-6; z += sign * stepZ) rows.push(z);
          rows.push(zT);
        }
        for (const z of rows) {
          push("rapid", current, [xs, 0, z], lineIndex);
          let level = xs;
          const sign = Math.sign(xT - xs) || -1;
          while (sign * (xT - level) > 1e-6) {
            const next = stepX > 0 ? level + sign * Math.min(stepX * 2, Math.abs(xT - level)) : xT;
            push("feed", [level, 0, z], [next, 0, z], lineIndex);
            level = next;
            if (sign * (xT - level) <= 1e-6) break;
            const back = level - sign * retract * 2;
            push("rapid", [level, 0, z], [back, 0, z], lineIndex);
          }
          push("rapid", [level, 0, z], [xs, 0, z], lineIndex);
          current = [xs, 0, z];
        }
      }
      push("rapid", current, [xs, 0, zs], lineIndex);
      pos = [xs, 0, zs];
      continue;
    }

    if (lathe && latheCode === 70) {
      const block = words.P !== undefined ? contours.get(Math.round(words.P)) : undefined;
      if (!block) {
        warnings.add("G70 needs the same P block number as an earlier G71.");
        continue;
      }
      queue.splice(at + 1, 0, ...block.map((item) => ({ text: item.text, src: item.src, injected: true })));
      continue;
    }

    if (lathe && latheCode === 76) {
      const xs = pos[0];
      const zs = pos[2];
      const endZ = words.Z !== undefined ? words.Z * unit : zs;
      const root = words.X !== undefined ? words.X * unit : xs - 2;
      const height = words.P !== undefined && words.P >= 10 ? words.P / 1000 : Math.max((xs - root) / 2, 0.1);
      const firstDepth = words.Q !== undefined && words.Q >= 10 ? words.Q / 1000 : height / 4;
      const pitch = words.F ?? feed;
      let cursor: Vec3 = [...pos];
      for (let pass = 1; pass <= 40; pass += 1) {
        const depth = Math.min(height, firstDepth * Math.sqrt(pass));
        const diameter = Math.max(xs - depth * 2, root);
        const inPoint: Vec3 = [diameter, 0, zs];
        push("rapid", cursor, inPoint, lineIndex);
        const outPoint: Vec3 = [diameter, 0, endZ];
        push("feed", inPoint, outPoint, lineIndex, false, pitch);
        const clear: Vec3 = [xs, 0, endZ];
        push("rapid", outPoint, clear, lineIndex);
        const home: Vec3 = [xs, 0, zs];
        push("rapid", clear, home, lineIndex);
        cursor = home;
        if (depth >= height - 1e-9) break;
      }
      pos = cursor;
      continue;
    }

    if (lathe && turnCycle && hasMove && moveCode === null) {
      const xa = pos[0];
      const za = pos[2];
      const xT = words.X !== undefined || words.U !== undefined ? target[0] : xa;
      if (words.Z !== undefined || words.W !== undefined) turnCycle.z = target[2];
      if (words.R !== undefined) turnCycle.r = words.R * unit;
      const zT = turnCycle.z ?? za;
      if (turnCycle.kind === 90) {
        const taper = (turnCycle.r ?? 0) * 2;
        const b: Vec3 = [xT, 0, za];
        const c: Vec3 = [xT + taper, 0, zT];
        const d: Vec3 = [xa, 0, zT];
        push("rapid", pos, b, lineIndex);
        push("feed", b, c, lineIndex);
        push("feed", c, d, lineIndex);
        push("rapid", d, [xa, 0, za], lineIndex);
      } else if (turnCycle.kind === 92) {
        const taper = (turnCycle.r ?? 0) * 2;
        const b: Vec3 = [xT, 0, za];
        const c: Vec3 = [xT + taper, 0, zT];
        const d: Vec3 = [xa, 0, zT];
        push("rapid", pos, b, lineIndex);
        push("feed", b, c, lineIndex);
        push("rapid", c, d, lineIndex);
        push("rapid", d, [xa, 0, za], lineIndex);
      } else {
        const b: Vec3 = [xa, 0, zT];
        const c: Vec3 = [xT, 0, zT];
        const d: Vec3 = [xT, 0, za];
        push("rapid", pos, b, lineIndex);
        push("feed", b, c, lineIndex);
        push("feed", c, d, lineIndex);
        push("rapid", d, [xa, 0, za], lineIndex);
      }
      continue;
    }

    // ---- Mill canned cycles --------------------------------------------------------------
    if (cycleCode !== null) {
      cycle = {
        kind: cycleCode,
        z: words.Z !== undefined ? words.Z * unit : cycle?.z ?? pos[2],
        r: words.R !== undefined ? words.R * unit : cycle?.r ?? pos[2] + 2,
        q: words.Q !== undefined ? words.Q * unit : cycle?.q ?? 0,
      };
      initialZ = pos[2];
      if (!tools[toolIndex] || (tools[toolIndex].kind !== "drill" && tools[toolIndex].kind !== "tap" && tools[toolIndex].kind !== "bore")) {
        addTool(specFor(cycleCode === 84 ? "tap" : "drill"));
      }
    }

    if (cycle && !lathe && (words.X !== undefined || words.Y !== undefined)) {
      const holeX = target[0];
      const holeY = target[1];
      holes += 1;
      push("rapid", pos, [holeX, holeY, pos[2]], lineIndex);
      pos = [holeX, holeY, pos[2]];
      const startZ = retractToInitial ? Math.max(initialZ, cycle.r) : cycle.r;
      if (pos[2] !== cycle.r) {
        push("rapid", pos, [holeX, holeY, cycle.r], lineIndex);
        pos = [holeX, holeY, cycle.r];
      }
      const peck = (cycle.kind === 83 || cycle.kind === 73) && cycle.q > 0 ? cycle.q : 0;
      let level = cycle.r;
      while (level > cycle.z + 1e-6) {
        const next = peck ? Math.max(level - peck, cycle.z) : cycle.z;
        push("feed", pos, [holeX, holeY, next], lineIndex);
        pos = [holeX, holeY, next];
        if (next <= cycle.z + 1e-6) break;
        if (cycle.kind === 83) {
          push("rapid", pos, [holeX, holeY, cycle.r], lineIndex);
          push("rapid", [holeX, holeY, cycle.r], [holeX, holeY, next + 0.5], lineIndex);
          pos = [holeX, holeY, next + 0.5];
        } else {
          push("rapid", pos, [holeX, holeY, next + 1], lineIndex);
          pos = [holeX, holeY, next + 1];
        }
        level = next;
      }
      const back: Vec3 = [holeX, holeY, startZ];
      const withFeed = cycle.kind === 84 || cycle.kind === 85 || cycle.kind === 86;
      push(withFeed ? "feed" : "rapid", pos, back, lineIndex);
      pos = back;
      continue;
    }

    if (cycleCode !== null) continue;
    if (moveCode !== null) modal = moveCode;
    if (!hasMove) {
      if (rotary) push(modal === 0 ? "rapid" : "feed", pos, pos, lineIndex);
      continue;
    }

    if (modal === 1 && feed <= 0 && !warnings.has("nofeed")) {
      warnings.add("nofeed");
      warnings.add(`Line ${lineIndex + 1}: a cutting move runs before any feed rate (F) is set.`);
    }

    if (modal === 2 || modal === 3) {
      const clockwise = modal === 2;
      const axes: [number, number] = plane === "xy" ? [0, 1] : plane === "xz" ? [2, 0] : [1, 2];
      const offsets = plane === "xy"
        ? [words.I ?? 0, words.J ?? 0]
        : plane === "xz"
          ? [words.K ?? 0, words.I ?? 0]
          : [words.J ?? 0, words.K ?? 0];
      const a0 = pos[axes[0]] * radiusScale(axes[0]);
      const b0 = pos[axes[1]] * radiusScale(axes[1]);
      let center: [number, number] = [a0 + offsets[0] * unit, b0 + offsets[1] * unit];
      const a1 = target[axes[0]] * radiusScale(axes[0]);
      const b1 = target[axes[1]] * radiusScale(axes[1]);
      if (words.R !== undefined) {
        const radius = Math.abs(words.R * unit);
        const dx = a1 - a0;
        const dy = b1 - b0;
        const chord = Math.hypot(dx, dy) || 1e-6;
        const rise = Math.sqrt(Math.max(radius * radius - (chord / 2) ** 2, 0));
        const side = (clockwise ? 1 : -1) * (words.R < 0 ? -1 : 1);
        center = [a0 + dx / 2 + (side * dy * rise) / chord, b0 + dy / 2 - (side * dx * rise) / chord];
      } else {
        const startRadius = Math.hypot(a0 - center[0], b0 - center[1]);
        const endRadius = Math.hypot(a1 - center[0], b1 - center[1]);
        if (Math.abs(startRadius - endRadius) > 0.02) {
          warnings.add(`Line ${lineIndex + 1}: the arc start and end are ${Math.abs(startRadius - endRadius).toFixed(2)} mm from its centre. Check I, J or K.`);
        }
      }
      let last: Vec3 = pos;
      for (const point of arcPoints(pos, target, axes, center, clockwise, radiusScale)) {
        push("feed", last, point, lineIndex);
        last = point;
      }
      pos = target;
      continue;
    }

    push(modal === 0 ? "rapid" : "feed", pos, target, lineIndex);
    pos = target;
  }

  warnings.delete("nofeed");
  const multiAxis = motions.some((motion) => motion.axisFrom !== undefined) || tools.some((tool) => tool.kind === "tslot" || tool.kind === "dovetail");
  return { lathe, motions, tools, warnings: [...warnings], holes, start, multiAxis };
}
