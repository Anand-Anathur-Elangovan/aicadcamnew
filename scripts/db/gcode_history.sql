-- G-code revision history.
-- Run in Supabase SQL editor after init.sql.

CREATE TABLE IF NOT EXISTS gcode_revisions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Identity: how the program is linked to a job
  program_name TEXT NOT NULL,          -- e.g. "O1001" or a user label
  router_no    TEXT,                   -- optional link to a shop router
  part_number  TEXT,
  -- Content
  content      TEXT NOT NULL,          -- full G-code text
  machine      TEXT,                   -- machine / controller
  controller   TEXT,                   -- post-processor used
  -- Metadata
  source       TEXT NOT NULL DEFAULT 'manual'
                 CHECK (source IN ('ai_generated','manual','imported','approved')),
  note         TEXT,                   -- optional comment from the programmer
  author       TEXT                    -- name / email of who saved it
);

CREATE INDEX IF NOT EXISTS idx_gcode_rev_program ON gcode_revisions(program_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gcode_rev_router  ON gcode_revisions(router_no)   WHERE router_no IS NOT NULL;
