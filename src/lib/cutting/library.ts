import type { Timing } from "@/lib/sim/stats";
/**
 * Shop library: work materials, standard tools and machine limits.
 * Numbers are typical handbook values for coated carbide tooling. They are a sound starting point, not a substitute for the tool maker's data sheet.
 * Every shop can replace entries with setShopLibrary().
 */

export type IsoGroup = "P" | "M" | "K" | "N" | "S";

export interface Material {
  id: string;
  label: string;
  iso: IsoGroup;
  match: RegExp;
  /** Specific cutting force at 1 mm chip thickness (N/mm2) and its exponent. Kienzle model. */
  kc11: number;
  mc: number;
  /** Surface speeds in m/min that give about 60 minutes of tool life. */
  vcMill: number;
  vcTurn: number;
  vcDrill: number;
  vcTap: number;
  /** Chip-load multiplier against steel. */
  fzScale: number;
  /** Roughing feed per revolution when turning, mm/rev. */
  feedTurn: number;
  /** Drill feed per revolution is this fraction of the drill diameter. */
  drillK: number;
  coolant: "flood" | "mist" | "air" | "none";
}

export const MATERIALS: Material[] = [
  { id: "aluminium", label: "Aluminium 6061 / 7075", iso: "N", match: /alumin|alu\b|6061|7075|6082|2024|\bal\b/i, kc11: 700, mc: 0.25, vcMill: 350, vcTurn: 350, vcDrill: 80, vcTap: 30, fzScale: 1.4, feedTurn: 0.3, drillK: 0.02, coolant: "flood" },
  { id: "brass", label: "Brass / bronze", iso: "N", match: /brass|bronze|copper|cu\b|c360|c36000/i, kc11: 780, mc: 0.25, vcMill: 250, vcTurn: 250, vcDrill: 60, vcTap: 25, fzScale: 1.2, feedTurn: 0.3, drillK: 0.018, coolant: "flood" },
  { id: "plastic", label: "Plastics (acetal, nylon)", iso: "N", match: /plastic|acetal|delrin|nylon|pom\b|peek|abs\b|pvc|ptfe/i, kc11: 300, mc: 0.25, vcMill: 300, vcTurn: 300, vcDrill: 60, vcTap: 20, fzScale: 1.5, feedTurn: 0.25, drillK: 0.02, coolant: "air" },
  { id: "mild-steel", label: "Carbon steel (EN8, 1045, 1018)", iso: "P", match: /\ben\s?8\b|\ben\s?3\b|1018|1020|1045|c45|c\s?45|mild|carbon|s45c|\bms\b|a36|e250/i, kc11: 1800, mc: 0.25, vcMill: 180, vcTurn: 220, vcDrill: 30, vcTap: 12, fzScale: 1.0, feedTurn: 0.25, drillK: 0.012, coolant: "flood" },
  { id: "alloy-steel", label: "Alloy steel (4140, EN19, 4340)", iso: "P", match: /4140|4340|en\s?19|en\s?24|42crmo|alloy|8620|scm4/i, kc11: 2100, mc: 0.25, vcMill: 150, vcTurn: 180, vcDrill: 25, vcTap: 10, fzScale: 0.9, feedTurn: 0.22, drillK: 0.011, coolant: "flood" },
  { id: "tool-steel", label: "Tool steel (H13, P20, D2)", iso: "P", match: /h13|p20|d2\b|o1\b|a2\b|tool steel|1\.2344|1\.2738/i, kc11: 2300, mc: 0.25, vcMill: 120, vcTurn: 140, vcDrill: 18, vcTap: 8, fzScale: 0.8, feedTurn: 0.18, drillK: 0.01, coolant: "flood" },
  { id: "stainless", label: "Stainless steel (303, 304, 316)", iso: "M", match: /stainless|\bss\b|\b30[34]\b|\b316l?\b|\b410\b|\b17-4\b|a2-70|inox/i, kc11: 2000, mc: 0.25, vcMill: 100, vcTurn: 130, vcDrill: 15, vcTap: 6, fzScale: 0.8, feedTurn: 0.2, drillK: 0.008, coolant: "flood" },
  { id: "cast-iron", label: "Cast iron", iso: "K", match: /cast iron|\bci\b|gg\s?25|\bfc\s?250|grey iron|gray iron|ductile|\bgjl\b|\bgjs\b/i, kc11: 1100, mc: 0.25, vcMill: 150, vcTurn: 180, vcDrill: 30, vcTap: 15, fzScale: 1.0, feedTurn: 0.25, drillK: 0.015, coolant: "air" },
  { id: "titanium", label: "Titanium Ti-6Al-4V", iso: "S", match: /titan|ti-6al|ti6al|ti\s?64|grade\s?5/i, kc11: 1400, mc: 0.25, vcMill: 55, vcTurn: 60, vcDrill: 12, vcTap: 5, fzScale: 0.7, feedTurn: 0.15, drillK: 0.007, coolant: "flood" },
];

