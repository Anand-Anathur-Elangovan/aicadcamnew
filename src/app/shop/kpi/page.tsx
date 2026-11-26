"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  RefreshCw, TrendingUp, TrendingDown, AlertTriangle,
  Clock, CheckCircle, Package, Truck, Wrench, Download,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────
interface ShopKPI {
  totalActive: number;
  byStatus: Record<string, number>;
  overdueCount: number;
  dueSoon7: number;
  totalScrap: number;
  totalOrderQty: number;
  scrapRate: number;
  reworkLoops: number;
  passFirstTime: number;
  failFirstTime: number;
  totalStandardHours: number;
  totalActualHours: number;
  efficiency: number;
  avgCycleVsStd: number;
  machineCount: number;
  busyMachines: number;
  shippedLast30: number;
  avgLeadDays: number;
  topWorkCenters: { name: string; openMoves: number; backlogHours: number }[];
  topScrapParts: { partNumber: string; partName: string; scrap: number; orderQty: number }[];
}

// ─── Small helpers ────────────────────────────────────────────────────────────
const STATUS_ORDER = ["Released", "Running", "Inspection", "Finished"];

function Badge({ value, good }: { value: string | number; good: boolean }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
      good ? "bg-gray-100 text-gray-800" : "bg-gray-800 text-white"
    }`}>
      {value}
    </span>
  );
}

function KpiCard({
  label, value, sub, icon, alert = false,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon?: React.ReactNode;
  alert?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-1 ${
      alert ? "border-gray-800 bg-gray-900 text-white" : "border-gray-200 bg-white text-gray-900"
    }`}>
      <div className="flex items-center gap-1.5 text-xs opacity-60">
        {icon}
        {label}
      </div>
      <p className="text-3xl font-bold leading-none">{value}</p>
      {sub && <p className="text-xs opacity-60 mt-0.5">{sub}</p>}
    </div>
  );
}

