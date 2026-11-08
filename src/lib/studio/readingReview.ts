import type { MachiningFeature, PartFeatures } from "@/lib/cad/featureExtractor";
import { ungrounded } from "@/lib/cad/readingEvidence";
import type { StagePlan, TurningJob } from "@/lib/studio/stages";

export interface ReadingIssue {
  level: "error" | "warning" | "info";
  message: string;
}

const positive = (value: number | undefined): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

function featureLabel(feature: MachiningFeature, index: number): string {
  return `${feature.type} ${index + 1}`;
}

/** Checks what was read from the drawing before it becomes a plan. Errors stop a plan from being trusted; warnings need a look. */
export function reviewFeatures(features: PartFeatures): ReadingIssue[] {
  const issues: ReadingIssue[] = [];
  const { length, width, height } = features.rawDimensions;
  const stated = positive(length) && positive(width) && positive(height);
  if (!stated) {
    issues.push({ level: "warning", message: "The sheets did not state the full stock size (length, width and height). A stand-in of 120 x 80 x 25 mm is used until you enter it." });
  }
  if (!features.partNumber || /^UNKNOWN$/i.test(features.partNumber)) issues.push({ level: "warning", message: "No part number was found. Enter it so the programs and sheets carry the right number." });
  if (!features.material || /^UNKNOWN$/i.test(features.material)) issues.push({ level: "warning", message: "No material was found. Cutting speeds depend on it." });

  const stockLength = positive(length) ? length : 120;
  const stockWidth = positive(width) ? width : 80;
  const stockHeight = positive(height) ? height : 25;
  const cuts = features.features.filter((feature) => !["face", "chamfer", "fillet", "profile", "boss"].includes(feature.type));
  if (cuts.length === 0 && features.partType !== "rotational") {
    issues.push({ level: "info", message: "No holes, pockets or slots were read. The plan faces the stock and follows the outline only." });
  }

  features.features.forEach((feature, index) => {
    const label = featureLabel(feature, index);
    const kind = feature.type;
    if (kind === "hole" || kind === "bore" || kind === "counterbore" || kind === "countersink") {
      if (!positive(feature.diameter)) issues.push({ level: "warning", message: `${label}: no diameter was read. 8 mm is assumed.` });
      else if (feature.diameter >= Math.min(stockLength, stockWidth)) issues.push({ level: "error", message: `${label}: the diameter ${feature.diameter} mm does not fit in the stock (${stockLength} x ${stockWidth} mm).` });
      if (positive(feature.depth) && feature.depth > stockHeight + 0.01) issues.push({ level: "warning", message: `${label}: the depth ${feature.depth} mm is more than the stock height ${stockHeight} mm. It is cut as a through hole.` });
      if (!positive(feature.depth)) issues.push({ level: "info", message: `${label}: no depth was read. It is cut through the stock.` });
    } else if (kind === "pocket" || kind === "slot") {
      if (positive(feature.length) && feature.length > stockLength) issues.push({ level: "error", message: `${label}: the length ${feature.length} mm is longer than the stock (${stockLength} mm).` });
      if (positive(feature.width) && feature.width > stockWidth) issues.push({ level: "error", message: `${label}: the width ${feature.width} mm is wider than the stock (${stockWidth} mm).` });
      if (!positive(feature.width) || !positive(feature.length)) issues.push({ level: "warning", message: `${label}: the size was not fully read. A default fraction of the stock is used.` });
      if (positive(feature.depth) && feature.depth >= stockHeight) issues.push({ level: "warning", message: `${label}: a depth of ${feature.depth} mm cuts through the ${stockHeight} mm stock.` });
    } else if (kind === "thread") {
      if (!positive(feature.diameter)) issues.push({ level: "warning", message: `${label}: no thread size was read.` });
      if (!features.features.some((item) => item.type === "hole" || item.type === "bore")) issues.push({ level: "warning", message: `${label}: a thread needs a tap-drill hole, but no hole was read.` });
    }
    if (!Number.isFinite(feature.count) || feature.count < 1) issues.push({ level: "warning", message: `${label}: the count is missing, so 1 is used.` });
  });
  if (features.tolerances.length === 0) issues.push({ level: "info", message: "No tolerances were read. The inspection sheet uses the general tolerance." });
  issues.push(...reviewEvidence(features));
  return issues;
}

