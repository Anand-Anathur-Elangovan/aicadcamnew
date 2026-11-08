import { getPool } from "@/lib/chat/sessions";

export interface RouterListItem {
  routerNo: string;
  partNumber: string;
  partName: string;
  revision: string;
  status: string;
  orderQty: number;
  qtyRunning: number;
  qtyWaiting: number;
  qtyScrap: number;
  qtyFinished: number;
  qtyShipped: number;
  dueOn: string;
  whereNow: string;
}

export interface RouterDetail {
  routerNo: string;
  partNumber: string;
  partName: string;
  revision: string;
  material: string;
  status: string;
  orderQty: number;
  qtyIssued: number;
  heatLot: string;
  dueOn: string;
  releasedOn: string;
  salesOrder: string;
  qtyScrap: number;
  qtyReworkLoops: number;
  qtyRunning: number;
  qtyWaiting: number;
  qtyFinished: number;
  qtyShipped: number;
  shippedOn: string | null;
  operations: RouterOperation[];
  quality: RouterQuality[];
  shipments: RouterShipment[];
  stages: RouterStage[];
}

export interface RouterStage {
  stageName: string;
  opNo: number | null;
  qty: number;
  isCurrent: boolean;
  vendorName: string | null;
}

export interface RouterOperation {
  opNo: number;
  opName: string;
  workCenter: string;
  standardMinutes: number;
  status: string;
  moves: RouterMove[];
}

export interface RouterMove {
  machineName: string;
  operatorName: string;
  startedAt: string;
  finishedAt: string | null;
  actualMinutes: number | null;
  qtyGood: number;
  qtyScrap: number;
  qtyRework: number;
  programNo: string | null;
  isRunning: boolean;
}

export interface RouterQuality {
  opNo: number | null;
  opName: string | null;
  eventType: string;
  result: string;
  reason: string | null;
  inspectorName: string;
  recordedAt: string;
}

export interface RouterShipment {
  shippedOn: string;
  qtyShipped: number;
  packingList: string;
  salesOrder: string;
}

const STATUSES = ["Released", "Running", "Inspection", "Finished", "Shipped"] as const;

export function quantityAddsUp(row: {
  orderQty: number;
  qtyRunning: number;
  qtyWaiting: number;
  qtyScrap: number;
  qtyFinished: number;
  qtyShipped: number;
}): boolean {
  return row.orderQty === row.qtyRunning + row.qtyWaiting + row.qtyScrap + row.qtyFinished + row.qtyShipped;
}

function num(value: unknown): number {
  return Number(value ?? 0);
}

