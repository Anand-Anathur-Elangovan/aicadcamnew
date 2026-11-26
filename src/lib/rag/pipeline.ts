import type { RetrievedChunk, Citation, Document } from "../types";
import { createEmbeddingProvider, createLLMProvider, createRerankProvider, createVectorProvider } from "../providers";
import type { DocumentCategory } from "../utils";

const MAX_RETRIEVED = parseInt(process.env.MAX_RETRIEVED_CHUNKS  ?? "20");
const RERANK_TOP_K  = parseInt(process.env.RERANK_TOP_K          ?? "7");
const MMR_LAMBDA    = parseFloat(process.env.MMR_LAMBDA          ?? "0.6");  // 0 = max diversity, 1 = max relevance
const EXPAND_QUERY  = (process.env.QUERY_EXPANSION ?? "true") !== "false";   // disable with env var

// ─────────────────────────────────────────────────────────────────────────────
// 1.  Query Expansion
//     Rewrites the question into N diverse variants so the retrieval step
//     has a wider net. Falls back silently to the original query if the LLM
//     call fails (keeps latency impact optional).
// ─────────────────────────────────────────────────────────────────────────────

async function expandQuery(query: string): Promise<string[]> {
  if (!EXPAND_QUERY) return [query];
  try {
    const llm = createLLMProvider();
    const raw = await llm.chat({
      systemPrompt:
        "You are a search query expert for a manufacturing document database. " +
        "Given a user question, generate exactly 3 diverse search queries that cover " +
        "different phrasings, synonyms, and sub-aspects of the question. " +
        "Return ONLY the 3 queries, one per line, no numbering, no explanations.",
      messages: [{ role: "user", content: query }],
    });
    const expanded = raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 3);
    // Always include the original
    const all = [...new Set([query, ...expanded])];
    return all.slice(0, 4);
  } catch {
    return [query];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2.  MMR — Maximal Marginal Relevance
//     Picks RERANK_TOP_K chunks from the reranked list that are collectively
//     diverse (no two chunks from the same document page unless necessary).
//     λ = 1 → pure relevance, λ = 0 → pure diversity.
// ─────────────────────────────────────────────────────────────────────────────

function applyMMR(
  reranked: (RetrievedChunk & { rerankScore: number })[],
  topK: number,
  lambda: number,
): (RetrievedChunk & { rerankScore: number })[] {
  if (reranked.length === 0) return [];
  const selected: typeof reranked = [];
  const remaining = [...reranked];

  while (selected.length < topK && remaining.length > 0) {
    let bestIdx  = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const rel = remaining[i].rerankScore;

      // Similarity to already-selected chunks: use document+page as a proxy
      // (1 = exact page match, 0 = different document)
      const maxSim = selected.length === 0
        ? 0
        : Math.max(...selected.map((s) => {
            if (s.documentId === remaining[i].documentId && s.pageNumber === remaining[i].pageNumber) return 1;
            if (s.documentId === remaining[i].documentId) return 0.5;
            return 0;
          }));

      const mmrScore = lambda * rel - (1 - lambda) * maxSim;
      if (mmrScore > bestScore) { bestScore = mmrScore; bestIdx = i; }
    }

    selected.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }

  return selected;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main pipeline
// ─────────────────────────────────────────────────────────────────────────────

export interface RAGPipelineOptions {
  filterCategory?:   DocumentCategory;
  filterPartNumber?: string;
  /** Override how many reranked + MMR chunks to return (default: RERANK_TOP_K) */
  topK?: number;
}

/**
 * 5-Step Enhanced RAG Pipeline:
 * 1. Query expansion (LLM rewrites → multiple query variants)
 * 2. Parallel hybrid search per variant (BM25 + dense vector → RRF in DB)
 * 3. Result merge & deduplication across variants
 * 4. Reranking (Voyage or local BGE-Reranker)
 * 5. MMR-based diversity selection
 */
function isVoyageRateLimit(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /rate limit|reduced rate limits|payment method|3 RPM|10K TPM/i.test(msg);
}

export async function runRAGPipeline(
  query: string,
  options: RAGPipelineOptions = {},
): Promise<{
  chunks: RetrievedChunk[];
  citations: Citation[];
  contextText: string;
  topScore: number;
  expandedQueries: string[];
  degraded?: "bm25_only" | "bm25_no_rerank";   // set when falling back
}> {
  const embeddingProvider = createEmbeddingProvider();
  const rerankProvider    = createRerankProvider();
  const vectorProvider    = createVectorProvider();

  // Step 1: Expand the query (best-effort; falls back silently)
  const queries = await expandQuery(query);

  // ── Step 2: Hybrid search (BM25 + dense vector) ──────────────────────────
  // Tier 1: embed each query variant + hybrid_search RPC
  // Tier 2: if any embedding call fails → BM25-only for all queries
  let rawChunks: RetrievedChunk[] = [];
  let degraded: "bm25_only" | "bm25_no_rerank" | undefined;

  try {
    const perQueryChunks = await Promise.all(
      queries.map(async (q) => {
        const embedding = await embeddingProvider.embed(q);
        return vectorProvider.hybridSearch({
          queryEmbedding:    embedding,
          queryText:         q,
          limit:             MAX_RETRIEVED,
          filterCategory:    options.filterCategory,
          filterPartNumber:  options.filterPartNumber,
        });
      }),
    );
    const chunkMap = new Map<string, RetrievedChunk>();
    for (const batch of perQueryChunks) {
      for (const chunk of batch) {
        const existing = chunkMap.get(chunk.chunkId);
        if (!existing || (chunk.rrfScore ?? 0) > (existing.rrfScore ?? 0)) {
          chunkMap.set(chunk.chunkId, chunk);
        }
      }
    }
    rawChunks = [...chunkMap.values()].sort((a, b) => (b.rrfScore ?? 0) - (a.rrfScore ?? 0));
  } catch (embedErr) {
    // ── Tier 2: Voyage embedding unavailable → BM25-only ──────────────────
    console.warn("[RAG] Embedding failed, falling back to BM25-only search:", embedErr);
    degraded = "bm25_only";
    try {
      const bm25Results = await vectorProvider.bm25Search({
        queryText:        query,
        limit:            MAX_RETRIEVED,
        filterCategory:   options.filterCategory,
        filterPartNumber: options.filterPartNumber,
      });
      rawChunks = bm25Results;
    } catch (bm25Err) {
      console.warn("[RAG] BM25 search also failed:", bm25Err);
      return { chunks: [], citations: [], contextText: "", topScore: 0, expandedQueries: queries, degraded };
    }
  }

  if (rawChunks.length === 0) {
    return { chunks: [], citations: [], contextText: "", topScore: 0, expandedQueries: queries, degraded };
  }

  // ── Step 3 (merge already done above in Tier 1) ───────────────────────────

  // ── Step 4: Rerank ────────────────────────────────────────────────────────
  // Tier 2 (already on BM25): try rerank; if Voyage still rate-limited, skip it
  // Tier 3: skip rerank entirely, use RRF score as relevance proxy
  let afterRerank: (RetrievedChunk & { rerankScore: number })[] = [];

  try {
    const rerankScores = await rerankProvider.rerank(
      query,
      rawChunks.map((c) => c.content),
    );
    afterRerank = rerankScores
      .sort((a, b) => b.score - a.score)
      .slice(0, (options.topK ?? RERANK_TOP_K) * 2)
      .map(({ index, score }) => ({ ...rawChunks[index], rerankScore: score }));
  } catch (rerankErr) {
    // ── Tier 3: no rerank — use RRF score directly ─────────────────────────
    console.warn("[RAG] Rerank failed, using RRF score order:", rerankErr);
    degraded = "bm25_no_rerank";
    afterRerank = rawChunks
      .slice(0, (options.topK ?? RERANK_TOP_K) * 2)
      .map((chunk) => ({ ...chunk, rerankScore: chunk.rrfScore ?? 0.5 }));
  }

  // ── Step 5: MMR diversity selection ──────────────────────────────────────
  const reranked = applyMMR(afterRerank, options.topK ?? RERANK_TOP_K, MMR_LAMBDA);

  // Build citations
  const documentIds = [...new Set(reranked.map((c) => c.documentId))];
  const documents   = await Promise.all(documentIds.map((id) => vectorProvider.getDocument(id)));
  const docMap      = new Map<string, Document>(
    documents.filter((d): d is Document => d !== null).map((d) => [d.id, d]),
  );

  const citations: Citation[] = reranked.map((chunk, i) => {
    const doc = docMap.get(chunk.documentId);
    return {
      index:        i + 1,
      chunkId:      chunk.chunkId,
      documentId:   chunk.documentId,
      documentName: doc?.docTitle ?? doc?.originalName ?? doc?.filename ?? "Unknown",
      category:     doc?.category ?? "GENERAL",
      pageNumber:   chunk.pageNumber,
      partNumber:   doc?.partNumber ?? doc?.autoExtracted?.partNumber,
      revision:     doc?.revision   ?? doc?.autoExtracted?.revision,
      snippet:      chunk.content.slice(0, 300) + (chunk.content.length > 300 ? "…" : ""),
      downloadUrl:  `/api/files/download/${chunk.documentId}`,
      viewUrl:      `/api/files/view/${chunk.documentId}?page=${chunk.pageNumber ?? 1}`,
    };
  });

  const contextText = reranked
    .map((chunk, i) =>
      `[${i + 1}] (Page ${chunk.pageNumber ?? "N/A"}, Doc: ${docMap.get(chunk.documentId)?.originalName ?? chunk.documentId})\n${chunk.content}`,
    )
    .join("\n\n---\n\n");

  const topScore = reranked[0]?.rerankScore ?? 0;
  return { chunks: reranked, citations, contextText, topScore, expandedQueries: queries, degraded };
}

export function buildSystemPrompt(contextText: string): string {
  return `You are an expert Manufacturing AI Assistant for an enterprise factory.
You have access to indexed manufacturing documents including 2D drawings, inspection reports, purchase orders, inventory logs, and tool catalogs.

Use ONLY the context provided below to answer questions. Cite sources using [1], [2], [3] notation corresponding to the numbered excerpts.
If the answer is not in the context, explicitly state: "This information is not available in the indexed documents."
Do not make up part numbers, tolerances, specifications, or any manufacturing data.

Be precise, technical, and concise. Format tables in markdown when presenting structured data.

--- CONTEXT ---
${contextText}
--- END CONTEXT ---`;
}
