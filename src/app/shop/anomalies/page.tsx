"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, Clock, TrendingDown, Scale, Timer, Zap,
  RefreshCw, Download, MessageSquare, X, Send, ChevronDown, ChevronUp,
} from "lucide-react";
import type { AnomalyKind } from "@/lib/shop/anomaly";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AnomalyRow {
  routerNo: string;
  partNumber: string;
  partName: string;
  status: string;
  dueOn: string | null;
  kind: AnomalyKind;
  detail: string;
  daysSince: number;
  orderQty: number;
  qtyScrap: number;
  whereNow: string;
  releasedOn: string | null;
}

interface ChatMsg { role: "user" | "assistant"; text: string; }

// ─── Constants ───────────────────────────────────────────────────────────────

const KIND_LABELS: Record<AnomalyKind, string> = {
  no_movement:   "No Movement",
  overdue:       "Overdue",
  balance_error: "Balance Error",
  scrap_spike:   "Scrap Spike",
  long_running:  "Long Running",
  stalled_op:    "Stalled Op",
};

const KIND_ICONS: Record<AnomalyKind, React.ReactNode> = {
  no_movement:   <Clock className="h-3.5 w-3.5" />,
  overdue:       <AlertTriangle className="h-3.5 w-3.5" />,
  balance_error: <Scale className="h-3.5 w-3.5" />,
  scrap_spike:   <TrendingDown className="h-3.5 w-3.5" />,
  long_running:  <Timer className="h-3.5 w-3.5" />,
  stalled_op:    <Zap className="h-3.5 w-3.5" />,
};

const KIND_OPTIONS = ["all", ...Object.keys(KIND_LABELS)] as const;
const STATUS_OPTIONS = ["all", "Released", "Running", "Inspection", "Finished"];
const MIN_DAYS_OPTIONS = [0, 3, 7, 14, 30];

// ─── CSV helper ──────────────────────────────────────────────────────────────

function toCSV(rows: AnomalyRow[]): string {
  const header = "router_no,part_number,part_name,status,kind,detail,days_since,order_qty,qty_scrap,due_on,where_now,released_on";
  const esc = (s: string | null | number) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  return [header, ...rows.map((r) =>
    [r.routerNo, r.partNumber, r.partName, r.status, r.kind,
     esc(r.detail), r.daysSince, r.orderQty, r.qtyScrap,
     r.dueOn ?? "", r.whereNow, r.releasedOn ?? ""].join(",")
  )].join("\n");
}

