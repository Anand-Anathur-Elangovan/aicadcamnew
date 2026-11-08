-- Ask AI session history. Full transcript per session. Run after init.sql.

CREATE TABLE IF NOT EXISTS chat_sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title      TEXT NOT NULL DEFAULT 'New chat',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT NOT NULL,
  citations  JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at ASC);

ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS pending_clarification JSONB;
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS memory_summary TEXT NOT NULL DEFAULT '';
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS memory_entities JSONB NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS chat_tickets (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id          UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  original_question   TEXT NOT NULL,
  enhanced_question   TEXT,
  rewrites            JSONB NOT NULL DEFAULT '[]',
  error_message       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_tickets_session ON chat_tickets(session_id, created_at DESC);
