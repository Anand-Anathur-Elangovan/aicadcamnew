import type { MachiningFeature, PartFeatures } from "@/lib/cad/featureExtractor";

/**
 * What backs the numbers that were read from a drawing.
 * A value that is printed in the sheet's text layer is grounded. A value that only the picture reader produced is not.
 */
export interface ReadingEvidence {
  /** A readable text layer was available to check against. */
  sheetText: boolean;
  /** Every number printed in that text. */
  numbers: number[];
  /** Places where two independent reads of the same sheet disagree. */
  conflicts: string[];
  /** Two separate reads of the picture were compared. */
  crossRead?: boolean;
  /** The user compared the values with the sheet and confirmed them. */
  confirmed?: boolean;
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** Every number in the sheet text, with comma decimals read as points. */
export function numbersOnSheet(text: string): number[] {
  const found = new Set<number>();
  for (const match of text.matchAll(/(?<![\w.])(\d+(?:[.,]\d+)?)(?![\w])/g)) {
    const value = Number(match[1].replace(",", "."));
    if (Number.isFinite(value)) found.add(round3(value));
  }
  // Sizes written as 40x40x80 or Ø32 stay readable because the pattern stops at the letter or symbol.
  for (const match of text.matchAll(/(\d+(?:[.,]\d+)?)\s*[xX×]/g)) found.add(round3(Number(match[1].replace(",", "."))));
  for (const match of text.matchAll(/[xX×]\s*(\d+(?:[.,]\d+)?)/g)) found.add(round3(Number(match[1].replace(",", "."))));
  for (const match of text.matchAll(/[Øø∅Φ]\s*(\d+(?:[.,]\d+)?)/g)) found.add(round3(Number(match[1].replace(",", "."))));
  return [...found].sort((a, b) => a - b);
}

export function onSheet(evidence: ReadingEvidence | undefined, value: number | undefined): boolean {
  if (!evidence?.sheetText || value === undefined || !(value > 0)) return true;
  const target = round3(value);
  return evidence.numbers.some((number) => Math.abs(number - target) < 0.0015);
}

function claims(features: PartFeatures): { label: string; value: number }[] {
  const out: { label: string; value: number }[] = [];
  const dims = features.rawDimensions;
  const add = (label: string, value: number | undefined) => {
    if (value && value > 0) out.push({ label, value });
  };
  add("stock length", dims.length);
  add("stock width", dims.width);
  add("stock height", dims.height);
  add("outside diameter", dims.diameter);
  features.features.forEach((feature, index) => {
    const name = `${feature.type} ${index + 1}`;
    add(`${name} diameter`, feature.diameter);
    add(`${name} depth`, feature.depth);
    add(`${name} width`, feature.width);
    add(`${name} length`, feature.length);
  });
  return out;
}

/** The claimed values that no printed number on the sheet matches. */
export function ungrounded(features: PartFeatures): { label: string; value: number }[] {
  const evidence = features.evidence;
  if (!evidence?.sheetText) return [];
  return claims(features).filter((claim) => !onSheet(evidence, claim.value));
}

function sameSize(a: number[], b: number[], tolerance = 0.6): boolean {
  const left = [...a].sort((x, y) => x - y);
  const right = [...b].sort((x, y) => x - y);
  return left.every((value, index) => Math.abs(value - right[index]) <= tolerance);
}

const SIZE_RE = /(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)/;
const COUNT_RE = /(\d+)\s*[xX×]?\s*(?:holes?|bores?)\b/gi;
const THREAD_RE = /\bM\s*(\d+(?:\.\d+)?)\b/g;

function total(features: PartFeatures, types: MachiningFeature["type"][]): number {
  return features.features.filter((feature) => types.includes(feature.type)).reduce((sum, feature) => sum + Math.max(feature.count, 1), 0);
}

/** Compares the picture reading with what the text layer says on its own. */
export function conflictsWithText(features: PartFeatures, text: string): string[] {
  const conflicts: string[] = [];
  const size = SIZE_RE.exec(text);
  const dims = features.rawDimensions;
  if (size && dims.length > 0 && dims.width > 0 && dims.height > 0) {
    const printed = [size[1], size[2], size[3]].map((value) => Number(value.replace(",", ".")));
    if (!sameSize(printed, [dims.length, dims.width, dims.height])) {
      conflicts.push(`The sheet text prints a size of ${printed.join(" x ")} mm, but the reading says ${dims.length} x ${dims.width} x ${dims.height} mm.`);
    }
  }

  const counts = [...text.matchAll(COUNT_RE)].map((match) => Number(match[1])).filter((value) => value > 0 && value < 200);
  if (counts.length) {
    const printedHoles = counts.reduce((sum, value) => sum + value, 0);
    const read = total(features, ["hole", "bore", "counterbore", "countersink"]);
    if (read !== printedHoles) conflicts.push(`The sheet text mentions ${printedHoles} hole${printedHoles === 1 ? "" : "s"}, but the reading has ${read}.`);
  }

  const threads = new Set([...text.matchAll(THREAD_RE)].map((match) => Number(match[1])));
  for (const feature of features.features) {
    if (feature.type === "thread" && feature.diameter && threads.size && !threads.has(feature.diameter)) {
      conflicts.push(`The reading has an M${feature.diameter} thread, but the sheet text only shows ${[...threads].map((value) => `M${value}`).join(", ")}.`);
    }
  }
  return conflicts;
}

/** Adds the evidence from the sheet text to a reading. A sheet with no readable text keeps `sheetText: false`. */
export function attachEvidence(features: PartFeatures, text: string): PartFeatures {
  const readable = text.trim().length >= 40;
  const numbers = readable ? numbersOnSheet(text) : [];
  const conflicts = readable ? conflictsWithText(features, text) : [];
  return { ...features, evidence: { sheetText: readable, numbers, conflicts, crossRead: features.evidence?.crossRead } };
}

function differs(a: number | undefined, b: number | undefined, tolerance = 0.05): boolean {
  if (!a && !b) return false;
  if (!a || !b) return true;
  return Math.abs(a - b) > tolerance;
}

/** Compares two independent reads of the same picture. Anything they disagree on is uncertain. */
export function compareReads(first: PartFeatures, second: PartFeatures): string[] {
  const out: string[] = [];
  const a = first.rawDimensions;
  const b = second.rawDimensions;
  for (const key of ["length", "width", "height", "diameter"] as const) {
    if (differs(a[key], b[key])) out.push(`Two reads of the sheet disagree on the ${key === "diameter" ? "outside diameter" : `stock ${key}`}: ${a[key] ?? "none"} and ${b[key] ?? "none"}.`);
  }
  const bucket = (features: PartFeatures) => {
    const map = new Map<string, number>();
    for (const feature of features.features) {
      const key = `${feature.type} d${feature.diameter ?? "?"} z${feature.depth ?? "?"}`;
      map.set(key, (map.get(key) ?? 0) + Math.max(feature.count, 1));
    }
    return map;
  };
  const left = bucket(first);
  const right = bucket(second);
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    if (left.get(key) !== right.get(key)) out.push(`Two reads of the sheet disagree on "${key.replace(/ d\?/, "").replace(/ z\?/, "")}": ${left.get(key) ?? 0} and ${right.get(key) ?? 0}.`);
  }
  if (first.material && second.material && first.material !== "UNKNOWN" && second.material !== "UNKNOWN" && first.material.toLowerCase() !== second.material.toLowerCase()) {
    out.push(`Two reads of the sheet disagree on the material: "${first.material}" and "${second.material}".`);
  }
  return out;
}

export function mergeEvidence(parts: (ReadingEvidence | undefined)[]): ReadingEvidence | undefined {
  const present = parts.filter((part): part is ReadingEvidence => Boolean(part));
  if (!present.length) return undefined;
  return {
    sheetText: present.some((part) => part.sheetText),
    numbers: [...new Set(present.flatMap((part) => part.numbers))].sort((a, b) => a - b),
    conflicts: present.flatMap((part) => part.conflicts),
    crossRead: present.some((part) => part.crossRead),
  };
}
