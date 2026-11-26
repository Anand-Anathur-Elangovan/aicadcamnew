/**
 * Shop anomaly detection.
 * Runs pure SQL queries against the same views used by the router pages.
 */
import { getPool } from "@/lib/chat/sessions";

export type AnomalyKind =
  | "no_movement"    // router has not moved in N days
  | "overdue"        // past due date and not shipped
  | "balance_error"  // order qty ≠ sum of parts
  | "scrap_spike"    // scrap > threshold % of order qty
  | "long_running"   // a move has been open > N hours
  | "stalled_op";    // current op has not progressed in N days

export interface AnomalyRow {
  routerNo: string;
  partNumber: string;
  partName: string;
  status: string;
  dueOn: string | null;
  kind: AnomalyKind;
  detail: string;        // human-readable description
  daysSince: number;     // days since last activity / days overdue (0 if N/A)
  orderQty: number;
  qtyScrap: number;
  whereNow: string;
  releasedOn: string | null;
}

export interface AnomalyFilters {
  status?: string;        // e.g. "Running"
  kind?: AnomalyKind;
  minDays?: number;       // minimum daysSince to include
  search?: string;
}

export async function fetchAnomalies(filters: AnomalyFilters = {}): Promise<AnomalyRow[]> {
  const pool = getPool();
  const today = new Date().toISOString().slice(0, 10);

  // Pull all non-shipped routers with their labour summary
  const { rows } = await pool.query(
    `SELECT
       b.router_no,
       b.part_number,
       b.part_name,
       b.status,
       b.due_on::text          AS due_on,
       b.released_on::text     AS released_on,
       b.order_qty,
       b.qty_scrap,
       b.qty_running,
       b.qty_waiting,
       b.qty_finished,
       b.qty_shipped,
       -- last move activity
       MAX(m.started_at)                           AS last_started,
       MAX(m.finished_at)                          AS last_finished,
       -- any currently open move
       MAX(CASE WHEN m.is_running THEN m.started_at END)  AS running_since,
       COALESCE((
         SELECT string_agg(s.stage_name || ' ×' || s.qty::text, ', ' ORDER BY s.op_no NULLS LAST)
         FROM shop_v_stages s WHERE s.router_no = b.router_no AND s.is_current
       ), '') AS where_now
     FROM shop_v_job_balance b
     LEFT JOIN shop_v_labor m ON m.router_no = b.router_no
     WHERE b.status <> 'Shipped'
       AND ($1 = '' OR b.status = $1)
       AND ($2 = '' OR b.router_no ILIKE '%'||$2||'%'
                    OR b.part_number ILIKE '%'||$2||'%'
                    OR b.part_name ILIKE '%'||$2||'%')
     GROUP BY b.router_no, b.part_number, b.part_name, b.status,
              b.due_on, b.released_on, b.order_qty, b.qty_scrap,
              b.qty_running, b.qty_waiting, b.qty_finished, b.qty_shipped`,
    [filters.status ?? "", filters.search ?? ""],
  );

  const minDays = filters.minDays ?? 0;
  const anomalies: AnomalyRow[] = [];

  for (const r of rows) {
    const base = {
      routerNo:   r.router_no   as string,
      partNumber: r.part_number as string,
      partName:   r.part_name   as string,
      status:     r.status      as string,
      dueOn:      r.due_on      as string | null,
      orderQty:   Number(r.order_qty),
      qtyScrap:   Number(r.qty_scrap),
      whereNow:   r.where_now   as string,
      releasedOn: r.released_on as string | null,
    };

    const orderQty   = base.orderQty;
    const qtySum     = Number(r.qty_running) + Number(r.qty_waiting) + Number(r.qty_scrap)
                     + Number(r.qty_finished) + Number(r.qty_shipped);

    // ── 1. Balance error ────────────────────────────────────────────────────
    if (orderQty !== qtySum) {
      push(anomalies, filters.kind, minDays, {
        ...base,
        kind:      "balance_error",
        detail:    `Order ${orderQty} ≠ parts sum ${qtySum}`,
        daysSince: 0,
      });
    }

    // ── 2. Overdue ──────────────────────────────────────────────────────────
    if (base.dueOn && base.dueOn < today) {
      const days = dayDiff(today, base.dueOn);
      push(anomalies, filters.kind, minDays, {
        ...base,
        kind:      "overdue",
        detail:    `Past due by ${days} day${days === 1 ? "" : "s"}`,
        daysSince: days,
      });
    }

    // ── 3. No movement ──────────────────────────────────────────────────────
    const lastActivity = r.last_finished ?? r.last_started;
    const releasedOn   = base.releasedOn;
    const reference    = lastActivity ?? releasedOn;
    if (reference) {
      const days = dayDiff(today, String(reference).slice(0, 10));
      if (days >= 7) {
        push(anomalies, filters.kind, minDays, {
          ...base,
          kind:      "no_movement",
          detail:    `No shop movement for ${days} day${days === 1 ? "" : "s"}`,
          daysSince: days,
        });
      }
    }

    // ── 4. Scrap spike (> 15%) ──────────────────────────────────────────────
    if (orderQty > 0 && base.qtyScrap / orderQty > 0.15) {
      push(anomalies, filters.kind, minDays, {
        ...base,
        kind:      "scrap_spike",
        detail:    `Scrap ${base.qtyScrap}/${orderQty} = ${Math.round(base.qtyScrap / orderQty * 100)}%`,
        daysSince: 0,
      });
    }

    // ── 5. Long-running move (> 24 h open) ──────────────────────────────────
    if (r.running_since) {
      const hours = hourDiff(new Date().toISOString(), String(r.running_since));
      if (hours >= 24) {
        push(anomalies, filters.kind, minDays, {
          ...base,
          kind:      "long_running",
          detail:    `Move open for ${hours} hour${hours === 1 ? "" : "s"}`,
          daysSince: Math.floor(hours / 24),
        });
      }
    }
  }

  // Sort: most days since first
  return anomalies.sort((a, b) => b.daysSince - a.daysSince);
}

// ── helpers ─────────────────────────────────────────────────────────────────

function push(
  list: AnomalyRow[],
  kindFilter: AnomalyKind | undefined,
  minDays: number,
  row: AnomalyRow,
) {
  if (kindFilter && row.kind !== kindFilter) return;
  if (row.daysSince < minDays) return;
  list.push(row);
}

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);
}

function hourDiff(a: string, b: string): number {
  return Math.round((Date.parse(a) - Date.parse(b)) / 3_600_000);
}
