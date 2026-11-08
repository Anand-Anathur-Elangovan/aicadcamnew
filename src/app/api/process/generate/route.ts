// POST /api/process/generate
// Accepts one drawing or several sheets of the same part.
// A recognized turning job, or the features read from the sheets, becomes a stage plan.

import { NextRequest } from "next/server";
import { extractFeatures } from "@/lib/cad/featureExtractor";
import { readDrawingPacket, type DrawingSource } from "@/lib/cad/drawingRead";
import { attachEvidence } from "@/lib/cad/readingEvidence";
import type { PartFeatures } from "@/lib/cad/featureExtractor";
import { parsePDF } from "@/lib/parsers/pdf.parser";
import { planFromReadings } from "@/lib/studio/featureStages";
import { readTurningJob } from "@/lib/studio/stages";

export const runtime = "nodejs";
export const maxDuration = 120;

function isCad(filename: string): boolean {
  const name = filename.toLowerCase();
  return name.endsWith(".stp") || name.endsWith(".step") || name.endsWith(".igs") || name.endsWith(".iges");
}

function isPdf(filename: string, mimeType: string): boolean {
  return mimeType === "application/pdf" || filename.toLowerCase().endsWith(".pdf");
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const featuresJson = formData.get("features") as string | null;
    if (featuresJson) {
      const features = JSON.parse(featuresJson) as PartFeatures;
      const stagePlan = planFromReadings([], [features]);
      return Response.json({ plan: stagePlan.plan, features: stagePlan.features, stagePlan });
    }

    const files = formData.getAll("file").filter((item): item is File => item instanceof File);
    if (!files.length) {
      return Response.json({ error: "Provide either 'features' JSON or a 'file'" }, { status: 400 });
    }

    const sources: DrawingSource[] = await Promise.all(files.map(async (file) => ({
      buffer: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type,
      filename: file.name,
    })));

    const texts: string[] = [];
    const textOf = new Map<string, string>();
    for (const source of sources) {
      if (!isPdf(source.filename, source.mimeType)) continue;
      const parsed = await parsePDF(source.buffer);
      texts.push(parsed.text);
      textOf.set(source.filename, parsed.text);
    }

    const extracted: PartFeatures[] = [];
    if (!readTurningJob(texts.join("\n"))) {
      const drawings = sources.filter((source) => !isCad(source.filename));
      const models = sources.filter((source) => isCad(source.filename));
      for (const source of drawings) {
        try {
          const drawing = await readDrawingPacket([source]);
          extracted.push(drawing ?? attachEvidence(extractFeatures(source.buffer, source.mimeType, source.filename), textOf.get(source.filename) ?? ""));
        } catch (err) {
          console.error("[/api/process/generate] Drawing read failed:", err);
          extracted.push(attachEvidence(extractFeatures(source.buffer, source.mimeType, source.filename), textOf.get(source.filename) ?? ""));
        }
      }
      for (const source of models) {
        extracted.push(extractFeatures(source.buffer, source.mimeType, source.filename));
      }
    }

    const stagePlan = planFromReadings(texts, extracted);
    return Response.json({ plan: stagePlan.plan, features: stagePlan.features, stagePlan });
  } catch (err) {
    console.error("[/api/process/generate] Error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Generation failed" },
      { status: 500 }
    );
  }
}
