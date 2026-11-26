-- DNC / dry-run certification table.
-- Links a G-code revision to a certification event (operator proved-out the program).
-- Run once in Supabase SQL editor.

CREATE TABLE IF NOT EXISTS dnc_certifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  revision_id     UUID REFERENCES gcode_revisions(id) ON DELETE SET NULL,
  program_name    TEXT NOT NULL,
  router_no       TEXT,
  part_number     TEXT,
  machine_id      TEXT NOT NULL,
  controller      TEXT,
  operator        TEXT NOT NULL,
  result          TEXT NOT NULL DEFAULT 'pass'
                    CHECK (result IN ('pass','conditional_pass','fail')),
  dry_run_cycles  INTEGER NOT NULL DEFAULT 1,
  note            TEXT,
  issues          TEXT,     -- any issues found during dry-run
  certified_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dnc_cert_program_idx  ON dnc_certifications (program_name);
CREATE INDEX IF NOT EXISTS dnc_cert_machine_idx  ON dnc_certifications (machine_id);
CREATE INDEX IF NOT EXISTS dnc_cert_created_idx  ON dnc_certifications (created_at DESC);