function BarRow({ label, value, max, detail }: { label: string; value: number; max: number; detail?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-xs">
        <span className="truncate max-w-[180px]" title={label}>{label}</span>
        <span className="text-gray-500 ml-2 shrink-0">{detail ?? value}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full rounded-full bg-gray-800 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── CSV export ───────────────────────────────────────────────────────────────
function exportCSV(kpi: ShopKPI) {
  const lines = [
    "metric,value",
    `Total active routers,${kpi.totalActive}`,
    `Overdue,${kpi.overdueCount}`,
    `Due within 7 days,${kpi.dueSoon7}`,
    `Scrap rate,${kpi.scrapRate}%`,
    `Total scrap,${kpi.totalScrap}`,
    `Rework loops,${kpi.reworkLoops}`,
    `First-time quality pass,${kpi.passFirstTime}%`,
    `Labour efficiency,${kpi.efficiency}%`,
    `Standard hours,${kpi.totalStandardHours}`,
    `Actual hours,${kpi.totalActualHours}`,
    `Machines busy,${kpi.busyMachines}/${kpi.machineCount}`,
    `Shipped last 30 days,${kpi.shippedLast30}`,
    `Avg lead days,${kpi.avgLeadDays}`,
    ``,
    `status,routers`,
    ...STATUS_ORDER.map((s) => `${s},${kpi.byStatus[s] ?? 0}`),
    ``,
    `work_center,open_moves,backlog_hours`,
    ...kpi.topWorkCenters.map((w) => `${w.name},${w.openMoves},${w.backlogHours}`),
    ``,
    `part_number,part_name,scrap,order_qty`,
    ...kpi.topScrapParts.map((p) => `${p.partNumber},${p.partName},${p.scrap},${p.orderQty}`),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `shop_kpi_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function KpiPage() {
  const [kpi, setKpi]       = useState<ShopKPI | null>(null);
  const [loading, setLoad]  = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [ts, setTs]         = useState("");

  const load = useCallback(async () => {
    setLoad(true);
    setError(null);
    try {
      const res = await fetch("/api/shop/kpi");
      if (!res.ok) { const e = (await res.json()) as { error: string }; throw new Error(e.error); }
      setKpi(await res.json() as ShopKPI);
      setTs(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoad(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="border-b border-gray-200 bg-white sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3 flex-wrap">
          <Link href="/"            className="text-xs text-gray-400 hover:text-gray-900">Home</Link>
          <span className="text-gray-200">/</span>
          <h1 className="text-sm font-bold text-gray-900">Shop Floor KPI Dashboard</h1>
          <div className="flex-1" />
          {ts && <span className="text-xs text-gray-400">Updated {ts}</span>}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          {kpi && (
            <button
              type="button"
              onClick={() => exportCSV(kpi)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-gray-900 text-white text-xs hover:bg-gray-700"
            >
              <Download className="h-3.5 w-3.5" /> Export CSV
            </button>
          )}
          <Link href="/shop/anomalies" className="text-xs font-medium text-gray-600 hover:text-gray-900">Anomalies</Link>
          <Link href="/routers"        className="text-xs font-medium text-gray-600 hover:text-gray-900">Routers</Link>
          <Link href="/chat"           className="text-xs font-medium text-gray-600 hover:text-gray-900">Ask AI</Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-8">
        {error && (
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
            {error}
          </div>
        )}

        {!kpi && !error && (
          <div className="text-center py-16 text-gray-400 text-sm">Loading…</div>
        )}

        {kpi && (
          <>
            {/* ── Row 1: Pipeline ──────────────────────────────────────────── */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">Job Pipeline</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                <KpiCard label="Active routers" value={kpi.totalActive} icon={<Package className="h-3 w-3" />} />
                {STATUS_ORDER.map((s) => (
                  <KpiCard key={s} label={s} value={kpi.byStatus[s] ?? 0}
                    icon={s === "Running" ? <Wrench className="h-3 w-3" /> :
                          s === "Finished" ? <CheckCircle className="h-3 w-3" /> :
                          s === "Inspection" ? <AlertTriangle className="h-3 w-3" /> :
                          <Clock className="h-3 w-3" />}
                  />
                ))}
                <KpiCard label="Shipped (30 d)" value={kpi.shippedLast30} icon={<Truck className="h-3 w-3" />} />
              </div>

              {/* Alert row */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                <KpiCard label="Overdue" value={kpi.overdueCount}
                  sub="past due, not shipped"
                  icon={<AlertTriangle className="h-3 w-3" />}
                  alert={kpi.overdueCount > 0} />
                <KpiCard label="Due in 7 days" value={kpi.dueSoon7}
                  sub="ship before week ends"
                  icon={<Clock className="h-3 w-3" />}
                  alert={kpi.dueSoon7 > 0} />
                <KpiCard label="Avg lead time" value={`${kpi.avgLeadDays} days`}
                  sub="released → shipped"
                  icon={<TrendingUp className="h-3 w-3" />} />
              </div>
            </section>

            {/* ── Row 2: Quality ───────────────────────────────────────────── */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">Quality</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <KpiCard label="FTQ (first-time pass)" value={`${kpi.passFirstTime}%`}
                  sub={`${kpi.failFirstTime} failures recorded`}
                  icon={<CheckCircle className="h-3 w-3" />}
                  alert={kpi.passFirstTime < 90} />
                <KpiCard label="Scrap rate" value={`${kpi.scrapRate}%`}
                  sub={`${kpi.totalScrap} pcs scrapped`}
                  icon={<TrendingDown className="h-3 w-3" />}
                  alert={kpi.scrapRate > 5} />
                <KpiCard label="Total scrap" value={kpi.totalScrap} sub="all active routers"
                  icon={<TrendingDown className="h-3 w-3" />} />
                <KpiCard label="Rework loops" value={kpi.reworkLoops}
                  icon={<RefreshCw className="h-3 w-3" />}
                  alert={kpi.reworkLoops > 10} />
              </div>
            </section>

            {/* ── Row 3: Labour ────────────────────────────────────────────── */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">Labour & Machines</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <KpiCard label="Labour efficiency" value={`${kpi.efficiency}%`}
                  sub="standard ÷ actual hours"
                  icon={<TrendingUp className="h-3 w-3" />}
                  alert={kpi.efficiency < 80} />
                <KpiCard label="Standard hours" value={kpi.totalStandardHours}
                  sub="all moves"
                  icon={<Clock className="h-3 w-3" />} />
                <KpiCard label="Actual hours" value={kpi.totalActualHours}
                  sub="all moves"
                  icon={<Clock className="h-3 w-3" />} />
                <KpiCard label="Machines busy" value={`${kpi.busyMachines} / ${kpi.machineCount}`}
                  sub="open moves right now"
                  icon={<Wrench className="h-3 w-3" />}
                  alert={kpi.busyMachines === kpi.machineCount && kpi.machineCount > 0} />
              </div>
            </section>

            {/* ── Row 4: Bottlenecks + Scrap parts ─────────────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Top work-centres */}
              <section className="rounded-xl border border-gray-200 bg-white p-5">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-4">
                  Top Work-Centre Backlog
                </h2>
                {kpi.topWorkCenters.length === 0 ? (
                  <p className="text-sm text-gray-400">No open moves.</p>
                ) : (
                  <div className="space-y-3">
                    {kpi.topWorkCenters.map((w) => (
                      <BarRow
                        key={w.name}
                        label={w.name}
                        value={w.openMoves}
                        max={Math.max(...kpi.topWorkCenters.map((x) => x.openMoves))}
                        detail={`${w.openMoves} moves · ${w.backlogHours} h`}
                      />
                    ))}
                  </div>
                )}
              </section>

              {/* Top scrap parts */}
              <section className="rounded-xl border border-gray-200 bg-white p-5">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-4">
                  Top Scrap Contributors
                </h2>
                {kpi.topScrapParts.length === 0 ? (
                  <p className="text-sm text-gray-400">No scrap recorded.</p>
                ) : (
                  <div className="space-y-3">
                    {kpi.topScrapParts.map((p) => (
                      <BarRow
                        key={p.partNumber}
                        label={`${p.partNumber} ${p.partName}`}
                        value={p.scrap}
                        max={Math.max(...kpi.topScrapParts.map((x) => x.scrap))}
                        detail={`${p.scrap} / ${p.orderQty} (${p.orderQty > 0 ? Math.round(p.scrap / p.orderQty * 100) : 0}%)`}
                      />
                    ))}
                  </div>
                )}
              </section>
            </div>

            {/* ── Row 5: Status distribution bar ───────────────────────────── */}
            <section className="rounded-xl border border-gray-200 bg-white p-5">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-4">
                Router Status Distribution
              </h2>
              <div className="flex h-6 w-full overflow-hidden rounded-full gap-px">
                {STATUS_ORDER.filter((s) => (kpi.byStatus[s] ?? 0) > 0).map((s, i) => {
                  const pct = kpi.totalActive > 0
                    ? Math.round(((kpi.byStatus[s] ?? 0) / kpi.totalActive) * 100)
                    : 0;
                  const shades = ["bg-gray-200", "bg-gray-400", "bg-gray-600", "bg-gray-800"];
                  return (
                    <div
                      key={s}
                      className={`${shades[i]} flex items-center justify-center text-xs font-medium text-white overflow-hidden transition-all`}
                      style={{ width: `${pct}%`, minWidth: pct > 0 ? "2rem" : 0 }}
                      title={`${s}: ${kpi.byStatus[s]}`}
                    >
                      {pct >= 10 ? `${s} ${pct}%` : ""}
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-4 mt-3">
                {STATUS_ORDER.map((s, i) => {
                  const shades = ["bg-gray-200", "bg-gray-400", "bg-gray-600", "bg-gray-800"];
                  return (
                    <div key={s} className="flex items-center gap-1.5 text-xs text-gray-600">
                      <span className={`h-2.5 w-2.5 rounded-sm ${shades[i]}`} />
                      {s} <Badge value={kpi.byStatus[s] ?? 0} good={true} />
                    </div>
                  );
                })}
              </div>
            </section>

            {/* footer note */}
            <p className="text-xs text-gray-400 pb-6">
              Data from live shop views. Efficiency = standard hours ÷ actual hours × 100 (above 100 means faster than standard).
              FTQ = first-time quality pass %. Scrap alert triggers above 5%. Last refreshed: {ts}.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
