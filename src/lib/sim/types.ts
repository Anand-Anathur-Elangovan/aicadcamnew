export type Vec3 = [number, number, number];

/**
 * Cutter shapes the simulator knows.
 * Mill: ball, flat, face, drill, tap. Lathe: od (outside turning insert), bore (boring bar).
 */
export type ToolKind = "ball" | "flat" | "face" | "drill" | "tap" | "od" | "bore" | "tslot" | "dovetail";

export interface ToolSpec {
  kind: ToolKind;
  diameter: number;
  /** Length that may enter material. Anything above is holder, and holder cannot cut. */
  fluteLength: number;
  /** T-slot cutter: height of the cutting disc. */
  thickness?: number;
  /** T-slot and dovetail: diameter of the neck above the cutting part. */
  neck?: number;
  /** Dovetail: flank angle from the tool axis, degrees. */
  angle?: number;
}

export interface Motion {
  kind: "rapid" | "feed";
  from: Vec3;
  to: Vec3;
  /** 0-based line in the program text. */
  line: number;
  tool: number;
  spindle: boolean;
  home?: boolean;
  /** Feed word in force: mm/min on a mill, mm/rev on a lathe under G99. */
  f: number;
  perRev: boolean;
  /** Spindle word: RPM, or surface speed in m/min when css is true. */
  s: number;
  css: boolean;
  /** Unit tool axis at the start and end of the move. Absent means straight down (Z). */
  axisFrom?: Vec3;
  axisTo?: Vec3;
}

export interface ParsedProgram {
  lathe: boolean;
  motions: Motion[];
  tools: ToolSpec[];
  warnings: string[];
  /** Holes made by canned drilling cycles. */
  holes: number;
  /** Program coordinates of the first position, so the first move starts from home. */
  start: Vec3;
  /** True when the program tilts the tool or uses an undercut cutter, so the height map cannot show it. */
  multiAxis?: boolean;
}

export interface InterpretOptions {
  /** Where the machine starts and where G28 returns to. Lathe X is diameter. */
  home: Vec3;
  /** Pass true to force lathe or mill. Omit to detect from the text. */
  lathe?: boolean;
}

export type CollisionKind = "rapid" | "holder" | "table" | "chuck" | "centre" | "spindle" | "bite";

export interface Collision {
  kind: CollisionKind;
  line: number;
  motion: number;
  point: Vec3;
  message: string;
}

export interface SimReport {
  collision: Collision | null;
  warnings: string[];
  moves: number;
  feedMoves: number;
  /** Virtual seconds for the whole program. */
  duration: number;
  cutDistance: number;
  rapidDistance: number;
  /** Estimated machining time in seconds, at the programmed feeds. */
  estimatedSeconds: number;
  holes: number;
  /** Surface cells this program newly cut. Zero means the program removes no metal. */
  cutCells: number;
  bbox: { min: Vec3; max: Vec3 } | null;
}

export type MillSetup = {
  family: "mill";
  /** Stock corner at X0, Y0 unless x0/y0 say otherwise. */
  x0: number;
  y0: number;
  length: number;
  width: number;
  /** Highest and lowest Z of the stock. Z0 is the finished top face. */
  top: number;
  bottom: number;
  /** Saved programs of earlier operations, cut into the stock first. */
  previous: string[];
};

export type LatheSetup = {
  family: "lathe";
  length: number;
  /** A rectangular bar or a round bar, centred on the spindle. */
  shape: { kind: "rect"; width: number; height: number } | { kind: "round"; diameter: number };
  /** Z of the first face the jaws touch. Z at or below this, inside jaw radius, is the chuck. */
  chuckZ: number;
  chuckRadius: number;
  previous: string[];
};

export type SimSetup = MillSetup | LatheSetup;
