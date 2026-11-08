-- Stand-in SAP source. The reader only SELECTs these tables.
-- Point SAP_DATABASE_URL at the plant database and change the SELECT list
-- in src/lib/sap/sourceSql.mjs if the plant table names differ.

CREATE SCHEMA IF NOT EXISTS sap;

CREATE TABLE IF NOT EXISTS sap.parts (
  part_number TEXT PRIMARY KEY,
  part_name TEXT NOT NULL,
  revision TEXT NOT NULL,
  material TEXT NOT NULL,
  part_type TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sap.machines (
  name TEXT PRIMARY KEY,
  work_center TEXT NOT NULL,
  controller TEXT NOT NULL,
  machine_type TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sap.operators (
  name TEXT PRIMARY KEY,
  shift TEXT NOT NULL,
  department TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sap.routers (
  router_no TEXT PRIMARY KEY,
  part_number TEXT NOT NULL,
  order_qty TEXT NOT NULL,
  qty_issued TEXT NOT NULL,
  heat_lot TEXT NOT NULL,
  status TEXT NOT NULL,
  due_on TEXT NOT NULL,
  released_on TEXT NOT NULL,
  sales_order TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sap.operations (
  router_no TEXT NOT NULL,
  op_no TEXT NOT NULL,
  op_name TEXT NOT NULL,
  work_center TEXT NOT NULL,
  standard_minutes TEXT NOT NULL,
  status TEXT NOT NULL,
  PRIMARY KEY (router_no, op_no)
);

CREATE TABLE IF NOT EXISTS sap.moves (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  router_no TEXT NOT NULL,
  op_no TEXT NOT NULL,
  machine_name TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL DEFAULT '',
  qty_good TEXT NOT NULL,
  qty_scrap TEXT NOT NULL,
  qty_rework TEXT NOT NULL,
  actual_minutes TEXT NOT NULL DEFAULT '',
  program_no TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sap.quality (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  router_no TEXT NOT NULL,
  op_no TEXT NOT NULL,
  event_type TEXT NOT NULL,
  result TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  inspector_name TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sap.shipments (
  packing_list TEXT PRIMARY KEY,
  router_no TEXT NOT NULL,
  shipped_on TEXT NOT NULL,
  qty_shipped TEXT NOT NULL,
  sales_order TEXT NOT NULL
);

INSERT INTO sap.parts (part_number, part_name, revision, material, part_type)
VALUES ('SP-901', 'Collar Sample', 'REV00', 'Aluminium 6061-T6', 'prismatic')
ON CONFLICT (part_number) DO NOTHING;

INSERT INTO sap.routers (router_no, part_number, order_qty, qty_issued, heat_lot, status, due_on, released_on, sales_order)
VALUES ('R-46002', 'SP-901', '8', '8', 'H-9002', 'Running', '2026-11-21', '2026-11-06', 'SO-90002')
ON CONFLICT (router_no) DO NOTHING;

INSERT INTO sap.operations (router_no, op_no, op_name, work_center, standard_minutes, status)
VALUES
  ('R-46002', '10', 'Saw', 'Saw', '30', 'Done'),
  ('R-46002', '20', 'CNC mill', 'Mill', '70', 'Running')
ON CONFLICT (router_no, op_no) DO NOTHING;

INSERT INTO sap.moves (router_no, op_no, machine_name, operator_name, started_at, finished_at, qty_good, qty_scrap, qty_rework, actual_minutes, program_no)
SELECT 'R-46002', '10', 'SAW-AMADA-01', 'Nina Volkov', '2026-11-06T08:00:00Z', '2026-11-06T08:40:00Z', '8', '0', '0', '40', ''
WHERE NOT EXISTS (SELECT 1 FROM sap.moves WHERE router_no = 'R-46002' AND op_no = '10');

INSERT INTO sap.moves (router_no, op_no, machine_name, operator_name, started_at, finished_at, qty_good, qty_scrap, qty_rework, actual_minutes, program_no)
SELECT 'R-46002', '20', 'HAAS-VF2-01', 'Anita Rao', '2026-11-07T04:30:00Z', '', '0', '0', '0', '', 'O46002'
WHERE NOT EXISTS (SELECT 1 FROM sap.moves WHERE router_no = 'R-46002' AND op_no = '20');