/** The checks for a bar that is turned round and bored. */
export function reviewTurning(job: TurningJob): ReadingIssue[] {
  const issues: ReadingIssue[] = [];
  const smallest = Math.min(job.stockWidth, job.stockHeight);
  if (!(job.diameter > 0)) issues.push({ level: "error", message: "The outside diameter is missing." });
  if (job.diameter >= smallest) issues.push({ level: "error", message: `The outside diameter ${job.diameter} mm must be smaller than the bar (${smallest} mm), or there is nothing to turn.` });
  if (job.bore < 0) issues.push({ level: "error", message: "The bore cannot be negative." });
  if (job.bore >= job.diameter) issues.push({ level: "error", message: `The bore ${job.bore} mm must be smaller than the outside diameter ${job.diameter} mm.` });
  if (job.length > job.stockLength) issues.push({ level: "error", message: `The finished length ${job.length} mm is longer than the bar (${job.stockLength} mm).` });
  if (job.length < 15) issues.push({ level: "warning", message: "The part is very short. The chuck grip leaves little to cut." });
  if (job.bore > 0 && job.bore < 3) issues.push({ level: "warning", message: "A bore under 3 mm is a small drill. Check the size on the drawing." });
  if (job.diameter > 0 && job.bore > 0 && (job.diameter - job.bore) / 2 < 2) issues.push({ level: "warning", message: "The wall is thinner than 2 mm. Expect chatter or distortion." });
  if (!job.material || /^UNKNOWN$/i.test(job.material)) issues.push({ level: "warning", message: "No material was found." });
  return issues;
}

export function reviewPlan(plan: StagePlan): ReadingIssue[] {
  return plan.family === "turning" ? reviewTurning(plan.job) : reviewFeatures(plan.features);
}

/** How well the numbers are backed by the sheet itself. Reads from a model file are exact and need no check. */
export function reviewEvidence(features: PartFeatures): ReadingIssue[] {
  if (features.extractionMethod === "step_parse" || features.extractionMethod === "manual") return [];
  const evidence = features.evidence;
  if (!evidence) return [];
  if (evidence.confirmed) return [{ level: "info", message: "You confirmed these values against the sheet." }];
  const issues: ReadingIssue[] = [];
  if (!evidence.sheetText) {
    issues.push({ level: "warning", message: "This sheet has no readable text, so the numbers come from the picture alone and could not be checked against it. Compare each one with the sheet and tick the confirmation." });
  }
  const { length, width, height } = features.rawDimensions;
  if (features.extractionMethod === "pdf_ocr" && !evidence.sheetText && length === 100 && width === 80 && height === 30) {
    issues.push({ level: "warning", message: "The stock size 100 x 80 x 30 mm is the default for a sheet with no size. It was not read from the drawing." });
  }
  for (const conflict of evidence.conflicts) issues.push({ level: "warning", message: conflict });
  const missing = ungrounded(features);
  if (missing.length) {
    const shown = missing.slice(0, 6).map((claim) => `${claim.label} ${claim.value}`).join(", ");
    issues.push({ level: "warning", message: `Not printed anywhere in the sheet text: ${shown}${missing.length > 6 ? `, and ${missing.length - 6} more` : ""}. The picture reader may have misread them.` });
  }
  if (evidence.sheetText && !issues.length && evidence.crossRead) {
    issues.push({ level: "info", message: "Every value is printed on the sheet, and two reads of the picture agree." });
  }
  return issues;
}

/** A line for the plan notes when the reading was not checked against the sheet. */
export function evidenceNote(features: PartFeatures): string | null {
  const open = reviewEvidence(features).filter((issue) => issue.level === "warning");
  return open.length ? `The drawing reading has ${open.length} point${open.length === 1 ? "" : "s"} not yet checked against the sheet. Confirm the values before cutting.` : null;
}
export function hasErrors(issues: ReadingIssue[]): boolean {
  return issues.some((issue) => issue.level === "error");
}
