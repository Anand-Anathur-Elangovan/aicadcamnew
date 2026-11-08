/**
 * Post-processors. The Studio generates and simulates one neutral Fanuc-style program.
 * A post turns that program into the dialect a given controller expects.
 * Each post is unit-tested, but none has run on a real machine, so every program needs a dry run first.
 */

export type Controller = "fanuc" | "haas" | "siemens";

export interface PostOptions {
  controller: Controller;
  /** "mill" or "lathe". It picks the start and end blocks. */
  kind: "mill" | "lathe";
  /** Work offset the part is set to. */
  workOffset?: string;
  /** Spindle limit of the machine, used for a warning only. */
  maxRpm?: number;
}

export interface PostResult {
  controller: Controller;
  text: string;
  warnings: string[];
}

export const CONTROLLERS: { id: Controller; label: string; note: string }[] = [
  { id: "fanuc", label: "Fanuc (0i / 31i)", note: "Plain ISO G-code. Matches what the simulator runs." },
  { id: "haas", label: "Haas (NGC)", note: "Haas start and end blocks, G53 homing and M29 rigid tapping." },
  { id: "siemens", label: "Siemens (Sinumerik 840D)", note: "Native dialect with CYCLE81/83/84/85. The built-in simulator runs the neutral program, not this text." },
];

export const POST_NOTE = "Each controller post is checked by unit tests only. Run the program as a dry run with the feed override down before cutting metal.";

interface Cycle {
  code: "G81" | "G82" | "G83" | "G84" | "G85" | "G86" | "G89" | "G73";
  z: number;
  r: number;
  q: number;
  f: number;
  p: number;
}

const WORD = (line: string, letter: string): number | null => {
  const match = new RegExp(`(?:^|[^A-Z])${letter}(-?\\d*\\.?\\d+)`).exec(line.replace(/\([^)]*\)/g, ""));
  return match ? Number(match[1]) : null;
};

const num = (value: number): string => {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
};

function body(program: string): string[] {
  return program
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== "%");
}

function commentOf(line: string): string {
  const match = /\(([^)]*)\)/.exec(line);
  return match ? match[1] : "";
}

function fanuc(lines: string[], options: PostOptions, warnings: string[]): string[] {
  const out: string[] = ["%"];
  const offset = options.workOffset ?? "G54";
  lines.forEach((line, index) => {
    if (index === 0 && /^O\d+/.test(line)) out.push(line);
    else if (/^G21 G17 G90 G40 G49$/.test(line)) out.push(`G21 G17 G90 G40 G49 G80 ${offset}`);
    else if (/^G21 G18 G40 G99$/.test(line)) out.push("G21 G18 G40 G99");
    else if (/^T\d+ M06$/.test(line)) out.push("G91 G28 Z0", "G90", line);
    else if (line === "M30") {
      if (options.kind === "mill") out.push("G91 G28 Z0", "G28 X0 Y0", "G90");
      out.push(line);
    } else out.push(line);
  });
  out.push("%");
  if (options.maxRpm) rpmWarnings(lines, options.maxRpm, warnings);
  return out;
}

function haas(lines: string[], options: PostOptions, warnings: string[]): string[] {
  const out: string[] = ["%"];
  const offset = options.workOffset ?? "G54";
  let first = true;
  lines.forEach((line) => {
    if (first && /^O\d+/.test(line)) {
      first = false;
      const number = Number(/^O(\d+)/.exec(line)?.[1] ?? 1);
      // Haas program numbers are O00001-O99999, and O09000 up is reserved for the control's own use.
      const safe = number >= 9000 ? number - 8000 : number;
      out.push(`O${String(safe).padStart(5, "0")}${line.replace(/^O\d+/, "")}`);
      return;
    }
    if (/^G21 G17 G90 G40 G49$/.test(line)) {
      out.push(`G21 G17 G40 G49 G80 G90 ${offset}`);
      return;
    }
    if (/^G21 G18 G40 G99$/.test(line)) {
      out.push("G21 G18 G40 G99");
      return;
    }
    if (/^T\d+ M06$/.test(line)) {
      out.push("G53 G49 Z0", line);
      return;
    }
    if (line === "M30") {
      out.push(options.kind === "mill" ? "G53 G49 Z0" : "G53 X0", options.kind === "mill" ? "G53 Y0" : "G53 Z0", line);
      return;
    }
    if (line === "G28 U0 W0") {
      out.push("G53 X0", "G53 Z0");
      return;
    }
    // Haas rigid tapping wants the speed given with M29 on the line before the cycle.
    const cycle = /^(?:G99 |G98 )?G84\b/.exec(line);
    if (cycle) {
      const s = lastSpindle(out);
      if (s) out.push(`M29 S${s}`);
      out.push(line);
      return;
    }
    out.push(line);
  });
  out.push("%");
  if (options.maxRpm) rpmWarnings(lines, options.maxRpm, warnings);
  return out;
}

