import { NextRequest } from "next/server";
import { ingestFile } from "@/lib/rag/ingest";
import { createVectorProvider } from "@/lib/providers/vector.provider";
import { createStorageProvider } from "@/lib/providers/storage.provider";
import type { DocumentCategory } from "@/lib/utils";
import { DOCUMENT_CATEGORIES } from "@/lib/utils";
import type { DocumentMetaFields } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/ingest — Upload, parse, and index a document
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const file = formData.get("file") as File | null;
    const category = (formData.get("category") as DocumentCategory) ?? "GENERAL";

    if (!file) return Response.json({ error: "No file provided" }, { status: 400 });
    if (!DOCUMENT_CATEGORIES.includes(category)) {
      return Response.json({ error: `Invalid category: ${category}` }, { status: 400 });
    }

    // Parse optional structured metadata fields from form
    const metaFields: DocumentMetaFields = {
      docTitle:      getString(formData, "docTitle"),
      description:   getString(formData, "description"),
      partName:      getString(formData, "partName"),
      partNumber:    getString(formData, "partNumber"),
      revision:      getString(formData, "revision"),
      developedDate: getString(formData, "developedDate"),
      customerName:  getString(formData, "customerName"),
      issueDetails:  getString(formData, "issueDetails"),
    };

    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (step: string, progress: number, extra?: object) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ step, progress, ...extra })}\n\n`));
        };

        try {
          let documentId = "";
          await ingestFile({
            buffer,
            filename,
            originalName: file.name,
            mimeType: file.type || "application/octet-stream",
            category,
            metaFields,
            onProgress: (step, progress) => send(step, progress),
          }).then((r) => { documentId = r.documentId; });

          send("Complete", 100, { documentId });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Ingestion failed";
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ step: "Error", progress: 0, error: message })}\n\n`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (err) {
    console.error("[/api/ingest] Error:", err);
    return Response.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

// GET /api/ingest — List documents with optional filters
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const category    = searchParams.get("category") as DocumentCategory | null;
    const status      = searchParams.get("status") as "pending" | "processing" | "indexed" | "error" | null;
    const vector      = createVectorProvider();
    const documents   = await vector.listDocuments({
      ...(category ? { category } : {}),
      ...(status   ? { status }   : {}),
    });
    return Response.json({ documents });
  } catch (err) {
    console.error("[/api/ingest GET] Error:", err);
    return Response.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

// DELETE /api/ingest — Remove selected documents from storage and the search index
export async function DELETE(req: NextRequest) {
  try {
    const body = (await req.json()) as { ids?: unknown };
    const ids = [...new Set(
      Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string" && id.length > 0) : []
    )];

    if (!ids.length) return Response.json({ error: "ids required" }, { status: 400 });
    if (ids.length > 100) return Response.json({ error: "Select 100 documents or fewer" }, { status: 400 });

    const vector = createVectorProvider();
    const storage = createStorageProvider();
    const deleted: string[] = [];
    const failed: { id: string; error: string }[] = [];

    for (const id of ids) {
      try {
        const doc = await vector.getDocument(id);
        if (!doc) {
          failed.push({ id, error: "Not found" });
          continue;
        }

        try {
          await storage.delete(doc.storageBucket, doc.storagePath);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Storage delete failed";
          if (!/not found|nosuchkey|404/i.test(message)) {
            throw new Error(message);
          }
        }

        await vector.deleteDocument(id);
        deleted.push(id);
      } catch (err) {
        failed.push({ id, error: err instanceof Error ? err.message : "Delete failed" });
      }
    }

    return Response.json({ deleted, failed });
  } catch (err) {
    console.error("[/api/ingest DELETE] Error:", err);
    return Response.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

function getString(fd: FormData, key: string): string | undefined {
  const val = fd.get(key);
  return typeof val === "string" && val.trim() ? val.trim() : undefined;
}
