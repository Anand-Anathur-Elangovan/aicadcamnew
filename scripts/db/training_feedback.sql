-- Self-correction & training feedback tables.
-- Run this in your Supabase SQL editor (or psql) after chat_sessions.sql.

-- ─── Feedback on individual assistant messages ───────────────────────────────
CREATE TABLE IF NOT EXISTS chat_feedback (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id      UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
  message_id      UUID,                      -- client-side message UUID
  question        TEXT NOT NULL,             -- the user turn
  answer          TEXT NOT NULL,             -- the assistant turn
  citations       JSONB NOT NULL DEFAULT '[]',
  rating          SMALLINT CHECK (rating IN (-1, 1)),  -- -1 thumbs down, 1 thumbs up
  correction      TEXT,                      -- SME's corrected answer (nullable)
  correction_note TEXT,                      -- reason / note from reviewer
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected','exported')),
  reviewed_by     TEXT,                      -- reviewer name / email
  reviewed_at     TIMESTAMPTZ,
  exported_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_feedback_status    ON chat_feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_created   ON chat_feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_session   ON chat_feedback(session_id);
CREATE INDEX IF NOT EXISTS idx_feedback_rating    ON chat_feedback(rating);

-- ─── Fine-tune export batches ────────────────────────────────────────────────
-- Each batch is a snapshot of approved feedback rows in JSONL / OpenAI format.
CREATE TABLE IF NOT EXISTS training_batches (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   TEXT,
  row_count    INT NOT NULL DEFAULT 0,
  format       TEXT NOT NULL DEFAULT 'jsonl' CHECK (format IN ('jsonl','csv')),
  notes        TEXT,
  exported_at  TIMESTAMPTZ
);