function lastSpindle(lines: string[]): number | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = /(?:^|\s)S(\d+)\b/.exec(lines[index]);
    if (match) return Number(match[1]);
  }
  return null;
}

function rpmWarnings(lines: string[], maxRpm: number, warnings: string[]): void {
  for (const line of lines) {
    if (/G96/.test(line)) continue;
    const s = WORD(line, "S");
    if (s !== null && /M0?3/.test(line) && s > maxRpm) warnings.push(`${line} asks for ${s} rpm, above the machine limit of ${maxRpm}.`);
  }
}

function siemens(lines: string[], options: PostOptions, warnings: string[]): string[] {
  const out: string[] = [];
  const offset = options.workOffset ?? "G54";
  const lathe = options.kind === "lathe";
  let spindle = 0;
  let cycle: Cycle | null = null;
  let plane = 50;
  let tool = 0;

  const rtp = () => num(plane);
  const call = (c: Cycle, mode: "call" | "end") => {
    if (mode === "end") return "MCALL";
    const sdis = num(c.r);
    if (c.code === "G81") return `MCALL CYCLE81(${rtp()},0,${sdis},${num(c.z)})`;
    if (c.code === "G82") return `MCALL CYCLE82(${rtp()},0,${sdis},${num(c.z)},,${num(c.p || 0)})`;
    if (c.code === "G83" || c.code === "G73") return `MCALL CYCLE83(${rtp()},0,${sdis},${num(c.z)},,${num(-Math.abs(c.q || 5))},,0,0,0,1,${c.code === "G73" ? 0 : 1})`;
    if (c.code === "G84") {
      const pitch = spindle > 0 ? c.f / spindle : 0;
      return `MCALL CYCLE84(${rtp()},0,${sdis},${num(c.z)},,0,3,,${num(pitch)},0,${spindle},${spindle})`;
    }
    if (c.code === "G85") return `MCALL CYCLE85(${rtp()},0,${sdis},${num(c.z)},,0,${num(c.f)},${num(c.f * 2)})`;
    warnings.push(`${c.code} has no Siemens cycle mapping here. Replace it by hand.`);
    return `; ${c.code} not mapped`;
  };

  out.push(`; ${commentOf(lines[0] ?? "") || "PROGRAM"}`, lathe ? "G18 G90 G71 G95" : `G17 G90 G71 ${offset}`);
  lines.forEach((line, index) => {
    if (index === 0 && /^O\d+/.test(line)) return;
    if (/^G21 /.test(line)) return;
    if (/^\(.*\)$/.test(line)) {
      out.push(`; ${commentOf(line)}`);
      return;
    }
    const toolChange = /^T(\d+) M06$/.exec(line);
    if (toolChange) {
      tool = Number(toolChange[1]);
      out.push(`T="TOOL${tool}"`, "M6", "D1");
      return;
    }
    const latheTool = /^T(\d{2})(\d{2})$/.exec(line);
    if (latheTool) {
      out.push(`T${Number(latheTool[1])} D${Number(latheTool[2]) || 1}`);
      return;
    }
    if (/^G43 H\d+ Z/.test(line)) {
      // Siemens applies the tool length with the D offset, so only the approach move stays.
      plane = WORD(line, "Z") ?? plane;
      out.push(`G0 Z${num(plane)}`);
      return;
    }
    if (line === "G28 U0 W0") {
      out.push("G74 X1=0 Z1=0");
      return;
    }
    if (/^G50 S/.test(line)) {
      out.push(`LIMS=${WORD(line, "S") ?? 3000}`);
      return;
    }
    const speed = WORD(line, "S");
    if (speed !== null && !/G96/.test(line)) spindle = speed;
    const code = /\bG(\d+)\b/g;
    const gcodes = [...line.matchAll(code)].map((match) => `G${match[1]}`);
    const cycleCode = gcodes.find((g) => ["G81", "G82", "G83", "G84", "G85", "G86", "G89", "G73"].includes(g)) as Cycle["code"] | undefined;
    if (cycleCode && !lathe) {
      cycle = {
        code: cycleCode,
        z: WORD(line, "Z") ?? 0,
        r: WORD(line, "R") ?? 2,
        q: WORD(line, "Q") ?? 0,
        f: WORD(line, "F") ?? 0,
        p: WORD(line, "P") ?? 0,
      };
      out.push(call(cycle, "call"));
      const x = WORD(line, "X");
      const y = WORD(line, "Y");
      if (x !== null || y !== null) out.push(`${x !== null ? `X${num(x)} ` : ""}${y !== null ? `Y${num(y)}` : ""}`.trim());
      return;
    }
    if (line === "G80") {
      if (cycle) out.push("MCALL");
      cycle = null;
      return;
    }
    if (cycle && /^X-?\d/.test(line) && !/\bG\d/.test(line)) {
      out.push(line);
      return;
    }
    if (/^M30$/.test(line)) {
      out.push("M30");
      return;
    }
    const converted = line
      .replace(/\bG00\b/g, "G0")
      .replace(/\bG01\b/g, "G1")
      .replace(/\bG02\b/g, "G2")
      .replace(/\bG03\b/g, "G3")
      .replace(/\bM03\b/g, "M3")
      .replace(/\bM05\b/g, "M5")
      .replace(/\bG99\b/g, "G95")
      .replace(/\bG98\b/g, "G94")
      .replace(/\bG40 G49\b/g, "G40");
    if (/\bG7[0-6]\b|\bG9[024]\b.*[UW]/.test(converted) && lathe) {
      warnings.push(`${converted}: Fanuc turning cycles are not translated to CYCLE95/CYCLE97. Use ISO dialect mode (G291) or program the cycle on the control.`);
    }
    out.push(converted);
  });
  if (tool === 0 && !lathe) warnings.push("No tool call found in the program.");
  if (options.maxRpm) rpmWarnings(lines, options.maxRpm, warnings);
  return out;
}

