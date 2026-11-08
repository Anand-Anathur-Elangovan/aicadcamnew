import { createLLMProvider } from "@/lib/providers/llm.provider";
import { parsePDF } from "@/lib/parsers/pdf.parser";
import { attachEvidence, compareReads } from "@/lib/cad/readingEvidence";
import {
  extractFeaturesFromText,
  isReadableDrawingText,
  type MachiningFeature,
  type PartFeatures,
} from "@/lib/cad/featureExtractor";

const FEATURE_TYPES = new Set<MachiningFeature["type"]>([
  "pocket", "hole", "slot", "boss", "thread", "chamfer", "fillet", "profile", "face", "bore", "counterbore", "countersink",
]);

const DRAWING_PROMPT = `Read this engineering drawing. Return only JSON with fields that are printed on the sheet:
{"partName":"","partNumber":"","revision":"","material":"","length":null,"width":null,"height":null,"diameter":null,"partType":"prismatic","features":[{"type":"hole","count":1,"diameter":null,"depth":null,"notes":""}]}
partType is prismatic, rotational, sheet, or complex. Feature type is one of pocket, hole, slot, boss, thread, chamfer, fillet, profile, face, bore, counterbore, countersink.
partNumber is the drawing or part number. revision is the REV field. Do not copy the revision into the part number.
Leave a string empty and a number null when the sheet does not state it. Do not invent holes, threads, or sizes.`;

function looksLikeSheetMark(value: string): boolean {
  return /\bA[0-4]\b/i.test(value) || /\b\d+\s*\/\s*\d+\b/.test(value) || /sheet|scale/i.test(value);
}

function numberOrNull(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function featuresFromDrawingJson(
  raw: string,
  filename: string,
  method: PartFeatures["extractionMethod"] = "ai_vision"
): PartFeatures | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }

  const features: MachiningFeature[] = [];
  if (Array.isArray(parsed.features)) {
    for (const item of parsed.features) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const type = String(row.type ?? "") as MachiningFeature["type"];
      if (!FEATURE_TYPES.has(type)) continue;
      const count = numberOrNull(row.count) ?? 1;
      features.push({
        type,
        count,
        diameter: numberOrNull(row.diameter) ?? undefined,
        depth: numberOrNull(row.depth) ?? undefined,
        notes: typeof row.notes === "string" && row.notes.trim() ? row.notes.trim() : undefined,
      });
    }
  }

  const length = numberOrNull(parsed.length) ?? 0;
  const width = numberOrNull(parsed.width) ?? 0;
  const height = numberOrNull(parsed.height) ?? 0;
  const diameter = numberOrNull(parsed.diameter);
  const partType = parsed.partType === "rotational" || parsed.partType === "sheet" || parsed.partType === "complex"
    ? parsed.partType
    : "prismatic";
  const partName = typeof parsed.partName === "string" ? parsed.partName.trim() : "";
  let partNumber = typeof parsed.partNumber === "string" ? parsed.partNumber.trim() : "";
  const revision = typeof parsed.revision === "string" ? parsed.revision.trim() : "";
  if (partNumber && (looksLikeSheetMark(partNumber) || (revision && partNumber.toUpperCase() === revision.toUpperCase()))) {
    partNumber = "";
  }
  const base = extractFeaturesFromText("", filename, {
    partName: partName || undefined,
    partNumber: partNumber || undefined,
    revision: revision || undefined,
    material: typeof parsed.material === "string" ? parsed.material.trim() : undefined,
  });

  return {
    ...base,
    rawDimensions: { length, width, height, diameter: diameter ?? undefined },
    stockDimensions: {
      length: length > 0 ? length + 3 : 0,
      width: width > 0 ? width + 3 : 0,
      height: height > 0 ? height + 3 : 0,
      diameter: diameter ?? undefined,
    },
    features,
    tolerances: [],
    surfaceFinishes: [],
    partType,
    estimatedComplexity: features.length > 8 ? "high" : features.length > 3 ? "medium" : "low",
    extractionMethod: method,
  };
}

const SEVERAL_SHEETS = "These pages are sheets of one part. Combine them. Do not invent features that are not shown.";

