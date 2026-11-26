"use client";

/**
 * /alarms — NCK / Machine Alarm Log Dashboard
 *
 * Shows all machine alarm events from the centralised log.
 * Supports:  full-text search, machine / severity / ack filters, date range,
 *            CSV download, one-click acknowledge, ingest via paste.
 */
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft, Search, Download, AlertTriangle, AlertCircle,
  CheckCircle, Info, Upload, ChevronDown, ChevronUp, RefreshCw,
} from "lucide-react";

/* ── Types ────────────────────────────────────────────────────────────── */
interface AlarmRecord {
  id: string;
  occurred_at: string;
  machine_id: string;
  controller: string;
  alarm_code: string;
  severity: "info" | "warning" | "fault" | "emergency";
  description: string;
  axis?: string;
  program_name?: string;
  operator?: string;
  acknowledged: boolean;
  acknowledged_at?: string;
  acknowledged_by?: string;
}
interface AlarmResult { alarms: AlarmRecord[]; total: number; }
interface Summary {
  total: number;
  unacknowledged: number;
  bySeverity: Record<string, number>;
  byMachine: { machine_id: string; count: number }[];
  recentFaults: AlarmRecord[];
}

/* ── Helpers ──────────────────────────────────────────────────────────── */
const SEV_ICON = {
  info:      <Info className="h-4 w-4 text-blue-500" />,
  warning:   <AlertTriangle className="h-4 w-4 text-amber-500" />,
  fault:     <AlertCircle className="h-4 w-4 text-red-500" />,
  emergency: <AlertCircle className="h-4 w-4 text-red-700" />,
};
const SEV_BADGE: Record<string, string> = {
  info:      "bg-blue-100 text-blue-800",
  warning:   "bg-amber-100 text-amber-800",
  fault:     "bg-red-100 text-red-800",
  emergency: "bg-red-200 text-red-900 font-bold",
};
const PAGE_SIZE = 25;

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "short"
  });
}

