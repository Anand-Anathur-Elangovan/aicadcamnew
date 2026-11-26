/**
 * GET /api/search/features?q=...&category=...&limit=20
 *
 * Part feature search: finds documents that mention specific machining features,
 * tolerances (Ø32H7), threads (M12×1.75), materials, or part numbers.
 *
 * Uses the same BM25 + dense vector + RRF pipeline as the chat RAG, but
 * returns raw document/chunk hits instead of a composed answer.
 */
import { runRAGPipeline } from "@/lib/rag/pipeline";
import type { DocumentCategory } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q        = (searchParams.get("q") ?? "").trim();
  const category = searchParams.get("category") as DocumentCategory | null;
  const limitRaw = parseInt(searchParams.get("limit") ?? "12");
  const limit    = Math.min(Math.max(limitRaw, 1), 30);

  if (!q) {
    return Response.json({ error: "Missing query parameter `q`" }, { status: 400 });
  }

  try {
    const result = await runRAGPipeline(q, {
      topK: limit,
      filterCategory: category ?? undefined,
    });

    // Group by documentId using citations (which already have resolved names/meta)
    const byDoc = new Map<string, {
      documentId: string;
      documentName: string;
      category: string;
      partNumber?: string;
      revision?: string;
      relevanceScore: number;
      snippets: string[];
      pages: number[];
      downloadUrl: string;
      viewUrl: string;
    }>();

    // Zip citations with raw chunks to get snippet text
    for (let i = 0; i < result.citations.length; i++) {
      const cit   = result.citations[i];
      const chunk = result.chunks[i];
      const snippet = chunk?.content.slice(0, 220) ?? cit.snippet.slice(0, 220);
      const existing = byDoc.get(cit.documentId);
      if (existing) {
        existing.snippets.push(snippet);
        if (cit.pageNumber) existing.pages.push(cit.pageNumber);
        existing.relevanceScore = Math.max(existing.relevanceScore, (i === 0 ? 1 : 1 / (i + 1)));
      } else {
        byDoc.set(cit.documentId, {
          documentId:     cit.documentId,
          documentName:   cit.documentName,
          category:       cit.category,
          partNumber:     cit.partNumber,
          revision:       cit.revision,
          relevanceScore: 1 / (i + 1),
          snippets:       [snippet],
          pages:          cit.pageNumber ? [cit.pageNumber] : [],
          downloadUrl:    cit.downloadUrl,
          viewUrl:        cit.viewUrl,
        });
      }
    }

    const documents = [...byDoc.values()]
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, limit);

    return Response.json({
      query: q,
      expandedQueries: result.expandedQueries,
      totalChunks: result.chunks.length,
      documents,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed";
    console.error("[/api/search/features]", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
