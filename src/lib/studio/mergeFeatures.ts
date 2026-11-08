import type { MachiningFeature, PartFeatures } from "@/lib/cad/featureExtractor";
import { mergeEvidence } from "@/lib/cad/readingEvidence";

function known(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text || text.toUpperCase() === "UNKNOWN") return undefined;
  return text;
}

function featureKey(feature: MachiningFeature): string {
  return [
    feature.type,
    feature.diameter ?? "",
    feature.depth ?? "",
    feature.width ?? "",
    feature.length ?? "",
    feature.along ?? "",
    feature.across ?? "",
  ].join("|");
}

function normalizeStep(features: PartFeatures): PartFeatures {
  if (features.extractionMethod !== "step_parse") return features;
  const kept = features.features.filter((feature) => feature.type !== "face" && feature.type !== "profile");
  const faces = features.features.find((feature) => feature.type === "face")?.count ?? 0;
  return {
    ...features,
    features: [
      { type: "face", count: 1 },
      { type: "profile", count: 1, notes: faces > 1 ? `${faces} faces in the model` : undefined },
      ...kept,
    ],
  };
}

export function mergePartFeatures(parts: PartFeatures[]): PartFeatures {
  const rows = parts.map(normalizeStep);
  const first = rows[0];
  const features: MachiningFeature[] = [];
  const seen = new Map<string, MachiningFeature>();
  for (const part of rows) {
    for (const feature of part.features) {
      const key = featureKey(feature);
      const existing = seen.get(key);
      if (existing) {
        existing.count = Math.max(existing.count, feature.count);
        continue;
      }
      const copy = { ...feature };
      seen.set(key, copy);
      features.push(copy);
    }
  }

  const length = Math.max(0, ...rows.map((part) => part.rawDimensions.length || 0));
  const width = Math.max(0, ...rows.map((part) => part.rawDimensions.width || 0));
  const height = Math.max(0, ...rows.map((part) => part.rawDimensions.height || 0));
  const diameter = Math.max(0, ...rows.map((part) => part.rawDimensions.diameter || 0));
  const types = new Set(rows.map((part) => part.partType));
  const partType = types.has("complex") || types.size > 1
    ? "complex"
    : first.partType;
  const complexity = features.length > 8 || rows.some((part) => part.estimatedComplexity === "high")
    ? "high"
    : features.length > 3 || rows.some((part) => part.estimatedComplexity === "medium")
      ? "medium"
      : "low";

  return {
    partName: rows.map((part) => known(part.partName)).find(Boolean) ?? first.partName,
    partNumber: rows.map((part) => known(part.partNumber)).find(Boolean) ?? "UNKNOWN",
    revision: rows.map((part) => known(part.revision)).find(Boolean) ?? first.revision,
    material: rows.map((part) => known(part.material)).find(Boolean) ?? "UNKNOWN",
    rawDimensions: { length, width, height, diameter: diameter || undefined },
    stockDimensions: {
      length: length > 0 ? length + 3 : 0,
      width: width > 0 ? width + 3 : 0,
      height: height > 0 ? height + 3 : 0,
      diameter: diameter > 0 ? diameter + 3 : undefined,
    },
    features,
    tolerances: rows.flatMap((part) => part.tolerances),
    surfaceFinishes: rows.flatMap((part) => part.surfaceFinishes),
    partType,
    estimatedComplexity: complexity,
    sourceFile: rows.map((part) => part.sourceFile).filter(Boolean).join(", "),
    extractedAt: new Date().toISOString(),
    extractionMethod: rows.some((part) => part.extractionMethod === "ai_vision") ? "ai_vision" : first.extractionMethod,
    evidence: mergeEvidence(rows.map((part) => part.evidence)),
  };
}