export interface MaterialMatch {
  material: Material;
  /** False when the name was not recognised and a steel value was used instead. */
  recognised: boolean;
}

let materials = MATERIALS;

export function findMaterial(name: string | undefined): MaterialMatch {
  const text = (name ?? "").trim();
  if (text && !/^unknown$/i.test(text)) {
    const hit = materials.find((entry) => entry.match.test(text));
    if (hit) return { material: hit, recognised: true };
  }
  return { material: materials.find((entry) => entry.id === "mild-steel") ?? materials[0], recognised: false };
}

export function materialById(id: string): Material | undefined {
  return materials.find((entry) => entry.id === id);
}

export function allMaterials(): Material[] {
  return materials;
}

// ─── Tools ───────────────────────────────────────────────────────────────────

export const END_MILLS = [2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 25];
export const FACE_MILLS = [32, 40, 50, 63, 80, 100];
export const DRILLS = [1, 1.5, 2, 2.5, 3, 3.3, 4, 4.2, 5, 5.5, 6, 6.8, 7, 8, 8.5, 9, 10, 10.2, 11, 12, 13, 14, 14.5, 15, 16, 17.5, 18, 20, 22, 25, 28, 32];

export interface TapSize {
  name: string;
  nominal: number;
  pitch: number;
  drill: number;
}

/** Metric coarse taps with the drill that leaves about 75% thread. */
export const TAPS: TapSize[] = [
  { name: "M3", nominal: 3, pitch: 0.5, drill: 2.5 },
  { name: "M4", nominal: 4, pitch: 0.7, drill: 3.3 },
  { name: "M5", nominal: 5, pitch: 0.8, drill: 4.2 },
  { name: "M6", nominal: 6, pitch: 1.0, drill: 5.0 },
  { name: "M8", nominal: 8, pitch: 1.25, drill: 6.8 },
  { name: "M10", nominal: 10, pitch: 1.5, drill: 8.5 },
  { name: "M12", nominal: 12, pitch: 1.75, drill: 10.2 },
  { name: "M14", nominal: 14, pitch: 2.0, drill: 12.0 },
  { name: "M16", nominal: 16, pitch: 2.0, drill: 14.0 },
  { name: "M20", nominal: 20, pitch: 2.5, drill: 17.5 },
];

export function tapForDrill(drill: number): TapSize {
  const exact = TAPS.find((tap) => Math.abs(tap.drill - drill) < 0.25);
  if (exact) return exact;
  return TAPS.reduce((best, tap) => (Math.abs(tap.nominal - (drill + 1.2)) < Math.abs(best.nominal - (drill + 1.2)) ? tap : best), TAPS[0]);
}

export function tapByNominal(diameter: number): TapSize {
  return TAPS.reduce((best, tap) => (Math.abs(tap.nominal - diameter) < Math.abs(best.nominal - diameter) ? tap : best), TAPS[0]);
}

