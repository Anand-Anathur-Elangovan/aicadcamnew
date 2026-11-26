/**
 * Self-correction & training data persistence.
 * Talks to the same Postgres pool used by chat/sessions.
 */
import { getPool } from "@/lib/chat/sessions";

export interface FeedbackRow {
  id: string;
  createdAt: string;
  sessionId: string | null;
  messageId: string | null;
  question: string;
  answer: string;
  citations: unknown[];
  rating: 1 | -1 | null;
  correction: string | null;
  correctionNote: string | null;
  status: "pending" | "approved" | "rejected" | "exported";
  reviewedBy: string | null;
  reviewedAt: string | null;
  exportedAt: string | null;
}

function mapRow(r: Record<string, unknown>): FeedbackRow {
  return {
    id: r.id as string,
    createdAt: r.created_at as string,
    sessionId: (r.session_id as string) ?? null,
    messageId: (r.message_id as string) ?? null,
    question: r.question as string,
    answer: r.answer as string,
    citations: (r.citations as unknown[]) ?? [],
    rating: (r.rating as 1 | -1) ?? null,
    correction: (r.correction as string) ?? null,
    correctionNote: (r.correction_note as string) ?? null,
    status: r.status as FeedbackRow["status"],
    reviewedBy: (r.reviewed_by as string) ?? null,
    reviewedAt: (r.reviewed_at as string) ?? null,
    exportedAt: (r.exported_at as string) ?? null,
  };
}

/** Save a thumbs-up / thumbs-down from the user. */
export async function insertFeedback(params: {
  sessionId: string | null;
  messageId: string;
  question: string;
  answer: string;
  citations: unknown[];
  rating: 1 | -1;
}): Promise<string> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO chat_feedback
       (session_id, message_id, question, answer, citations, rating)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     RETURNING id`,
    [
      params.sessionId,
      params.messageId,
      params.question,
      params.answer,
      JSON.stringify(params.citations),
      params.rating,
    ],
  );
  return rows[0].id as string;
}

/** List feedback rows with optional filters. */
export async function listFeedback(params?: {
  status?: string;
  rating?: number;
  limit?: number;
  offset?: number;
}): Promise<{ rows: FeedbackRow[]; total: number }> {
  const pool = getPool();
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (params?.status && params.status !== "all") {
    conditions.push(`status = $${values.length + 1}`);
    values.push(params.status);
  }
  if (params?.rating !== undefined && params.rating !== 0) {
    conditions.push(`rating = $${values.length + 1}`);
    values.push(params.rating);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = params?.limit ?? 50;
  const offset = params?.offset ?? 0;

  const [data, count] = await Promise.all([
    pool.query(
      `SELECT * FROM chat_feedback ${where} ORDER BY created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset],
    ),
    pool.query(`SELECT COUNT(*) FROM chat_feedback ${where}`, values),
  ]);

  return {
    rows: data.rows.map(mapRow),
    total: parseInt(count.rows[0].count as string),
  };
}

/** SME: approve + optionally add correction. */
export async function reviewFeedback(params: {
  id: string;
  status: "approved" | "rejected";
  correction?: string;
  correctionNote?: string;
  reviewedBy?: string;
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE chat_feedback
     SET status=$1, correction=$2, correction_note=$3,
         reviewed_by=$4, reviewed_at=now()
     WHERE id=$5`,
    [
      params.status,
      params.correction ?? null,
      params.correctionNote ?? null,
      params.reviewedBy ?? "admin",
      params.id,
    ],
  );
}

/** Export approved rows as JSONL (OpenAI fine-tune format) or CSV. */
export async function exportApproved(format: "jsonl" | "csv"): Promise<string> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM chat_feedback WHERE status='approved' ORDER BY created_at`,
  );
  const items = rows.map(mapRow);

  // Mark as exported
  if (items.length > 0) {
    await pool.query(
      `UPDATE chat_feedback SET status='exported', exported_at=now() WHERE status='approved'`,
    );
  }

  if (format === "jsonl") {
    return items
      .map((r) => {
        const answer = r.correction ?? r.answer;
        return JSON.stringify({
          messages: [
            { role: "system", content: "You are an expert Manufacturing AI assistant." },
            { role: "user", content: r.question },
            { role: "assistant", content: answer },
          ],
        });
      })
      .join("\n");
  }

  // CSV
  const header = "id,created_at,question,answer,correction,correction_note,rating,reviewed_by";
  const csvRows = items.map((r) => {
    const esc = (s: string | null) => `"${(s ?? "").replace(/"/g, '""')}"`;
    return [r.id, r.createdAt, esc(r.question), esc(r.correction ?? r.answer), esc(r.correction), esc(r.correctionNote), r.rating ?? "", r.reviewedBy ?? ""].join(",");
  });
  return [header, ...csvRows].join("\n");
}