function downloadCSV(rows: AnomalyRow[]) {
  const blob = new Blob([toCSV(rows)], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `shop_anomalies_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Floating chatbot ─────────────────────────────────────────────────────────

function FloatingChat({ anomalies }: { anomalies: AnomalyRow[] }) {
  const [open, setOpen]   = useState(false);
  const [msgs, setMsgs]   = useState<ChatMsg[]>([
    { role: "assistant", text: "Hi! I can answer questions about these anomalies. Try: 'Which routers are overdue?' or 'What has the most scrap?'" },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy]   = useState(false);
  const bottomRef         = useRef<HTMLDivElement>(null);
  const sessionRef        = useRef<string | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setMsgs((p) => [...p, { role: "user", text }]);
    setBusy(true);

    // Build a compact context summary from the visible anomalies
    const summary = anomalies.slice(0, 40).map((r) =>
      `${r.routerNo} (${r.partName}) – ${KIND_LABELS[r.kind]}: ${r.detail}`
    ).join("\n");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionRef.current,
          content: `I am looking at the shop anomaly dashboard. The current anomalies are:\n${summary}\n\nMy question: ${text}`,
        }),
      });
      if (!res.ok || !res.body) throw new Error("No response");

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = "";
      let reply     = "";
      let newId: string | null = null;

      setMsgs((p) => [...p, { role: "assistant", text: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        buffer += done ? decoder.decode() + "\n" : decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const ev = JSON.parse(line.slice(6)) as { type: string; text?: string; sessionId?: string };
            if (ev.type === "session" && ev.sessionId) newId = ev.sessionId;
            if (ev.type === "token" && ev.text) {
              reply += ev.text;
              setMsgs((p) => {
                const next = [...p];
                next[next.length - 1] = { role: "assistant", text: reply };
                return next;
              });
            }
          } catch { /* partial line */ }
        }
        if (done) break;
      }
      if (newId) sessionRef.current = newId;
    } catch {
      setMsgs((p) => [...p, { role: "assistant", text: "Sorry, could not get a response." }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2">
      {open && (
        <div className="w-80 rounded-xl border border-gray-300 bg-white shadow-2xl flex flex-col overflow-hidden"
             style={{ height: "420px" }}>
          {/* Chat header */}
          <div className="flex items-center justify-between bg-gray-900 px-3 py-2">
            <span className="text-xs font-semibold text-white">Ask about anomalies</span>
            <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                  m.role === "user"
                    ? "bg-gray-900 text-white"
                    : "bg-gray-100 text-gray-900 border border-gray-200"
                }`}>
                  {m.text || <span className="animate-pulse">…</span>}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="border-t border-gray-200 px-3 py-2 flex items-center gap-2 bg-white">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) void send(); }}
              disabled={busy}
              placeholder="Ask about anomalies…"
              className="flex-1 text-xs bg-transparent outline-none placeholder:text-gray-400 disabled:opacity-50"
            />
            <button
              type="button"
              disabled={busy || !input.trim()}
              onClick={() => void send()}
              className="text-gray-400 hover:text-gray-900 disabled:opacity-30"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Toggle button */}
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="h-11 w-11 rounded-full bg-gray-900 text-white shadow-lg flex items-center justify-center hover:bg-gray-700 transition-colors"
        aria-label="Open anomaly assistant"
      >
        <MessageSquare className="h-5 w-5" />
      </button>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AnomalyDashboard() {
  const [rows, setRows]           = useState<AnomalyRow[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [kindFilter, setKind]     = useState<string>("all");
  const [statusFilter, setStatus] = useState<string>("all");
  const [minDays, setMinDays]     = useState(0);
  const [search, setSearch]       = useState("");
  const [expanded, setExpanded]   = useState<string | null>(null);
  const [counts, setCounts]       = useState<Partial<Record<AnomalyKind, number>>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (statusFilter !== "all") qs.set("status", statusFilter);
      if (kindFilter   !== "all") qs.set("kind",   kindFilter);
      if (minDays > 0)            qs.set("minDays", String(minDays));
      if (search.trim())          qs.set("search",  search.trim());
      const res = await fetch(`/api/shop/anomalies?${qs}`);
      if (!res.ok) { const e = (await res.json()) as { error: string }; throw new Error(e.error); }
      const data = (await res.json()) as { anomalies: AnomalyRow[] };
      setRows(data.anomalies);
      // counts per kind
      const c: Partial<Record<AnomalyKind, number>> = {};
      for (const r of data.anomalies) c[r.kind] = (c[r.kind] ?? 0) + 1;
      setCounts(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [kindFilter, statusFilter, minDays, search]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="border-b border-gray-300 bg-white sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/"       className="text-xs text-gray-500 hover:text-gray-900">Home</Link>
          <span className="text-gray-300">/</span>
          <Link href="/routers" className="text-xs text-gray-500 hover:text-gray-900">Routers</Link>
          <span className="text-gray-300">/</span>
          <h1 className="text-sm font-bold text-gray-900">Shop Anomaly Dashboard</h1>
          <div className="flex-1" />
          <Link href="/chat" className="text-xs font-medium text-gray-600 hover:text-gray-900">Ask AI</Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">

        {/* ── Summary cards ──────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {(Object.keys(KIND_LABELS) as AnomalyKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(kindFilter === k ? "all" : k)}
              className={`rounded-lg border px-3 py-3 text-left transition-colors ${
                kindFilter === k
                  ? "border-gray-900 bg-gray-900 text-white"
                  : "border-gray-200 bg-white text-gray-700 hover:border-gray-400"
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1 opacity-70">
                {KIND_ICONS[k]}
                <span className="text-xs">{KIND_LABELS[k]}</span>
              </div>
              <p className="text-2xl font-bold">{counts[k] ?? 0}</p>
            </button>
          ))}
        </div>

        {/* ── Filters ────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void load()}
            placeholder="Router / part / name…"
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm w-56 focus:border-gray-700 outline-none"
          />

          <select
            value={statusFilter}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s === "all" ? "All statuses" : s}</option>
            ))}
          </select>

          <select
            value={kindFilter}
            onChange={(e) => setKind(e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
          >
            {KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>{k === "all" ? "All types" : KIND_LABELS[k as AnomalyKind]}</option>
            ))}
          </select>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">Min days inactive</span>
            <select
              value={minDays}
              onChange={(e) => setMinDays(parseInt(e.target.value))}
              className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
            >
              {MIN_DAYS_OPTIONS.map((d) => (
                <option key={d} value={d}>{d === 0 ? "Any" : `${d}+`}</option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-gray-300 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>

          <button
            type="button"
            disabled={rows.length === 0}
            onClick={() => downloadCSV(rows)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-gray-900 text-white text-xs hover:bg-gray-700 disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            Download CSV
          </button>

          <span className="ml-auto text-xs text-gray-400">
            {rows.length} anomal{rows.length === 1 ? "y" : "ies"} · dataset {new Date().toLocaleDateString()}
          </span>
        </div>

        {/* ── Error ───────────────────────────────────────────────────────── */}
        {error && (
          <div className="rounded-lg border border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-700">
            {error}
          </div>
        )}

        {/* ── Table ───────────────────────────────────────────────────────── */}
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-900 text-white text-xs uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2 text-left w-6" />
                <th className="px-3 py-2 text-left">Router</th>
                <th className="px-3 py-2 text-left">Part</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Detail</th>
                <th className="px-3 py-2 text-right">Days</th>
                <th className="px-3 py-2 text-right">Order</th>
                <th className="px-3 py-2 text-right">Scrap</th>
                <th className="px-3 py-2 text-left">Due</th>
                <th className="px-3 py-2 text-left">Where now</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-gray-400">
                    {loading ? "Loading…" : "No anomalies match this filter. Shop is clean."}
                  </td>
                </tr>
              )}
              {rows.map((row, i) => {
                const key = `${row.routerNo}-${row.kind}`;
                const isExpanded = expanded === key;
                const isHigh = row.kind === "overdue" || (row.kind === "no_movement" && row.daysSince >= 14) || row.kind === "scrap_spike";
                return (
                  <>
                    <tr
                      key={key}
                      className={`border-t border-gray-100 cursor-pointer hover:bg-gray-50 ${
                        isHigh ? "bg-gray-50" : ""
                      }`}
                      onClick={() => setExpanded(isExpanded ? null : key)}
                    >
                      <td className="px-3 py-2 text-gray-400">
                        {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </td>
                      <td className="px-3 py-2 font-medium">
                        <Link
                          href={`/routers/${row.routerNo}`}
                          className="underline underline-offset-2 hover:text-gray-600"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {row.routerNo}
                        </Link>
                        {isHigh && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-gray-900 align-middle" title="High priority" />}
                      </td>
                      <td className="px-3 py-2 max-w-[160px] truncate" title={`${row.partNumber} ${row.partName}`}>
                        {row.partNumber} {row.partName}
                      </td>
                      <td className="px-3 py-2">
                        <span className="rounded-full border border-gray-300 px-2 py-0.5 text-xs">{row.status}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-700">
                          {KIND_ICONS[row.kind]} {KIND_LABELS[row.kind]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600">{row.detail}</td>
                      <td className={`px-3 py-2 text-right font-mono text-xs ${row.daysSince >= 14 ? "font-bold" : ""}`}>
                        {row.daysSince > 0 ? row.daysSince : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{row.orderQty}</td>
                      <td className={`px-3 py-2 text-right font-mono text-xs ${row.qtyScrap > 0 ? "font-bold" : "text-gray-400"}`}>
                        {row.qtyScrap > 0 ? row.qtyScrap : "—"}
                      </td>
                      <td className={`px-3 py-2 text-xs ${row.dueOn && row.dueOn < new Date().toISOString().slice(0, 10) ? "font-bold" : ""}`}>
                        {row.dueOn ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500 max-w-[140px] truncate">{row.whereNow || "—"}</td>
                    </tr>

                    {isExpanded && (
                      <tr key={`${key}-detail`} className="border-t border-gray-100 bg-gray-50">
                        <td colSpan={11} className="px-6 py-4">
                          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-xs">
                            <div><dt className="text-gray-400 font-medium">Router</dt><dd>{row.routerNo}</dd></div>
                            <div><dt className="text-gray-400 font-medium">Part</dt><dd>{row.partNumber} — {row.partName}</dd></div>
                            <div><dt className="text-gray-400 font-medium">Released</dt><dd>{row.releasedOn ?? "—"}</dd></div>
                            <div><dt className="text-gray-400 font-medium">Due</dt><dd>{row.dueOn ?? "—"}</dd></div>
                            <div><dt className="text-gray-400 font-medium">Order qty</dt><dd>{row.orderQty}</dd></div>
                            <div><dt className="text-gray-400 font-medium">Scrap</dt><dd>{row.qtyScrap}</dd></div>
                            <div><dt className="text-gray-400 font-medium">Anomaly</dt><dd>{KIND_LABELS[row.kind]}</dd></div>
                            <div><dt className="text-gray-400 font-medium">Detail</dt><dd>{row.detail}</dd></div>
                            <div className="col-span-2"><dt className="text-gray-400 font-medium">Where now</dt><dd>{row.whereNow || "—"}</dd></div>
                          </dl>
                          <div className="mt-3">
                            <Link
                              href={`/routers/${row.routerNo}`}
                              className="text-xs underline underline-offset-2 text-gray-700 hover:text-gray-900"
                            >
                              Open full router →
                            </Link>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-gray-400">
          Thresholds: no-movement ≥ 7 days · scrap spike &gt; 15% of order qty · long-running move &gt; 24 h.
          Rows with high priority (●) are overdue, no movement ≥ 14 days, or scrap spike.
        </p>
      </main>

      {/* Floating chatbot */}
      <FloatingChat anomalies={rows} />
    </div>
  );
}
