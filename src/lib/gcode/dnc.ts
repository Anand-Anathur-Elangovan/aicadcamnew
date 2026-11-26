/**
 * DNC certification helpers.
 * Records that a G-code program has been dry-run and proved-out on the machine.
 */
import { getPool } from "@/lib/chat/sessions";

export type CertResult = "pass" | "conditional_pass" | "fail";

export interface CertInput {
  revision_id?:   string;
  program_name:   string;
  router_no?:     string;
  part_number?:   string;
  machine_id:     string;
  controller?:    string;
  operator:       string;
  result:         CertResult;
  dry_run_cycles?: number;
  note?:          string;
  issues?:        string;
}

export interface Certification {
  id:             string;
  created_at:     string;
  revision_id?:   string;
  program_name:   string;
  router_no?:     string;
  part_number?:   string;
  machine_id:     string;
  controller?:    string;
  operator:       string;
  result:         CertResult;
  dry_run_cycles: number;
  note?:          string;
  issues?:        string;
  certified_at:   string;
}

export async function certifyRevision(input: CertInput): Promise<Certification> {
  const pool = getPool();
  const res = await pool.query<Certification>(
    `INSERT INTO dnc_certifications
       (revision_id, program_name, router_no, part_number, machine_id, controller,
        operator, result, dry_run_cycles, note, issues)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      input.revision_id ?? null,
      input.program_name,
      input.router_no ?? null,
      input.part_number ?? null,
      input.machine_id,
      input.controller ?? null,
      input.operator,
      input.result,
      input.dry_run_cycles ?? 1,
      input.note ?? null,
      input.issues ?? null,
    ]
  );
  return res.rows[0];
}

/** Latest certification for a program (or revision) */
export async function getLatestCert(programName: string, revisionId?: string): Promise<Certification | null> {
  const pool = getPool();
  const conditions = revisionId
    ? "program_name = $1 AND revision_id = $2"
    : "program_name = $1";
  const params = revisionId ? [programName, revisionId] : [programName];
  const res = await pool.query<Certification>(
    `SELECT * FROM dnc_certifications WHERE ${conditions} ORDER BY certified_at DESC LIMIT 1`,
    params
  );
  return res.rows[0] ?? null;
}

/** All certifications for a program */
export async function listCertifications(programName: string): Promise<Certification[]> {
  const pool = getPool();
  const res = await pool.query<Certification>(
    "SELECT * FROM dnc_certifications WHERE program_name = $1 ORDER BY certified_at DESC LIMIT 20",
    [programName]
  );
  return res.rows;
}
