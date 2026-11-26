/**
 * Machine alarm log — ingest + query helpers.
 *
 * Supported input formats:
 *   1. Structured JSON (MES / DNC export)
 *   2. Plain-text CNC log lines   e.g. "2024-03-01T08:12:00 VMC-01 NCK25201 FAULT Feed axis X: position error"
 *   3. Siemens alarm CSV          (timestamp, machine, alarm_no, text)
 */
import { getPool } from "@/lib/chat/sessions";

/* ── Types ────────────────────────────────────────────────────────────── */
export type AlarmSeverity = "info" | "warning" | "fault" | "emergency";

export interface AlarmRecord {
  id: string;
  occurred_at: string;        // ISO
  machine_id: string;
  controller: string;
  alarm_code: string;
  severity: AlarmSeverity;
  description: string;
  axis?: string;
  program_name?: string;
  operator?: string;
  acknowledged: boolean;
  acknowledged_at?: string;
  acknowledged_by?: string;
}

export interface AlarmInput {
  occurred_at?: string;
  machine_id: string;
  controller?: string;
  alarm_code: string;
  severity?: AlarmSeverity;
  description: string;
  axis?: string;
  program_name?: string;
  operator?: string;
  raw?: Record<string, unknown>;
}

export interface AlarmFilters {
  machine_id?: string;
  severity?: AlarmSeverity;
  alarm_code?: string;
  acknowledged?: boolean;
  from?: string;   // ISO date
  to?: string;     // ISO date
  q?: string;      // full-text search
  limit?: number;
  offset?: number;
}

/* ── Insert ───────────────────────────────────────────────────────────── */
export async function insertAlarms(alarms: AlarmInput[]): Promise<number> {
  if (alarms.length === 0) return 0;
  const pool = getPool();

  let inserted = 0;
  for (const a of alarms) {
    await pool.query(
      `INSERT INTO machine_alarms
         (occurred_at, machine_id, controller, alarm_code, severity, description,
          axis, program_name, operator, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT DO NOTHING`,
      [
        a.occurred_at ?? new Date().toISOString(),
        a.machine_id,
        a.controller ?? "unknown",
        a.alarm_code,
        a.severity ?? "warning",
        a.description,
        a.axis ?? null,
        a.program_name ?? null,
        a.operator ?? null,
        a.raw ? JSON.stringify(a.raw) : null,
      ]
    );
    inserted++;
  }
  return inserted;
}

/* ── Parse plain-text log line ────────────────────────────────────────── */
// Format: 2024-03-01T08:12:00 VMC-01 NCK25201 FAULT Feed axis X: position error
const LOG_LINE_RE =
  /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?)\s+(\S+)\s+(\S+)\s+(INFO|WARNING|FAULT|EMERGENCY)\s+(.+)$/i;

export function parseTextLog(text: string): AlarmInput[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line): AlarmInput[] => {
      const m = LOG_LINE_RE.exec(line);
      if (!m) return [];
      return [{
        occurred_at:  new Date(m[1].replace(" ", "T")).toISOString(),
        machine_id:   m[2],
        alarm_code:   m[3],
        severity:     m[4].toLowerCase() as AlarmSeverity,
        description:  m[5],
      }];
    });
}

/* ── Parse Siemens CSV ────────────────────────────────────────────────── */
// Expected columns: Timestamp, Machine, AlarmNo, AlarmText[, Severity]
export function parseSiemensCSV(csv: string): AlarmInput[] {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const tIdx  = header.indexOf("timestamp");
  const mIdx  = header.indexOf("machine");
  const cIdx  = header.indexOf("alarmno");
  const dIdx  = header.indexOf("alarmtext");
  const sIdx  = header.indexOf("severity");
  if (tIdx < 0 || cIdx < 0) return [];

  return lines.slice(1).flatMap((row): AlarmInput[] => {
    const cols = row.split(",");
    return [{
      occurred_at:  tIdx >= 0 ? new Date(cols[tIdx]?.trim() ?? "").toISOString() : undefined,
      machine_id:   mIdx >= 0 ? (cols[mIdx]?.trim() ?? "unknown") : "unknown",
      controller:   "Siemens",
      alarm_code:   cols[cIdx]?.trim() ?? "UNKNOWN",
      severity:     (sIdx >= 0 ? cols[sIdx]?.trim().toLowerCase() : "warning") as AlarmSeverity,
      description:  dIdx >= 0 ? (cols[dIdx]?.trim() ?? "") : "",
    }];
  });
}

