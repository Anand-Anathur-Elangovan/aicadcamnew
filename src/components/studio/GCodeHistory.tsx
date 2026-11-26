"use client";

import { useCallback, useEffect, useState } from "react";
import { History, GitCompare, Trash2, Save, ChevronDown, ChevronUp, RotateCcw } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface RevisionMeta {
  id: string;
  createdAt: string;
  programName: string;
  source: "ai_generated" | "manual" | "imported" | "approved";
  note: string | null;
  author: string | null;
  machine: string | null;
}

interface DiffLine {
  type: "equal" | "insert" | "delete";
  lineNumber: number;
  content: string;
}

interface DiffResult {
  from: { id: string; createdAt: string; source: string; note: string | null };
  to:   { id: string; createdAt: string; source: string; note: string | null };
  diff: {
    lines: DiffLine[];
    linesAdded: number;
    linesRemoved: number;
    linesUnchanged: number;
    editSummary: { category: string; description: string }[];
  };
}

const SOURCE_LABEL: Record<RevisionMeta["source"], string> = {
  ai_generated: "AI",
  manual:       "Manual",
  imported:     "Imported",
  approved:     "Approved",
};

// ─── Component ───────────────────────────────────────────────────────────────

interface GCodeHistoryProps {
  programName: string;
  currentCode: string;
  onRestore: (code: string) => void;
  /** Called after saving so caller can persist current state too */
  onSave?: (id: string) => void;
}