/** Turn the neutral Fanuc-style program into the dialect of one controller. */
export function postProcess(program: string, options: PostOptions): PostResult {
  const warnings: string[] = [];
  const lines = body(program);
  let result: string[];
  if (options.controller === "haas") result = haas(lines, options, warnings);
  else if (options.controller === "siemens") result = siemens(lines, options, warnings);
  else result = fanuc(lines, options, warnings);
  return { controller: options.controller, text: result.join("\n") + "\n", warnings };
}

/** Checks a posted program for things the target controller is known to reject. */
export function lintPosted(text: string, controller: Controller): string[] {
  const issues: string[] = [];
  const lines = text.split(/\r?\n/);
  if (controller === "siemens") {
    lines.forEach((line, index) => {
      if (/^\s*G8[1-9]\b/.test(line)) issues.push(`Line ${index + 1}: ${line.trim()} is a Fanuc cycle and is not valid Siemens native code.`);
      if (/\bG43\b|\bH\d+\b/.test(line) && !line.startsWith(";")) issues.push(`Line ${index + 1}: tool length compensation G43/H does not exist on Siemens.`);
      if (/\bG20\b|\bG21\b/.test(line)) issues.push(`Line ${index + 1}: G20/G21 select the unit only in ISO mode on Siemens.`);
    });
  }
  if (controller === "haas") {
    const first = lines.find((line) => /^O/.test(line));
    if (first && /^O\d{5}/.test(first) && Number(first.slice(1, 6)) >= 9000) issues.push("Program numbers O09000 and above are reserved on Haas.");
    if (!lines.some((line) => line.startsWith("%"))) issues.push("A Haas program starts and ends with %.");
  }
  if (controller === "fanuc" && !lines.some((line) => /^O\d+/.test(line))) issues.push("A Fanuc program needs an O number on its first block.");
  return issues;
}
