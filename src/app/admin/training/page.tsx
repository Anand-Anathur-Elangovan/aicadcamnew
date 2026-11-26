"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle, XCircle, Download, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";

interface FeedbackRow {
  id: string;
  createdAt: string;
  question: string;
  answer: string;
  correction: string | null;
  correctionNote: string | null;
  rating: 1 | -1 | null;
  status: "pending" | "approved" | "rejected" | "exported";
  reviewedBy: string | null;
}

const STATUS_OPTIONS = ["all", "pending", "approved", "rejected", "exported"] as const;
const RATING_OPTIONS = [
  { label: "All", value: 0 },
  { label: "👍 Positive", value: 1 },
  { label: "👎 Negative", value: -1 },
];

export default function TrainingPage() {
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("pending");
  const [rating, setRating] = useState(0);
  const [offset, setOffset] = useState(0);
  const LIMIT = 20;

  const [expanded, setExpanded] = useState<string | null>(null);
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [reviewer, setReviewer] = useState("admin");
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        status,
        limit: String(LIMIT),
        offset: String(offset),
        ...(rating !== 0 ? { rating: String(rating) } : {}),
      });
      const res = await fetch(`/api/admin/feedback?${qs}`);
      if (!res.ok) throw new Error("Failed to load");
      const data = (await res.json()) as { rows: FeedbackRow[]; total: number };
      setRows(data.rows);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [status, rating, offset]);

  useEffect(() => { void load(); }, [load]);

  const review = async (id: string, verdict: "approved" | "rejected") => {
    setSaving(id);
    try {
      await fetch(`/api/admin/feedback/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: verdict,
          correction: corrections[id] ?? undefined,
          correctionNote: notes[id] ?? undefined,
          reviewedBy: reviewer,
        }),
      });
      void load();
    } finally {
      setSaving(null);
    }
  };

  const exportData = (format: "jsonl" | "csv") => {
    window.location.href = `/api/admin/feedback/export?format=${format}`;
  };

  const pages = Math.ceil(total / LIMIT);
  const page = Math.floor(offset / LIMIT) + 1;

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/" className="text-xs text-gray-500 hover:text-gray-900">Home</Link>
          <span className="text-gray-300">/</span>
          <Link href="/admin/ingestion" className="text-xs text-gray-500 hover:text-gray-900">Admin</Link>
          <span className="text-gray-300">/</span>
          <h1 className="text-sm font-semibold text-gray-900">Training &amp; Self-Correction</h1>
          <div className="flex-1" />
          <Link href="/admin/ingestion" className="text-xs text-gray-500 hover:text-gray-900">Ingestion</Link>
          <Link href="/admin/system" className="text-xs text-gray-500 hover:text-gray-900 ml-3">System</Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Summary banner */}
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
          Thumbs-up and thumbs-down ratings from Ask AI are captured here. SME reviewers can approve, reject,
          and correct answers. Approved rows can be exported as JSONL (OpenAI fine-tune format) or CSV
          for model fine-tuning or QA analysis.
        </div>

        {/* Filters row */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600">Status</label>
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); setOffset(0); }}
              className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600">Rating</label>
            <select
              value={rating}
              onChange={(e) => { setRating(parseInt(e.target.value)); setOffset(0); }}
              className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
            >
              {RATING_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600">Reviewer name</label>
            <input
              value={reviewer}
              onChange={(e) => setReviewer(e.target.value)}
              className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm w-32"
            />
          </div>

          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-gray-300 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>

          <button
            type="button"
            onClick={() => exportData("jsonl")}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-gray-900 text-white text-xs hover:bg-gray-700"
          >
            <Download className="h-3.5 w-3.5" /> Export JSONL
          </button>
          <button
            type="button"
            onClick={() => exportData("csv")}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-gray-300 text-xs text-gray-700 hover:bg-gray-50"
          >
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
        </div>

        {/* Count */}
        <p className="text-xs text-gray-500">{total} items matching filter</p>

        {/* Table */}
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left w-8">#</th>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Rating</th>
                <th className="px-3 py-2 text-left">Question</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Reviewed by</th>
                <th className="px-3 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-gray-400">
                    {loading ? "Loading…" : "No items match this filter."}
                  </td>
                </tr>
              )}
              {rows.map((row, i) => (
                <>
                  <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-400">{offset + i + 1}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-500">
                      {new Date(row.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2">
                      {row.rating === 1 ? (
                        <span className="text-green-600 font-semibold">👍</span>
                      ) : row.rating === -1 ? (
                        <span className="text-red-600 font-semibold">👎</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 max-w-xs truncate" title={row.question}>
                      {row.question}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        row.status === "approved" ? "bg-green-100 text-green-800" :
                        row.status === "rejected" ? "bg-red-100 text-red-800" :
                        row.status === "exported" ? "bg-blue-100 text-blue-800" :
                        "bg-yellow-100 text-yellow-800"
                      }`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">{row.reviewedBy ?? "—"}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                          className="p-1 text-gray-400 hover:text-gray-700"
                          title="Expand"
                        >
                          {expanded === row.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                        {row.status === "pending" && (
                          <>
                            <button
                              type="button"
                              disabled={saving === row.id}
                              onClick={() => void review(row.id, "approved")}
                              className="p-1 text-gray-400 hover:text-green-600 disabled:opacity-50"
                              title="Approve"
                            >
                              <CheckCircle className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              disabled={saving === row.id}
                              onClick={() => void review(row.id, "rejected")}
                              className="p-1 text-gray-400 hover:text-red-600 disabled:opacity-50"
                              title="Reject"
                            >
                              <XCircle className="h-4 w-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* Expanded detail */}
                  {expanded === row.id && (
                    <tr key={`${row.id}-detail`} className="border-t border-gray-100 bg-gray-50">
                      <td colSpan={7} className="px-4 py-4 space-y-4">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <div>
                            <p className="text-xs font-semibold text-gray-500 mb-1">Question</p>
                            <p className="text-sm text-gray-900 whitespace-pre-wrap">{row.question}</p>
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-gray-500 mb-1">AI Answer</p>
                            <p className="text-sm text-gray-700 whitespace-pre-wrap line-clamp-6">{row.answer}</p>
                          </div>
                        </div>

                        {/* Correction input */}
                        <div>
                          <label className="text-xs font-semibold text-gray-500 block mb-1">
                            Corrected answer (leave blank to approve as-is)
                          </label>
                          <textarea
                            rows={4}
                            value={corrections[row.id] ?? row.correction ?? ""}
                            onChange={(e) => setCorrections((p) => ({ ...p, [row.id]: e.target.value }))}
                            placeholder="Type the correct answer here…"
                            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-gray-500 block mb-1">
                            Note / reason
                          </label>
                          <input
                            value={notes[row.id] ?? row.correctionNote ?? ""}
                            onChange={(e) => setNotes((p) => ({ ...p, [row.id]: e.target.value }))}
                            placeholder="Optional note for the training log…"
                            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                          />
                        </div>

                        {row.status === "pending" && (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={saving === row.id}
                              onClick={() => void review(row.id, "approved")}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-green-600 text-white text-xs hover:bg-green-700 disabled:opacity-50"
                            >
                              <CheckCircle className="h-3.5 w-3.5" />
                              {corrections[row.id] ? "Approve with correction" : "Approve"}
                            </button>
                            <button
                              type="button"
                              disabled={saving === row.id}
                              onClick={() => void review(row.id, "rejected")}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-red-300 text-red-700 text-xs hover:bg-red-50 disabled:opacity-50"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              Reject
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center gap-2 text-sm">
            <button
              type="button"
              disabled={page === 1}
              onClick={() => setOffset((p) => Math.max(0, p - LIMIT))}
              className="px-3 py-1.5 rounded border border-gray-300 text-xs disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-xs text-gray-500">Page {page} of {pages}</span>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => setOffset((p) => p + LIMIT)}
              className="px-3 py-1.5 rounded border border-gray-300 text-xs disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