export function GCodeHistory({ programName, currentCode, onRestore, onSave }: GCodeHistoryProps) {
  const [open, setOpen]           = useState(false);
  const [revisions, setRevisions] = useState<RevisionMeta[]>([]);
  const [loading, setLoading]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [note, setNote]           = useState("");
  const [compareA, setCompareA]   = useState<string | null>(null);
  const [compareB, setCompareB]   = useState<string | null>(null);
  const [diff, setDiff]           = useState<DiffResult | null>(null);
  const [diffLoading, setDiffLoad]= useState(false);
  const [showDiff, setShowDiff]   = useState(false);

  const loadRevisions = useCallback(async () => {
    if (!programName) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/gcode/revisions?program=${encodeURIComponent(programName)}`);
      if (!res.ok) return;
      const data = (await res.json()) as { revisions: RevisionMeta[] };
      setRevisions(data.revisions);
    } finally {
      setLoading(false);
    }
  }, [programName]);

  useEffect(() => { if (open) void loadRevisions(); }, [open, loadRevisions]);

  const save = async () => {
    if (!currentCode.trim() || !programName) return;
    setSaving(true);
    try {
      const res = await fetch("/api/gcode/revisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programName, content: currentCode, source: "manual", note: note.trim() || undefined }),
      });
      if (!res.ok) return;
      const { id } = (await res.json()) as { id: string };
      setNote("");
      await loadRevisions();
      onSave?.(id);
    } finally {
      setSaving(false);
    }
  };

  const restore = async (id: string) => {
    const res = await fetch(`/api/gcode/revisions/${id}`);
    if (!res.ok) return;
    const rev = (await res.json()) as { content: string };
    onRestore(rev.content);
  };

  const remove = async (id: string) => {
    await fetch(`/api/gcode/revisions/${id}`, { method: "DELETE" });
    setRevisions((p) => p.filter((r) => r.id !== id));
    if (compareA === id) setCompareA(null);
    if (compareB === id) setCompareB(null);
    setDiff(null);
  };

  const compare = async () => {
    if (!compareA || !compareB || compareA === compareB) return;
    setDiffLoad(true);
    setDiff(null);
    try {
      const res = await fetch(`/api/gcode/revisions/compare?a=${compareA}&b=${compareB}`);
      if (!res.ok) return;
      setDiff((await res.json()) as DiffResult);
      setShowDiff(true);
    } finally {
      setDiffLoad(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-gray-300 text-xs text-gray-600 hover:bg-gray-50 transition-colors"
        title="G-code revision history"
      >
        <History className="h-3.5 w-3.5" />
        History
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3 border-t border-gray-200 pt-3 mt-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
          <History className="h-4 w-4" />
          G-code History — {programName}
        </span>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-gray-400 hover:text-gray-700">
          Close ✕
        </button>
      </div>

      {/* Save current */}
      <div className="flex items-center gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note (e.g. 'after bore depth fix')"
          className="flex-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs focus:border-gray-500 outline-none"
        />
        <button
          type="button"
          disabled={saving || !currentCode.trim()}
          onClick={() => void save()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-gray-900 text-white text-xs hover:bg-gray-700 disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? "Saving…" : "Save version"}
        </button>
      </div>

      {/* Revision list */}
      <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
        {loading && <p className="text-xs text-gray-400 p-3">Loading…</p>}
        {!loading && revisions.length === 0 && (
          <p className="text-xs text-gray-400 p-3">No saved versions yet.</p>
        )}
        {revisions.map((r) => (
          <div key={r.id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-xs">
            <input
              type="checkbox"
              title="Select for compare"
              checked={compareA === r.id || compareB === r.id}
              onChange={() => {
                if (compareA === r.id) { setCompareA(null); return; }
                if (compareB === r.id) { setCompareB(null); return; }
                if (!compareA) { setCompareA(r.id); return; }
                if (!compareB) { setCompareB(r.id); return; }
                setCompareA(r.id);
              }}
              className="h-3.5 w-3.5 accent-gray-800"
            />
            <span className="font-mono text-gray-500 shrink-0 w-16 truncate">
              {new Date(r.createdAt).toLocaleDateString()}
            </span>
            <span className="text-gray-400 shrink-0 w-10 truncate">
              {new Date(r.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600 shrink-0">
              {SOURCE_LABEL[r.source]}
            </span>
            <span className="flex-1 truncate text-gray-500" title={r.note ?? ""}>{r.note ?? ""}</span>
            <button type="button" onClick={() => void restore(r.id)} title="Restore to editor"
              className="text-gray-400 hover:text-gray-900">
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => void remove(r.id)} title="Delete"
              className="text-gray-400 hover:text-red-600">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Compare button */}
      {compareA && compareB && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">2 versions selected</span>
          <button
            type="button"
            disabled={diffLoading}
            onClick={() => void compare()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-gray-300 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <GitCompare className="h-3.5 w-3.5" />
            {diffLoading ? "Comparing…" : "Compare selected"}
          </button>
        </div>
      )}

      {/* Diff viewer */}
      {diff && showDiff && (
        <div className="rounded-lg border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between bg-gray-900 text-white px-3 py-2">
            <span className="text-xs font-semibold">
              Diff: {new Date(diff.from.createdAt).toLocaleString()} → {new Date(diff.to.createdAt).toLocaleString()}
            </span>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-green-400">+{diff.diff.linesAdded}</span>
              <span className="text-red-400">−{diff.diff.linesRemoved}</span>
              <button type="button" onClick={() => setShowDiff(false)} className="text-gray-400 hover:text-white ml-2">✕</button>
            </div>
          </div>

          {/* Edit summary */}
          {diff.diff.editSummary.length > 0 && (
            <div className="bg-gray-50 border-b border-gray-200 px-3 py-2 space-y-0.5">
              {diff.diff.editSummary.map((s, i) => (
                <p key={i} className="text-xs text-gray-600">
                  <span className="font-medium capitalize">{s.category.replace(/_/g, " ")}:</span> {s.description}
                </p>
              ))}
            </div>
          )}

          {/* Line diff */}
          <div className="max-h-72 overflow-y-auto">
            <pre className="text-xs font-mono leading-5">
              {diff.diff.lines.map((line, i) => (
                <div
                  key={i}
                  className={
                    line.type === "insert" ? "bg-green-50 text-green-800" :
                    line.type === "delete" ? "bg-red-50 text-red-800" :
                    "text-gray-700"
                  }
                >
                  <span className="inline-block w-8 text-right pr-2 select-none opacity-40 border-r border-gray-200 mr-2">
                    {line.lineNumber}
                  </span>
                  <span className="select-none mr-1">
                    {line.type === "insert" ? "+" : line.type === "delete" ? "−" : " "}
                  </span>
                  {line.content}
                </div>
              ))}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
