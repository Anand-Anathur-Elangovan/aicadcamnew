import type { Citation } from "@/lib/types";

const SEPARATOR = "\n\n---\n\n";

/** One source per document page. The same chunk or page is never listed twice, and numbers run 1, 2, 3 with no gaps. */
export function dedupeCitations(citations: Citation[]): Citation[] {
  const seen = new Map<string, Citation>();
  for (const citation of citations) {
    const key = `${citation.documentId}:${citation.pageNumber ?? 0}:${citation.sheetName ?? ""}`;
    if (!seen.has(key)) seen.set(key, citation);
  }
  return [...seen.values()].map((citation, index) => ({ ...citation, index: index + 1 }));
}

function sourceKey(citation: Citation): string {
  return `${citation.documentId}:${citation.pageNumber ?? 0}:${citation.sheetName ?? ""}`;
}

export interface DocumentEvidence {
  citations: Citation[];
  contextText: string;
}

/**
 * Two document questions each number their excerpts from [1]. Merged as they are, the numbers collide and the same page is shown twice.
 * This gives every distinct page one number across the whole answer and rewrites each excerpt to use it.
 */
export function mergeDocumentEvidence(results: DocumentEvidence[]): { citations: Citation[]; contexts: string[] } {
  const merged: Citation[] = [];
  const indexByKey = new Map<string, number>();
  const seenChunks = new Set<string>();
  const contexts = results.map((result) => {
    if (!result.contextText.trim()) return "";
    const kept: string[] = [];
    for (const segment of result.contextText.split(SEPARATOR)) {
      const label = /^\[(\d+)\]/.exec(segment);
      if (!label) {
        kept.push(segment);
        continue;
      }
      const original = Number(label[1]);
      const citation = result.citations.find((item) => item.index === original) ?? result.citations[original - 1];
      if (!citation) {
        kept.push(segment);
        continue;
      }
      const chunk = citation.chunkId;
      if (chunk && seenChunks.has(chunk)) continue;
      if (chunk) seenChunks.add(chunk);
      const key = sourceKey(citation);
      let index = indexByKey.get(key);
      if (index === undefined) {
        index = merged.length + 1;
        indexByKey.set(key, index);
        merged.push({ ...citation, index });
      }
      kept.push(segment.replace(/^\[\d+\]/, `[${index}]`));
    }
    return kept.join(SEPARATOR);
  });
  return { citations: merged, contexts };
}
