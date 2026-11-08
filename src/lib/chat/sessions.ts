import { Pool } from "pg";
import type { ChatMessage, Citation } from "@/lib/types";
import { readEntities, type SessionEntities } from "@/lib/chat/memory";

declare const globalThis: { __pgPool?: Pool };

export function getPool(): Pool {
  if (!globalThis.__pgPool) {
    globalThis.__pgPool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return globalThis.__pgPool;
}

export interface PendingClarification {
  enhancedQuestion: string;
  rewrites: string[];
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  pendingClarification: PendingClarification | null;
  summary: string;
  entities: SessionEntities;
}

function mapPending(value: unknown): PendingClarification | null {
  if (!value || typeof value !== "object") return null;
  const pending = value as PendingClarification;
  if (typeof pending.enhancedQuestion !== "string") return null;
  return {
    enhancedQuestion: pending.enhancedQuestion,
    rewrites: Array.isArray(pending.rewrites) ? pending.rewrites.filter((item) => typeof item === "string") : [],
  };
}

function mapSession(row: {
  id: string;
  title: string;
  created_at: Date;
  updated_at: Date;
  pending_clarification?: unknown;
  memory_summary?: string | null;
  memory_entities?: unknown;
}): ChatSession {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    pendingClarification: mapPending(row.pending_clarification),
    summary: row.memory_summary ?? "",
    entities: readEntities(row.memory_entities),
  };
}

function mapMessage(row: {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[] | null;
  created_at: Date;
}): ChatMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    citations: row.citations ?? [],
    createdAt: row.created_at.toISOString(),
  };
}

export function sessionTitleFromQuestion(content: string): string {
  const oneLine = content.replace(/\s+/g, " ").trim();
  if (oneLine.length <= 80) return oneLine;
  return `${oneLine.slice(0, 77)}...`;
}

export async function createChatSession(): Promise<ChatSession> {
  const { rows } = await getPool().query(
    `INSERT INTO chat_sessions DEFAULT VALUES
     RETURNING id, title, created_at, updated_at`
  );
  return mapSession(rows[0]);
}

export async function listChatSessions(): Promise<ChatSession[]> {
  const { rows } = await getPool().query(
    `SELECT id, title, created_at, updated_at
     FROM chat_sessions
     ORDER BY updated_at DESC`
  );
  return rows.map(mapSession);
}

export async function getChatSession(id: string): Promise<ChatSession | null> {
  const { rows } = await getPool().query(
    `SELECT id, title, created_at, updated_at, pending_clarification, memory_summary, memory_entities
     FROM chat_sessions WHERE id = $1`,
    [id]
  );
  return rows[0] ? mapSession(rows[0]) : null;
}

export async function listChatMessages(sessionId: string): Promise<ChatMessage[]> {
  const { rows } = await getPool().query(
    `SELECT id, role, content, citations, created_at
     FROM chat_messages
     WHERE session_id = $1
     ORDER BY created_at ASC, id ASC`,
    [sessionId]
  );
  return rows.map(mapMessage);
}

export async function insertChatMessage(params: {
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
}): Promise<ChatMessage> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO chat_messages (session_id, role, content, citations)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING id, role, content, citations, created_at`,
      [params.sessionId, params.role, params.content, JSON.stringify(params.citations ?? [])]
    );
    await client.query(`UPDATE chat_sessions SET updated_at = now() WHERE id = $1`, [params.sessionId]);
    await client.query("COMMIT");
    return mapMessage(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function renameChatSession(id: string, title: string): Promise<void> {
  await getPool().query(
    `UPDATE chat_sessions SET title = $2, updated_at = now() WHERE id = $1`,
    [id, title]
  );
}

export async function setPendingClarification(
  sessionId: string,
  pending: PendingClarification | null
): Promise<void> {
  await getPool().query(
    `UPDATE chat_sessions SET pending_clarification = $2::jsonb, updated_at = now() WHERE id = $1`,
    [sessionId, pending ? JSON.stringify(pending) : null]
  );
}

export async function createChatTicket(params: {
  sessionId: string;
  originalQuestion: string;
  enhancedQuestion: string;
  rewrites: string[];
  errorMessage: string;
}): Promise<{ id: string }> {
  const { rows } = await getPool().query(
    `INSERT INTO chat_tickets (session_id, original_question, enhanced_question, rewrites, error_message)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     RETURNING id`,
    [
      params.sessionId,
      params.originalQuestion,
      params.enhancedQuestion,
      JSON.stringify(params.rewrites),
      params.errorMessage,
    ]
  );
  return { id: rows[0].id as string };
}

export async function setSessionMemory(
  sessionId: string,
  summary: string,
  entities: SessionEntities
): Promise<void> {
  await getPool().query(
    `UPDATE chat_sessions SET memory_summary = $2, memory_entities = $3::jsonb, updated_at = now() WHERE id = $1`,
    [sessionId, summary, JSON.stringify(entities)]
  );
}

export async function deleteChatSession(id: string): Promise<boolean> {
  const { rowCount } = await getPool().query(`DELETE FROM chat_sessions WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}
