import { getPool } from "@/lib/chat/sessions";
import { diffGCode } from "@/lib/feedback/diffEngine";

export interface GCodeRevision {
  id: string;
  createdAt: string;
  programName: string;
  routerNo: string | null;
  partNumber: string | null;
  machine: string | null;
  controller: string | null;
  source: "ai_generated" | "manual" | "imported" | "approved";
  note: string | null;
  author: string | null;
  content: string;
}

function mapRow(r: Record<string, unknown>): GCodeRevision {
  return {
    id:          r.id as string,
    createdAt:   r.created_at as string,
    programName: r.program_name as string,
    routerNo:    (r.router_no   as string) ?? null,
    partNumber:  (r.part_number as string) ?? null,
    machine:     (r.machine     as string) ?? null,
    controller:  (r.controller  as string) ?? null,
    source:      r.source       as GCodeRevision["source"],
    note:        (r.note        as string) ?? null,
    author:      (r.author      as string) ?? null,
    content:     r.content      as string,
  };
}

export async function saveRevision(params: {
  programName: string;
  content: string;
  routerNo?: string;
  partNumber?: string;
  machine?: string;
  controller?: string;
  source?: GCodeRevision["source"];
  note?: string;
  author?: string;
}): Promise<string> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO gcode_revisions
       (program_name, content, router_no, part_number, machine, controller, source, note, author)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id`,
    [
      params.programName,
      params.content,
      params.routerNo   ?? null,
      params.partNumber ?? null,
      params.machine    ?? null,
      params.controller ?? null,
      params.source     ?? "manual",
      params.note       ?? null,
      params.author     ?? null,
    ],
  );
  return rows[0].id as string;
}

export async function listRevisions(programName: string): Promise<Omit<GCodeRevision, "content">[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, created_at, program_name, router_no, part_number,
            machine, controller, source, note, author
     FROM gcode_revisions
     WHERE program_name = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [programName],
  );
  return rows.map((r) => mapRow({ ...r, content: "" }));
}

export async function getRevision(id: string): Promise<GCodeRevision | null> {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT * FROM gcode_revisions WHERE id = $1`, [id]);
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function deleteRevision(id: string): Promise<void> {
  const pool = getPool();
  await pool.query(`DELETE FROM gcode_revisions WHERE id = $1`, [id]);
}

export async function compareRevisions(idA: string, idB: string) {
  const [a, b] = await Promise.all([getRevision(idA), getRevision(idB)]);
  if (!a || !b) throw new Error("One or both revisions not found");
  const diff = diffGCode(a.content, b.content);
  return { from: { id: a.id, createdAt: a.createdAt, source: a.source, note: a.note },
           to:   { id: b.id, createdAt: b.createdAt, source: b.source, note: b.note },
           diff };
}