export function snapDown(sizes: number[], wanted: number): number {
  const fits = sizes.filter((size) => size <= wanted + 1e-6);
  return fits.length ? fits[fits.length - 1] : sizes[0];
}

export type ToolFamily = "face" | "flat" | "ball" | "drill" | "tap" | "bore" | "od";

export interface StockTool {
  family: ToolFamily;
  label: string;
  diameter: number;
  flutes: number;
  material: "Carbide" | "HSS" | "HSS-Co";
  coated: boolean;
  /** True when the size is on the shop's standard list. A false value needs a special or ground tool. */
  standard: boolean;
  note?: string;
}

export function stockTool(family: ToolFamily, diameter: number, material?: Material): StockTool {
  const soft = material?.iso === "N";
  switch (family) {
    case "face":
      return { family, label: "Face mill with inserts", diameter, flutes: Math.max(3, Math.round(diameter / 10)), material: "Carbide", coated: true, standard: FACE_MILLS.includes(diameter) };
    case "flat":
      return { family, label: "Carbide end mill", diameter, flutes: soft ? 3 : 4, material: "Carbide", coated: !soft, standard: END_MILLS.includes(diameter), note: soft ? "Uncoated, polished flutes for aluminium" : undefined };
    case "ball":
      return { family, label: "Ball nose end mill", diameter, flutes: 2, material: "Carbide", coated: !soft, standard: END_MILLS.includes(diameter) };
    case "drill": {
      const standard = DRILLS.includes(diameter);
      return { family, label: diameter >= 3 && !soft ? "Carbide-tipped drill" : "Drill", diameter, flutes: 2, material: soft ? "HSS-Co" : "Carbide", coated: true, standard, note: standard ? undefined : `Ø${diameter} mm is not a stock drill size. Use a ground or special drill.` };
    }
    case "tap": {
      const tap = tapForDrill(diameter);
      return { family, label: `${tap.name} x ${tap.pitch} spiral-point tap`, diameter: tap.nominal, flutes: 3, material: "HSS-Co", coated: true, standard: true };
    }
    case "bore":
      return { family, label: "Boring bar with insert", diameter, flutes: 1, material: "Carbide", coated: true, standard: true };
    default:
      return { family, label: "CNMG turning insert", diameter: 0, flutes: 1, material: "Carbide", coated: true, standard: true };
  }
}

// ─── Machines ────────────────────────────────────────────────────────────────

export interface MachineLimits {
  id: string;
  label: string;
  maxRpm: number;
  /** Continuous spindle power in kW. */
  kw: number;
  /** Highest cutting feed the control and axes allow, mm/min. */
  maxFeed: number;
  efficiency: number;
  /** Rapid traverse, mm/min. */
  rapid: number;
  /** Seconds per tool change. */
  toolChange: number;
}

export const MACHINES: Record<string, MachineLimits> = {
  vmc: { id: "vmc", label: "3-axis VMC", maxRpm: 8000, kw: 11, maxFeed: 10000, efficiency: 0.8, rapid: 30000, toolChange: 6 },
  vmc5: { id: "vmc5", label: "5-axis VMC", maxRpm: 12000, kw: 15, maxFeed: 12000, efficiency: 0.8, rapid: 36000, toolChange: 4 },
  lathe: { id: "lathe", label: "CNC lathe", maxRpm: 3500, kw: 11, maxFeed: 3000, efficiency: 0.8, rapid: 24000, toolChange: 2.5 },
};

export function machineLimits(id: string | undefined): MachineLimits {
  return MACHINES[id ?? "vmc"] ?? MACHINES.vmc;
}

/** Lets a shop replace the built-in materials with its own table. */
export function setShopLibrary(custom: { materials?: Material[] }): void {
  materials = custom.materials?.length ? custom.materials : MATERIALS;
}

export function timingOf(machine: MachineLimits): Timing {
  return { rapid: machine.rapid, maxRpm: machine.maxRpm, maxFeed: machine.maxFeed, toolChange: machine.toolChange, perMove: 0.08 };
}
