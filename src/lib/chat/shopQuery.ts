import { Pool } from "pg";

declare const globalThis: { __pgPool?: Pool };

const ALLOWED_VIEWS = ["shop_v_labor", "shop_v_job_balance", "shop_v_quality", "shop_v_machines", "shop_v_stages"];

function getPool(): Pool {
  if (!globalThis.__pgPool) {
    globalThis.__pgPool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return globalThis.__pgPool;
}

export function extractSql(raw: string): string {
  const fenced = raw.match(/```sql\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : raw).trim();
}

export function guardShopSql(raw: string): string {
  const withoutTrailing = raw.trim().replace(/;+\s*$/, "");
  if (!withoutTrailing) throw new Error("Empty shop query");
  if (withoutTrailing.includes(";")) throw new Error("Shop query must be a single statement");
  if (!/^select\b/i.test(withoutTrailing)) throw new Error("Shop query must be a SELECT");
  if (/--|\/\*|\*\//.test(withoutTrailing)) throw new Error("Shop query cannot contain comments");
  if (/\b(insert|update|delete|drop|alter|truncate|grant|revoke|copy|create|comment|execute|call|do|set|reset|vacuum|into|pg_|information_schema|dblink)\b/i.test(withoutTrailing)) {
    throw new Error("Shop query uses a forbidden keyword");
  }
  if (/shop_(?!v_)/i.test(withoutTrailing)) throw new Error("Shop query must use the views, not the base tables");
  const used = withoutTrailing.match(/\bshop_v_[a-z_]+\b/gi) ?? [];
  if (used.length === 0 || used.some((name) => !ALLOWED_VIEWS.includes(name.toLowerCase()))) {
    throw new Error("Shop query must read only the shop views");
  }
  const limited = withoutTrailing.replace(/\blimit\s+\d+\b/i, "LIMIT 50");
  return /\blimit\s+50\b/i.test(limited) ? limited : `${limited} LIMIT 50`;
}

export async function runShopSelect(raw: string): Promise<Record<string, unknown>[]> {
  const sql = guardShopSql(extractSql(raw));
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '8000'");
    const result = await client.query(sql);
    await client.query("COMMIT");
    return result.rows as Record<string, unknown>[];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export const SHOP_VIEW_GUIDE = `
shop_v_labor: move_id, router_no, part_number, part_name, revision, material, op_no, op_name, work_center, standard_minutes, standard_hours, actual_minutes, actual_hours, started_at, finished_at, is_running, qty_good, qty_scrap, qty_rework, program_no, operator_name, shift, machine_name, controller, machine_type
shop_v_job_balance: router_no, part_number, part_name, revision, material, status, order_qty, qty_issued, heat_lot, due_on, released_on, sales_order, qty_scrap, qty_rework_loops, qty_running, qty_waiting, qty_finished, qty_shipped, shipped_on
shop_v_quality: quality_id, router_no, part_number, part_name, op_no, op_name, event_type, result, reason, inspector_name, recorded_at
shop_v_machines: machine_name, work_center, controller, machine_type
shop_v_stages: router_no, part_number, part_name, revision, stage_name, op_no, qty, is_current, vendor_name, heat_lot, router_status. is_current true means the pieces are at that stage now. Sum only those rows for a current count. is_current false is a stage the batch has already passed and must not be added into pieces still on the router. Outside process is stage_name = 'Outside process' and names the vendor. Finished goods and Shipped are stages. Stores is the raw-material stage before the first operation.
`.trim();