/* ── Page ─────────────────────────────────────────────────────────────── */
export default function AlarmsPage() {
  const [result, setResult]       = useState<AlarmResult | null>(null);
  const [summary, setSummary]     = useState<Summary | null>(null);
  const [loading, setLoading]     = useState(true);
  const [page, setPage]           = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Filters
  const [q, setQ]           = useState("");
  const [machine, setMachine] = useState("");
  const [severity, setSeverity] = useState("");
  const [ackFilter, setAckFilter] = useState("");   // "" | "true" | "false"
  const [from, setFrom]     = useState("");
  const [to, setTo]         = useState("");

  // Paste ingest
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteLoading, setPasteLoading] = useState(false);
  const [pasteMsg, setPasteMsg]   = useState("");

  const fetchData = useCallback(async (resetPage = false) => {
    setLoading(true);
    const offset = resetPage ? 0 : page * PAGE_SIZE;
    if (resetPage) setPage(0);

    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (q)        params.set("q", q);
    if (machine)  params.set("machine", machine);
    if (severity) params.set("severity", severity);
    if (ackFilter) params.set("ack", ackFilter);
    if (from)     params.set("from", from);
    if (to)       params.set("to", to);

    const [dataRes, sumRes] = await Promise.all([
      fetch(`/api/alarms?${params.toString()}`).then((r) => r.json() as Promise<AlarmResult>),
      fetch("/api/alarms?summary=1").then((r) => r.json() as Promise<Summary>),
    ]);
    setResult(dataRes);
    setSummary(sumRes);
    setLoading(false);
  }, [q, machine, severity, ackFilter, from, to, page]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const acknowledge = async (id: string) => {
    await fetch(`/api/alarms/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acknowledged_by: "operator" }),
    });
    void fetchData();
  };

  const downloadCSV = () => {
    if (!result) return;
    const header = "id,occurred_at,machine_id,controller,alarm_code,severity,description,axis,program_name,acknowledged";
    const rows = result.alarms.map((a) =>
      [a.id, a.occurred_at, a.machine_id, a.controller, a.alarm_code, a.severity,
       `"${a.description.replace(/"/g, '""')}"`, a.axis ?? "", a.program_name ?? "", a.acknowledged].join(",")
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a"); a.href = url; a.download = "machine_alarms.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const ingestPaste = async () => {
    if (!pasteText.trim()) return;
    setPasteLoading(true); setPasteMsg("");
    const res = await fetch("/api/alarms", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: pasteText,
    });
    const data = (await res.json()) as { inserted?: number; error?: string };
    setPasteMsg(data.error ? `Error: ${data.error}` : `✓ Inserted ${data.inserted} alarms`);
    setPasteLoading(false);
    if (!data.error) { setPasteText(""); void fetchData(true); }
  };

  const totalPages = result ? Math.ceil(result.total / PAGE_SIZE) : 0;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <Link href="/" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-gray-900">Machine Alarm Log</h1>
            <p className="text-xs text-gray-500">NCK / CNC alarm events — search, acknowledge, export</p>
          </div>
          <button type="button" onClick={() => void fetchData()} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => setPasteOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-xs font-medium hover:bg-gray-50"
          >
            <Upload className="h-3.5 w-3.5" /> Ingest Log
          </button>
          <button
            type="button"
            onClick={downloadCSV}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-900 text-white text-xs font-medium hover:bg-gray-700"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-5">

        {/* Summary cards */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Total Alarms",     value: summary.total,                       bg: "bg-white" },
              { label: "Unacknowledged",   value: summary.unacknowledged,              bg: summary.unacknowledged > 0 ? "bg-red-50 border-red-200" : "bg-white" },
              { label: "Faults",           value: summary.bySeverity.fault ?? 0,       bg: "bg-white" },
              { label: "Emergencies",      value: summary.bySeverity.emergency ?? 0,   bg: (summary.bySeverity.emergency ?? 0) > 0 ? "bg-red-50 border-red-200" : "bg-white" },
            ].map((c) => (
              <div key={c.label} className={`rounded-xl border border-gray-200 ${c.bg} px-4 py-3`}>
                <p className="text-xs text-gray-500">{c.label}</p>
                <p className="text-2xl font-bold text-gray-900">{c.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Paste ingest panel */}
        {pasteOpen && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <p className="text-sm font-semibold text-gray-700">Paste machine log (plain-text or Siemens CSV)</p>
            <p className="text-xs text-gray-500">
              Plain-text format: <code className="bg-gray-100 px-1 rounded">2024-03-01T08:12:00 VMC-01 NCK25201 FAULT Feed axis X: position error</code>
            </p>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={6}
              className="w-full text-xs font-mono rounded-lg border border-gray-300 p-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Paste log lines here…"
            />
            {pasteMsg && <p className={`text-xs font-medium ${pasteMsg.startsWith("Error") ? "text-red-600" : "text-green-700"}`}>{pasteMsg}</p>}
            <button
              type="button"
              disabled={pasteLoading}
              onClick={() => void ingestPaste()}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50"
            >
              {pasteLoading ? "Ingesting…" : "Ingest"}
            </button>
          </div>
        )}

        {/* Filters */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="relative col-span-2 sm:col-span-1 lg:col-span-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
              <input
                type="text" value={q} onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void fetchData(true)}
                placeholder="Search alarms…"
                className="w-full pl-8 pr-3 py-2 rounded-lg border border-gray-300 text-xs focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <input
              type="text" value={machine} onChange={(e) => setMachine(e.target.value)}
              placeholder="Machine ID"
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <select value={severity} onChange={(e) => setSeverity(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-2 text-xs bg-white focus:ring-2 focus:ring-blue-500 outline-none">
              <option value="">All severities</option>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="fault">Fault</option>
              <option value="emergency">Emergency</option>
            </select>
            <select value={ackFilter} onChange={(e) => setAckFilter(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-2 text-xs bg-white focus:ring-2 focus:ring-blue-500 outline-none">
              <option value="">All</option>
              <option value="false">Unacknowledged</option>
              <option value="true">Acknowledged</option>
            </select>
            <button
              type="button" onClick={() => void fetchData(true)}
              className="px-4 py-2 rounded-lg bg-gray-900 text-white text-xs font-semibold hover:bg-gray-700"
            >
              Filter
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {loading && (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Loading…
            </div>
          )}
          {!loading && result && result.alarms.length === 0 && (
            <div className="text-center py-16 text-gray-400">
              <AlertCircle className="h-10 w-10 mx-auto mb-3 text-gray-200" />
              <p className="font-medium">No alarms found</p>
              <p className="text-xs mt-1">Adjust filters or ingest a machine log file</p>
            </div>
          )}
          {!loading && result && result.alarms.length > 0 && (
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 w-36">Time (IST)</th>
                  <th className="text-left px-3 py-3 font-semibold text-gray-600">Machine</th>
                  <th className="text-left px-3 py-3 font-semibold text-gray-600">Code</th>
                  <th className="text-left px-3 py-3 font-semibold text-gray-600">Severity</th>
                  <th className="text-left px-3 py-3 font-semibold text-gray-600 flex-1">Description</th>
                  <th className="text-left px-3 py-3 font-semibold text-gray-600">Status</th>
                  <th className="px-3 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {result.alarms.map((alarm) => (
                  <>
                    <tr
                      key={alarm.id}
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => setExpandedId((p) => (p === alarm.id ? null : alarm.id))}
                    >
                      <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{fmt(alarm.occurred_at)}</td>
                      <td className="px-3 py-2.5 font-mono font-semibold text-gray-800">{alarm.machine_id}</td>
                      <td className="px-3 py-2.5 font-mono text-gray-700">{alarm.alarm_code}</td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${SEV_BADGE[alarm.severity]}`}>
                          {SEV_ICON[alarm.severity]}
                          {alarm.severity}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-gray-700 max-w-xs truncate">{alarm.description}</td>
                      <td className="px-3 py-2.5">
                        {alarm.acknowledged
                          ? <span className="text-green-600 flex items-center gap-1"><CheckCircle className="h-3.5 w-3.5" />ACK</span>
                          : <span className="text-amber-600">Pending</span>
                        }
                      </td>
                      <td className="px-3 py-2.5">
                        {expandedId === alarm.id
                          ? <ChevronUp className="h-4 w-4 text-gray-400" />
                          : <ChevronDown className="h-4 w-4 text-gray-400" />
                        }
                      </td>
                    </tr>
                    {expandedId === alarm.id && (
                      <tr key={`${alarm.id}-exp`}>
                        <td colSpan={7} className="px-6 py-4 bg-gray-50 border-t border-gray-100">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mb-3">
                            {alarm.controller && <div><span className="text-gray-500">Controller: </span>{alarm.controller}</div>}
                            {alarm.axis       && <div><span className="text-gray-500">Axis: </span>{alarm.axis}</div>}
                            {alarm.program_name && <div><span className="text-gray-500">Program: </span>{alarm.program_name}</div>}
                            {alarm.operator   && <div><span className="text-gray-500">Operator: </span>{alarm.operator}</div>}
                            {alarm.acknowledged_by && <div><span className="text-gray-500">ACK by: </span>{alarm.acknowledged_by}</div>}
                            {alarm.acknowledged_at && <div><span className="text-gray-500">ACK at: </span>{fmt(alarm.acknowledged_at)}</div>}
                          </div>
                          {!alarm.acknowledged && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); void acknowledge(alarm.id); }}
                              className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs font-medium hover:bg-green-700"
                            >
                              ✓ Acknowledge
                            </button>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
              <span className="text-xs text-gray-500">
                {result?.total} total · Page {page + 1} of {totalPages}
              </span>
              <div className="flex gap-2">
                <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}
                  className="px-3 py-1.5 rounded-lg border border-gray-300 text-xs disabled:opacity-40 hover:bg-gray-100">
                  ← Prev
                </button>
                <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}
                  className="px-3 py-1.5 rounded-lg border border-gray-300 text-xs disabled:opacity-40 hover:bg-gray-100">
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Top machines */}
        {summary && summary.byMachine.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Top machines by alarm count</h2>
            <div className="space-y-2">
              {summary.byMachine.slice(0, 8).map((m) => {
                const max = summary.byMachine[0]?.count ?? 1;
                return (
                  <div key={m.machine_id} className="flex items-center gap-3">
                    <span className="w-20 text-xs font-mono text-gray-700 shrink-0 truncate">{m.machine_id}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                      <div className="h-2 bg-gray-800 rounded-full" style={{ width: `${(m.count / max) * 100}%` }} />
                    </div>
                    <span className="text-xs text-gray-500 w-8 text-right">{m.count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
