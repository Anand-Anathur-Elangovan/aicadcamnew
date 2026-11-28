-- Machine & Tool Library
-- Run once in Supabase SQL editor

-- ─── Machines ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS machines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id  text UNIQUE NOT NULL,          -- e.g. "VMC-01"
  name        text NOT NULL,                 -- e.g. "Vertical Machining Centre 01"
  kind        text NOT NULL CHECK (kind IN ('vmc','lathe','lathe5','vmc5','grinder','edm','other')),
  controller  text NOT NULL DEFAULT 'fanuc', -- fanuc | siemens | haas | okuma
  x_travel    numeric,                       -- mm
  y_travel    numeric,
  z_travel    numeric,
  max_rpm     integer,
  tool_capacity integer DEFAULT 24,
  notes       text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── Tool Library ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tools (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_no     text NOT NULL,                 -- e.g. "T01"
  description text NOT NULL,                -- e.g. "Ø12 4-flute carbide endmill"
  kind        text NOT NULL CHECK (kind IN ('endmill','drill','boring','reamer','tap','insert','ball','chamfer','other')),
  diameter_mm numeric,
  length_mm   numeric,
  flutes      integer,
  material    text DEFAULT 'carbide',        -- carbide | hss | ceramic | cbn
  coating     text,                          -- TiN | TiAlN | uncoated
  max_rpm     integer,
  feed_per_tooth numeric,                    -- mm/tooth
  notes       text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── Machine–Tool assignments ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS machine_tools (
  machine_id  uuid NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  tool_id     uuid NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  pocket      integer,                       -- tool magazine pocket number
  PRIMARY KEY (machine_id, tool_id)
);

-- ─── Seed a default set for demo ────────────────────────────────────────────
INSERT INTO machines (machine_id, name, kind, controller, x_travel, y_travel, z_travel, max_rpm, tool_capacity) VALUES
  ('VMC-01', 'BFW VMC 850 – Bay 1',     'vmc',   'fanuc',   850, 500, 500, 10000, 24),
  ('VMC-02', 'Makino S33 – Bay 2',      'vmc',   'fanuc',   330, 300, 350, 20000, 30),
  ('LTH-01', 'Mori NL2500 Lathe',       'lathe', 'fanuc',   null, null, null, 4500, 12),
  ('LTH-02', 'Jyoti DX-200 Lathe',      'lathe', 'fanuc',   null, null, null, 4000, 8)
ON CONFLICT (machine_id) DO NOTHING;

INSERT INTO tools (tool_no, description, kind, diameter_mm, length_mm, flutes, material, coating, max_rpm, feed_per_tooth) VALUES
  ('T01', 'Ø12 4-flute flat endmill',   'endmill', 12,  75, 4, 'carbide', 'TiAlN', 10000, 0.03),
  ('T02', 'Ø6  4-flute flat endmill',   'endmill',  6,  57, 4, 'carbide', 'TiAlN', 15000, 0.02),
  ('T03', 'Ø20 face mill (3-insert)',   'insert',  20,  60, 3, 'carbide', 'TiAlN',  8000, 0.08),
  ('T04', 'Ø10 drill',                  'drill',   10,  87, 2, 'carbide', 'TiN',    6000, 0.05),
  ('T05', 'Ø8 drill',                   'drill',    8,  75, 2, 'carbide', 'TiN',    7000, 0.04),
  ('T06', 'Ø28 boring bar H7',          'boring',  28, 120, 1, 'carbide', 'uncoated', 3000, 0.02),
  ('T07', 'M12×1.75 tap',               'tap',     12,  80, 2, 'hss',    'TiN',    1000, null),
  ('T08', 'Ø6 ball endmill',            'ball',     6,  57, 4, 'carbide', 'TiAlN', 15000, 0.015),
  ('T09', '90° chamfer mill Ø12',       'chamfer', 12,  60, 4, 'carbide', 'TiAlN',  8000, 0.03),
  ('T10', 'Ø25 reamer H7',              'reamer',  25, 100, 6, 'carbide', 'uncoated', 800, 0.08)
ON CONFLICT DO NOTHING;