function imageMedia(mimeType: string): "image/png" | "image/gif" | "image/webp" | "image/jpeg" {
  if (mimeType === "image/png" || mimeType === "image/gif" || mimeType === "image/webp") return mimeType;
  return "image/jpeg";
}

async function readImageJson(images: { buffer: Buffer; mimeType: string }[], text = "", temperature?: number): Promise<string> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const content: Array<
    | { type: "image"; source: { type: "base64"; media_type: "image/png" | "image/gif" | "image/webp" | "image/jpeg"; data: string } }
    | { type: "text"; text: string }
  > = images.slice(0, 6).map((image) => ({
    type: "image",
    source: { type: "base64", media_type: imageMedia(image.mimeType), data: image.buffer.toString("base64") },
  }));
  content.push({ type: "text", text: text ? `${DRAWING_PROMPT}\n${SEVERAL_SHEETS}\n${text.slice(0, 8000)}` : `${DRAWING_PROMPT}\n${SEVERAL_SHEETS}` });
  const response = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
    max_tokens: 2500,
    ...(temperature !== undefined ? { temperature } : {}),
    messages: [{ role: "user", content }],
  });
  const block = response.content[0];
  return block?.type === "text" ? block.text : "";
}

function isCadModel(filename: string): boolean {
  const name = filename.toLowerCase();
  return name.endsWith(".stp") || name.endsWith(".step") || name.endsWith(".iges") || name.endsWith(".igs");
}

function isImage(filename: string, mimeType: string): boolean {
  return mimeType.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(filename);
}

export interface DrawingSource {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

export async function readDrawingPacket(sources: DrawingSource[]): Promise<PartFeatures | null> {
  if ((process.env.DEPLOYMENT_MODE ?? "CLOUD") === "ON_PREM") return null;
  const drawings = sources.filter((source) => !isCadModel(source.filename));
  if (!drawings.length) return null;

  const textParts: string[] = [];
  const images: { buffer: Buffer; mimeType: string }[] = [];
  for (const source of drawings) {
    if (isImage(source.filename, source.mimeType)) {
      images.push({ buffer: source.buffer, mimeType: source.mimeType || "image/jpeg" });
      continue;
    }
    if (source.mimeType === "application/pdf" || source.filename.toLowerCase().endsWith(".pdf")) {
      const parsed = await parsePDF(source.buffer);
      if (isReadableDrawingText(parsed.text) && parsed.text.trim().length >= 40) {
        textParts.push(`SHEET ${source.filename}\n${parsed.text.trim()}`);
      }
      for (const page of (parsed.renderedPages ?? []).slice(0, 4)) {
        images.push({ buffer: page.png, mimeType: "image/png" });
      }
    }
  }

  if (!textParts.length && !images.length) return null;

  let raw = "";
  let method: PartFeatures["extractionMethod"] = "pdf_ocr";
  if (images.length && !textParts.length) {
    method = "ai_vision";
    raw = await readImageJson(images);
  } else if (!images.length) {
    const llm = createLLMProvider();
    raw = await llm.chat({
      systemPrompt: `${DRAWING_PROMPT}\n${SEVERAL_SHEETS}`,
      messages: [{ role: "user", content: textParts.join("\n\n").slice(0, 24000) }],
    });
  } else {
    method = "ai_vision";
    raw = await readImageJson(images, textParts.join("\n\n"));
  }

  const names = drawings.map((source) => source.filename).join(", ");
  const read = featuresFromDrawingJson(raw, names, method);
  if (!read) return null;
  read.sourceFile = names;
  const sheetText = textParts.join("\n\n");
  const features = attachEvidence(read, sheetText);

  // A second, independent sample of the picture. What the two reads disagree on is uncertain.
  if (images.length && process.env.DRAWING_CROSSCHECK !== "off") {
    try {
      const again = featuresFromDrawingJson(await readImageJson(images, sheetText, 0.9), names, method);
      if (again && features.evidence) {
        features.evidence.crossRead = true;
        features.evidence.conflicts.push(...compareReads(features, again));
      }
    } catch (err) {
      console.error("[drawingRead] Second read failed:", err);
    }
  }
  return features;
}

export async function readDrawingFeatures(
  buffer: Buffer,
  mimeType: string,
  filename: string
): Promise<PartFeatures | null> {
  return readDrawingPacket([{ buffer, mimeType, filename }]);
}
