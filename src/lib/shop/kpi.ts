/**
 * KPI queries for the management summary dashboard.
 * All numbers come from existing shop views — no new DB objects needed.
 */
import { getPool } from "@/lib/chat/sessions";

export interface ShopKPI {
  // Job pipeline
  totalActive: number;        // non-shipped routers
  byStatus: Record<string, number>;
  overdueCount: number;
  dueSoon7: number;           // due within 7 days, not shipped

  // Quality
  totalScrap: number;
  totalOrderQty: number;
  scrapRate: number;          // %
  reworkLoops: number;
  passFirstTime: number;      // FTQ %  (passed quality / total quality events)
  failFirstTime: number;

  // Labour / efficiency
  totalStandardHours: number;
  totalActualHours: number;
  efficiency: number;         // standard / actual * 100 (>100 = better than standard)
  avgCycleVsStd: number;      // actual minutes / standard minutes average

  // Machine utilisation (simple: open moves / machine count)
  machineCount: number;
  busyMachines: number;       // machines with an open move right now

  // Throughput
  shippedLast30: number;      // routers shipped in last 30 days
  avgLeadDays: number;        // released_on → shipped_on average

  // Top bottlenecks
  topWorkCenters: { name: string; openMoves: number; backlogHours: number }[];
  topScrapParts:  { partNumber: string; partName: string; scrap: number; orderQty: number }[];
}

export async function fetchKPI(): Promise<ShopKPI> {
  const pool = getPool();
  const today = new Date().toISOString().slice(0, 10);
  const ago30 = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

  const [
    statusRows,
    overdueRow,
    scrapRow,
    qualityRow,
    labourRow,
    machineRow,
    shippedRow,
    wcRows,
    scrapPartsRows,
  ] = await Promise.all([
    // Status breakdown
    pool.query(
      `SELECT status, COUNT(*) AS n FROM shop_v_job_balance WHERE status <> 'Shipped' GROUP BY status`,
    ),
    // Overdue + due-soon
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE due_on < $1 AND status <> 'Shipped') AS overdue,
         COUNT(*) FILTER (WHERE due_on BETWEEN $1 AND ($1::date + 7) AND status <> 'Shipped') AS due_soon
       FROM shop_v_job_balance`,
      [today],
    ),
    // Scrap
    pool.query(
      `SELECT
         COALESCE(SUM(qty_scrap),  0) AS total_scrap,
         COALESCE(SUM(order_qty),  0) AS total_order,
         COALESCE(SUM(qty_rework_loops), 0) AS rework
       FROM shop_v_job_balance`,
    ),
    // Quality FTQ
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE result = 'Pass') AS pass,
         COUNT(*) FILTER (WHERE result = 'Fail') AS fail
       FROM shop_v_quality`,
    ),
    // Labour hours
    pool.query(
      `SELECT
         COALESCE(SUM(standard_hours), 0) AS std_hrs,
         COALESCE(SUM(actual_hours),   0) AS act_hrs,
         CASE WHEN COALESCE(SUM(standard_minutes),0) = 0 THEN 1
              ELSE COALESCE(SUM(actual_minutes), SUM(standard_minutes)) / SUM(standard_minutes) END AS ratio
       FROM shop_v_labor`,
    ),
    // Machines
    pool.query(
      `SELECT
         (SELECT COUNT(*) FROM shop_machines) AS total,
         COUNT(DISTINCT machine_name) FILTER (WHERE is_running) AS busy
       FROM shop_v_labor`,
    ),
    // Shipped last 30 days + avg lead time
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE shipped_on >= $1) AS shipped_30,
         ROUND(AVG(shipped_on - released_on)) AS avg_lead
       FROM shop_v_job_balance
       WHERE status = 'Shipped'`,
      [ago30],
    ),
    // Top work centers by open moves
    pool.query(
      `SELECT work_center AS name,
              COUNT(*) AS open_moves,
              ROUND(SUM(standard_hours)) AS backlog_hours
       FROM shop_v_labor
       WHERE is_running
       GROUP BY work_center
       ORDER BY open_moves DESC
       LIMIT 5`,
    ),
    // Top scrap parts
    pool.query(
      `SELECT part_number, part_name,
              SUM(qty_scrap) AS scrap,
              SUM(order_qty) AS order_qty
       FROM shop_v_job_balance
       WHERE qty_scrap > 0
       GROUP BY part_number, part_name
       ORDER BY scrap DESC
       LIMIT 5`,
    ),
  ]);

  const statusMap: Record<string, number> = {};
  let totalActive = 0;
  for (const r of statusRows.rows) {
    statusMap[r.status] = parseInt(r.n);
    totalActive += parseInt(r.n);
  }

  const totalScrap    = parseInt(scrapRow.rows[0].total_scrap);
  const totalOrderQty = parseInt(scrapRow.rows[0].total_order);
  const stdHrs        = parseFloat(labourRow.rows[0].std_hrs);
  const actHrs        = parseFloat(labourRow.rows[0].act_hrs);

  return {
    totalActive,
    byStatus: statusMap,
    overdueCount: parseInt(overdueRow.rows[0].overdue),
    dueSoon7:     parseInt(overdueRow.rows[0].due_soon),
    totalScrap,
    totalOrderQty,
    scrapRate:    totalOrderQty ? Math.round((totalScrap / totalOrderQty) * 1000) / 10 : 0,
    reworkLoops:  parseInt(scrapRow.rows[0].rework),
    passFirstTime: qualityRow.rows[0] ? Math.round(
      (parseInt(qualityRow.rows[0].pass) /
        Math.max(1, parseInt(qualityRow.rows[0].pass) + parseInt(qualityRow.rows[0].fail))) * 100
    ) : 100,
    failFirstTime: parseInt(qualityRow.rows[0]?.fail ?? 0),
    totalStandardHours: Math.round(stdHrs),
    totalActualHours:   Math.round(actHrs),
    efficiency: actHrs > 0 ? Math.round((stdHrs / actHrs) * 100) : 100,
    avgCycleVsStd: parseFloat(labourRow.rows[0].ratio ?? 1),
    machineCount:  parseInt(machineRow.rows[0].total ?? 0),
    busyMachines:  parseInt(machineRow.rows[0].busy  ?? 0),
    shippedLast30: parseInt(shippedRow.rows[0].shipped_30 ?? 0),
    avgLeadDays:   parseInt(shippedRow.rows[0].avg_lead   ?? 0),
    topWorkCenters: wcRows.rows.map((r) => ({
      name: r.name, openMoves: parseInt(r.open_moves), backlogHours: parseInt(r.backlog_hours),
    })),
    topScrapParts: scrapPartsRows.rows.map((r) => ({
      partNumber: r.part_number, partName: r.part_name,
      scrap: parseInt(r.scrap), orderQty: parseInt(r.order_qty),
    })),
  };
}