function textDate(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function textTime(value: unknown): string {
  if (value == null) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  return date.toISOString();
}

export async function listRouters(query: string, status: string): Promise<RouterListItem[]> {
  const safeStatus = STATUSES.includes(status as (typeof STATUSES)[number]) ? status : "";
  const result = await getPool().query(
    `SELECT b.router_no, b.part_number, b.part_name, b.revision, b.status, b.order_qty,
            b.qty_running, b.qty_waiting, b.qty_scrap, b.qty_finished, b.qty_shipped, b.due_on::text AS due_on,
            COALESCE((
              SELECT string_agg(s.stage_name || ' ' || s.qty::text, ', ' ORDER BY s.op_no NULLS LAST, s.stage_name)
              FROM shop_v_stages s
              WHERE s.router_no = b.router_no AND s.is_current
            ), '') AS where_now
     FROM shop_v_job_balance b
     WHERE ($1 = '' OR b.router_no ILIKE '%' || $1 || '%' OR b.part_number ILIKE '%' || $1 || '%' OR b.part_name ILIKE '%' || $1 || '%')
       AND ($2 = '' OR b.status = $2)
     ORDER BY b.router_no
     LIMIT 100`,
    [query.trim(), safeStatus]
  );
  return result.rows.map((row) => ({
    routerNo: row.router_no,
    partNumber: row.part_number,
    partName: row.part_name,
    revision: row.revision,
    status: row.status,
    orderQty: num(row.order_qty),
    qtyRunning: num(row.qty_running),
    qtyWaiting: num(row.qty_waiting),
    qtyScrap: num(row.qty_scrap),
    qtyFinished: num(row.qty_finished),
    qtyShipped: num(row.qty_shipped),
    dueOn: textDate(row.due_on),
    whereNow: row.where_now ?? "",
  }));
}

export async function getRouter(routerNo: string): Promise<RouterDetail | null> {
  const pool = getPool();
  const header = await pool.query(
    `SELECT router_no, part_number, part_name, revision, material, status, order_qty, qty_issued,
            heat_lot, due_on::text AS due_on, released_on::text AS released_on, sales_order,
            qty_scrap, qty_rework_loops, qty_running, qty_waiting, qty_finished, qty_shipped,
            shipped_on::text AS shipped_on
     FROM shop_v_job_balance
     WHERE router_no = $1`,
    [routerNo]
  );
  const row = header.rows[0];
  if (!row) return null;

  const [operations, moves, quality, shipments, stages] = await Promise.all([
    pool.query(
      `SELECT o.op_no, o.op_name, o.work_center, o.standard_minutes, o.status
       FROM shop_operations o
       JOIN shop_routers r ON r.id = o.router_id
       WHERE r.router_no = $1
       ORDER BY o.op_no`,
      [routerNo]
    ),
    pool.query(
      `SELECT op_no, machine_name, operator_name, started_at, finished_at, actual_minutes,
              qty_good, qty_scrap, qty_rework, program_no, is_running
       FROM shop_v_labor
       WHERE router_no = $1
       ORDER BY op_no, started_at`,
      [routerNo]
    ),
    pool.query(
      `SELECT op_no, op_name, event_type, result, reason, inspector_name, recorded_at
       FROM shop_v_quality
       WHERE router_no = $1
       ORDER BY recorded_at`,
      [routerNo]
    ),
    pool.query(
      `SELECT s.shipped_on::text AS shipped_on, s.qty_shipped, s.packing_list, s.sales_order
       FROM shop_shipments s
       JOIN shop_routers r ON r.id = s.router_id
       WHERE r.router_no = $1
       ORDER BY s.shipped_on`,
      [routerNo]
    ),
    pool.query(
      `SELECT stage_name, op_no, qty, is_current, vendor_name
       FROM shop_v_stages
       WHERE router_no = $1
       ORDER BY is_current DESC, op_no NULLS FIRST, stage_name`,
      [routerNo]
    ),
  ]);

  const movesByOp = new Map<number, RouterMove[]>();
  for (const move of moves.rows) {
    const opNo = num(move.op_no);
    const list = movesByOp.get(opNo) ?? [];
    list.push({
      machineName: move.machine_name,
      operatorName: move.operator_name,
      startedAt: textTime(move.started_at),
      finishedAt: move.finished_at ? textTime(move.finished_at) : null,
      actualMinutes: move.actual_minutes == null ? null : num(move.actual_minutes),
      qtyGood: num(move.qty_good),
      qtyScrap: num(move.qty_scrap),
      qtyRework: num(move.qty_rework),
      programNo: move.program_no,
      isRunning: Boolean(move.is_running),
    });
    movesByOp.set(opNo, list);
  }

  return {
    routerNo: row.router_no,
    partNumber: row.part_number,
    partName: row.part_name,
    revision: row.revision,
    material: row.material,
    status: row.status,
    orderQty: num(row.order_qty),
    qtyIssued: num(row.qty_issued),
    heatLot: row.heat_lot,
    dueOn: textDate(row.due_on),
    releasedOn: textDate(row.released_on),
    salesOrder: row.sales_order,
    qtyScrap: num(row.qty_scrap),
    qtyReworkLoops: num(row.qty_rework_loops),
    qtyRunning: num(row.qty_running),
    qtyWaiting: num(row.qty_waiting),
    qtyFinished: num(row.qty_finished),
    qtyShipped: num(row.qty_shipped),
    shippedOn: row.shipped_on ? textDate(row.shipped_on) : null,
    operations: operations.rows.map((op) => ({
      opNo: num(op.op_no),
      opName: op.op_name,
      workCenter: op.work_center,
      standardMinutes: num(op.standard_minutes),
      status: op.status,
      moves: movesByOp.get(num(op.op_no)) ?? [],
    })),
    quality: quality.rows.map((event) => ({
      opNo: event.op_no == null ? null : num(event.op_no),
      opName: event.op_name,
      eventType: event.event_type,
      result: event.result,
      reason: event.reason,
      inspectorName: event.inspector_name,
      recordedAt: textTime(event.recorded_at),
    })),
    shipments: shipments.rows.map((shipment) => ({
      shippedOn: textDate(shipment.shipped_on),
      qtyShipped: num(shipment.qty_shipped),
      packingList: shipment.packing_list,
      salesOrder: shipment.sales_order,
    })),
    stages: stages.rows.map((stage) => ({
      stageName: stage.stage_name,
      opNo: stage.op_no == null ? null : num(stage.op_no),
      qty: num(stage.qty),
      isCurrent: Boolean(stage.is_current),
      vendorName: stage.vendor_name,
    })),
  };
}