/* ── Query ────────────────────────────────────────────────────────────── */
export async function listAlarms(filters: AlarmFilters = {}): Promise<{
  alarms: AlarmRecord[];
  total: number;
}> {
  const pool  = getPool();
  const limit  = Math.min(filters.limit ?? 50, 200);
  const offset = filters.offset ?? 0;

  const conditions: string[] = [];
  const params: unknown[]    = [];
  let p = 1;

  if (filters.machine_id) { conditions.push(`machine_id = $${p++}`); params.push(filters.machine_id); }
  if (filters.severity)   { conditions.push(`severity   = $${p++}`); params.push(filters.severity); }
  if (filters.alarm_code) { conditions.push(`alarm_code ILIKE $${p++}`); params.push(`%${filters.alarm_code}%`); }
  if (filters.acknowledged !== undefined) { conditions.push(`acknowledged = $${p++}`); params.push(filters.acknowledged); }
  if (filters.from)       { conditions.push(`occurred_at >= $${p++}`); params.push(filters.from); }
  if (filters.to)         { conditions.push(`occurred_at <= $${p++}`); params.push(filters.to); }
  if (filters.q)          { conditions.push(`fts @@ plainto_tsquery('english', $${p++})`); params.push(filters.q); }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRes = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM machine_alarms ${where}`,
    params
  );
  const total = parseInt(countRes.rows[0]?.count ?? "0");

  const dataRes = await pool.query<AlarmRecord>(
    `SELECT id, occurred_at, machine_id, controller, alarm_code, severity, description,
            axis, program_name, operator, acknowledged, acknowledged_at, acknowledged_by
     FROM machine_alarms ${where}
     ORDER BY occurred_at DESC
     LIMIT $${p++} OFFSET $${p++}`,
    [...params, limit, offset]
  );

  return { alarms: dataRes.rows, total };
}

/* ── Acknowledge ──────────────────────────────────────────────────────── */
export async function acknowledgeAlarm(id: string, by: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE machine_alarms
     SET acknowledged = true, acknowledged_at = now(), acknowledged_by = $2
     WHERE id = $1`,
    [id, by]
  );
}

/* ── Summary stats ────────────────────────────────────────────────────── */
export async function alarmSummary(): Promise<{
  total: number;
  unacknowledged: number;
  bySeverity: Record<string, number>;
  byMachine: { machine_id: string; count: number }[];
  recentFaults: AlarmRecord[];
}> {
  const pool = getPool();

  const [totRes, unackRes, sevRes, machRes, recentRes] = await Promise.all([
    pool.query<{ count: string }>("SELECT COUNT(*) AS count FROM machine_alarms"),
    pool.query<{ count: string }>("SELECT COUNT(*) AS count FROM machine_alarms WHERE acknowledged = false"),
    pool.query<{ severity: string; count: string }>(
      "SELECT severity, COUNT(*) AS count FROM machine_alarms GROUP BY severity"
    ),
    pool.query<{ machine_id: string; count: string }>(
      "SELECT machine_id, COUNT(*) AS count FROM machine_alarms GROUP BY machine_id ORDER BY count DESC LIMIT 10"
    ),
    pool.query<AlarmRecord>(
      `SELECT id, occurred_at, machine_id, controller, alarm_code, severity, description, acknowledged
       FROM machine_alarms WHERE severity IN ('fault','emergency') AND acknowledged = false
       ORDER BY occurred_at DESC LIMIT 5`
    ),
  ]);

  const bySeverity: Record<string, number> = {};
  for (const row of sevRes.rows) bySeverity[row.severity] = parseInt(row.count);

  return {
    total:          parseInt(totRes.rows[0]?.count ?? "0"),
    unacknowledged: parseInt(unackRes.rows[0]?.count ?? "0"),
    bySeverity,
    byMachine:      machRes.rows.map((r) => ({ machine_id: r.machine_id, count: parseInt(r.count as unknown as string) })),
    recentFaults:   recentRes.rows,
  };
}
