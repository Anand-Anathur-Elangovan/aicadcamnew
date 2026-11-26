"use client";

/**
 * /search — Part Feature Search
 *
 * Find documents that mention specific machining features, tolerances,
 * threads, materials, or part numbers across the full document library.
 *
 * Example queries:
 *   "Ø32H7 bore"      "M12×1.75 thread"   "6061-T6 material"
 *   "BRK-ASY-001"     "sealing face Ra 1.6"  "250 bar rated"
 */
import { useState, useCallback } from "react";
import Link from "next/link";
import { Search, FileText, ChevronDown, ChevronUp, Download, ExternalLink, Loader2, ArrowLeft, Sparkles } from "lucide-react";
import { CATEGORY_LABELS, CATEGORY_COLORS } from "@/lib/utils";
import type { DocumentCategory } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

/* ── Types ────────────────────────────────────────────────────────────── */
interface DocResult {
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
}
interface SearchResult {
  query: string;
  expandedQueries: string[];
  totalChunks: number;
  documents: DocResult[];
}

/* ── Quick-pick example queries ──────────────────────────────────────── */
const EXAMPLES = [
  "Ø28H7 bore tolerance",
  "M12×1.75 bolt pattern",
  "Aluminum 6061-T6 material",
  "sealing face Ra 1.6",
  "AS9100 inspection",
  "350 bar rated",
  "BRK-ASY-001",
  "first article inspection",
];

const CATEGORIES: { value: DocumentCategory | ""; label: string }[] = [
  { value: "", label: "All categories" },
  { value: "DRAWING_2D", label: "2D Drawing" },
  { value: "INSPECTION_FIR", label: "Inspection / FIR" },
  { value: "TOOLING_MATERIAL", label: "Tooling / Material" },
  { value: "FINANCIAL_PO_INVOICE", label: "PO / Invoice" },
  { value: "STORES_FG", label: "Stores / FG" },
  { value: "GENERAL", label: "General" },
];

/* ── Page ─────────────────────────────────────────────────────────────── */
export default function PartFeatureSearch() {
  const [query, setQuery]           = useState("");
  const [category, setCategory]     = useState<DocumentCategory | "">("");
  const [loading, setLoading]       = useState(false);
  const [result, setResult]         = useState<SearchResult | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const runSearch = useCallback(async (q: string, cat: DocumentCategory | "") => {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const params = new URLSearchParams({ q: q.trim(), limit: "12" });
      if (cat) params.set("category", cat);
      const res = await fetch(`/api/search/features?${params.toString()}`);
      const data = (await res.json()) as SearchResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void runSearch(query, category);
  };

  const toggleExpand = (id: string) =>
    setExpandedId((prev) => (prev === id ? null : id));

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <Link href="/" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Part Feature Search</h1>
            <p className="text-xs text-gray-500">
              Find drawings and documents by tolerance, thread, material, or part number
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">

        {/* Search form */}
        <form onSubmit={submit} className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4">
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder='e.g. "Ø32H7 bore" or "M12 thread" or "BRK-ASY-001"'
                className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as DocumentCategory | "")}
              className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Search
            </button>
          </div>

          {/* Examples */}
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => { setQuery(ex); void runSearch(ex, category); }}
                className="text-xs px-2.5 py-1 rounded-full bg-gray-100 hover:bg-blue-100 hover:text-blue-700 text-gray-600 transition-colors"
              >
                {ex}
              </button>
            ))}
          </div>
        </form>

        {/* Error */}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-4">
            {/* Summary bar */}
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-600">
                Found <span className="font-semibold text-gray-900">{result.documents.length}</span> documents
                from <span className="font-semibold">{result.totalChunks}</span> matching passages
              </p>
              {result.expandedQueries.length > 1 && (
                <div className="flex items-center gap-1.5 text-xs text-purple-700">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>AI expanded query to {result.expandedQueries.length} variants</span>
                </div>
              )}
            </div>

            {result.documents.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                <Search className="h-10 w-10 mx-auto mb-3 text-gray-300" />
                <p className="font-medium">No matching documents found</p>
                <p className="text-xs mt-1">Try different terms or upload more documents</p>
              </div>
            )}

            {result.documents.map((doc) => (
              <div key={doc.documentId} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                {/* Card header */}
                <button
                  type="button"
                  onClick={() => toggleExpand(doc.documentId)}
                  className="w-full flex items-start gap-4 px-5 py-4 text-left hover:bg-gray-50 transition-colors"
                >
                  <div className="mt-0.5 h-9 w-9 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                    <FileText className="h-5 w-5 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm truncate">{doc.documentName}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <Badge className={CATEGORY_COLORS[doc.category as DocumentCategory] ?? "bg-gray-100 text-gray-700"}>
                        {CATEGORY_LABELS[doc.category as DocumentCategory] ?? doc.category}
                      </Badge>
                      {doc.partNumber && (
                        <span className="text-xs text-gray-500">P/N {doc.partNumber}</span>
                      )}
                      {doc.revision && (
                        <span className="text-xs text-gray-500">Rev {doc.revision}</span>
                      )}
                      {doc.pages.length > 0 && (
                        <span className="text-xs text-gray-400">
                          p.{[...new Set(doc.pages)].sort((a, b) => a - b).slice(0, 4).join(", ")}
                        </span>
                      )}
                    </div>
                    {/* First snippet preview */}
                    <p className="text-xs text-gray-500 mt-1.5 line-clamp-2 leading-relaxed">
                      {doc.snippets[0]}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    {/* Relevance pill */}
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
                      {Math.round(doc.relevanceScore * 100)}%
                    </span>
                    {expandedId === doc.documentId
                      ? <ChevronUp className="h-4 w-4 text-gray-400" />
                      : <ChevronDown className="h-4 w-4 text-gray-400" />
                    }
                  </div>
                </button>

                {/* Expanded snippets + actions */}
                {expandedId === doc.documentId && (
                  <div className="border-t border-gray-100 px-5 pb-5 pt-4 space-y-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                      Matching passages ({doc.snippets.length})
                    </p>
                    <div className="space-y-2">
                      {doc.snippets.map((s, i) => (
                        <blockquote key={i} className="text-sm text-gray-700 italic border-l-4 border-amber-400 pl-3 leading-relaxed bg-amber-50 py-1 rounded-r">
                          &ldquo;{s}&rdquo;
                        </blockquote>
                      ))}
                    </div>

                    <div className="flex gap-2 pt-1">
                      <a
                        href={doc.downloadUrl}
                        download
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 transition-colors"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download
                      </a>
                      <a
                        href={doc.viewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-xs font-medium hover:bg-gray-50 transition-colors"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Open
                      </a>
                      <Link
                        href={`/chat?q=Tell me about ${encodeURIComponent(doc.documentName)}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-xs font-medium hover:bg-gray-50 transition-colors"
                      >
                        Ask AI about this
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {!result && !loading && !error && (
          <div className="text-center py-16 text-gray-400">
            <Search className="h-12 w-12 mx-auto mb-4 text-gray-200" />
            <p className="font-medium text-gray-500">Search for any part feature</p>
            <p className="text-sm mt-1">
              Try tolerances like <span className="font-mono bg-gray-100 px-1 rounded">Ø32H7</span>,
              threads like <span className="font-mono bg-gray-100 px-1 rounded">M12×1.75</span>,
              materials like <span className="font-mono bg-gray-100 px-1 rounded">6061-T6</span>, or part numbers
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
