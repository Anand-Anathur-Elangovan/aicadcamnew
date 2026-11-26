-- Machine alarm log
-- Run once in Supabase SQL editor.
-- Stores CNC/NCK alarm events from any controller brand.

CREATE TABLE IF NOT EXISTS machine_alarms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  machine_id      TEXT NOT NULL,          -- e.g. "VMC-01", "LATHE-03"
  controller      TEXT NOT NULL DEFAULT 'unknown',  -- "Siemens 840D", "Fanuc 31i", etc.
  alarm_code      TEXT NOT NULL,          -- e.g. "NCK25201", "ALM-0300"
  severity        TEXT NOT NULL DEFAULT 'warning'
                    CHECK (severity IN ('info','warning','fault','emergency')),
  description     TEXT NOT NULL,
  axis            TEXT,                   -- optional axis e.g. "X", "Z", "spindle"
  program_name    TEXT,                   -- G-code program active at time of alarm
  operator        TEXT,
  acknowledged    BOOLEAN NOT NULL DEFAULT false,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by TEXT,
  raw             JSONB                   -- original payload from the machine
);

CREATE INDEX IF NOT EXISTS machine_alarms_machine_idx    ON machine_alarms (machine_id);
CREATE INDEX IF NOT EXISTS machine_alarms_occurred_idx   ON machine_alarms (occurred_at DESC);
CREATE INDEX IF NOT EXISTS machine_alarms_severity_idx   ON machine_alarms (severity);
CREATE INDEX IF NOT EXISTS machine_alarms_code_idx       ON machine_alarms (alarm_code);
CREATE INDEX IF NOT EXISTS machine_alarms_ack_idx        ON machine_alarms (acknowledged);

-- Full-text search across description + alarm_code
ALTER TABLE machine_alarms
  ADD COLUMN IF NOT EXISTS fts tsvector
    GENERATED ALWAYS AS (
      to_tsvector('english', coalesce(alarm_code,'') || ' ' || coalesce(description,''))
    ) STORED;

CREATE INDEX IF NOT EXISTS machine_alarms_fts_idx ON machine_alarms USING gin(fts);
