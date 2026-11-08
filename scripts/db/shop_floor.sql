-- Shop-floor router dataset for Ask AI.
-- Eight tables: parts, machines, operators, routers, operations, moves, quality, shipments.
-- Heat and issued quantity sit on the router (one raw-material issue per job).
-- The DNC machine registry in phase3 is a separate table and is not used here.

CREATE TABLE IF NOT EXISTS shop_parts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_number  TEXT NOT NULL UNIQUE,
  part_name    TEXT NOT NULL,
  revision     TEXT NOT NULL,
  material     TEXT NOT NULL,
  part_type    TEXT NOT NULL CHECK (part_type IN ('prismatic', 'rotational'))
);

CREATE TABLE IF NOT EXISTS shop_machines (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,
  work_center   TEXT NOT NULL,
  controller    TEXT NOT NULL,
  machine_type  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shop_operators (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  shift       TEXT NOT NULL,
  department  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shop_routers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  router_no     TEXT NOT NULL UNIQUE,
  part_id       UUID NOT NULL REFERENCES shop_parts(id),
  order_qty     INTEGER NOT NULL CHECK (order_qty > 0),
  qty_issued    INTEGER NOT NULL CHECK (qty_issued > 0),
  heat_lot      TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('Released', 'Running', 'Inspection', 'Finished', 'Shipped')),
  due_on        DATE NOT NULL,
  released_on   DATE NOT NULL,
  sales_order   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shop_routers_part ON shop_routers(part_id);
CREATE INDEX IF NOT EXISTS idx_shop_routers_status ON shop_routers(status);

CREATE TABLE IF NOT EXISTS shop_operations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  router_id         UUID NOT NULL REFERENCES shop_routers(id) ON DELETE CASCADE,
  op_no             INTEGER NOT NULL,
  op_name           TEXT NOT NULL,
  work_center       TEXT NOT NULL,
  standard_minutes  INTEGER NOT NULL CHECK (standard_minutes > 0),
  status            TEXT NOT NULL CHECK (status IN ('Waiting', 'Running', 'Done')),
  UNIQUE (router_id, op_no)
);

CREATE INDEX IF NOT EXISTS idx_shop_operations_router ON shop_operations(router_id);

CREATE TABLE IF NOT EXISTS shop_moves (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id    UUID NOT NULL REFERENCES shop_operations(id) ON DELETE CASCADE,
  machine_id      UUID NOT NULL REFERENCES shop_machines(id),
  operator_id     UUID NOT NULL REFERENCES shop_operators(id),
  started_at      TIMESTAMPTZ NOT NULL,
  finished_at     TIMESTAMPTZ,
  qty_good        INTEGER NOT NULL DEFAULT 0 CHECK (qty_good >= 0),
  qty_scrap       INTEGER NOT NULL DEFAULT 0 CHECK (qty_scrap >= 0),
  qty_rework      INTEGER NOT NULL DEFAULT 0 CHECK (qty_rework >= 0),
  actual_minutes  INTEGER CHECK (actual_minutes IS NULL OR actual_minutes >= 0),
  program_no      TEXT
);

CREATE INDEX IF NOT EXISTS idx_shop_moves_operation ON shop_moves(operation_id);
CREATE INDEX IF NOT EXISTS idx_shop_moves_machine_time ON shop_moves(machine_id, started_at);
CREATE INDEX IF NOT EXISTS idx_shop_moves_operator_time ON shop_moves(operator_id, started_at);

CREATE TABLE IF NOT EXISTS shop_quality_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  router_id       UUID NOT NULL REFERENCES shop_routers(id) ON DELETE CASCADE,
  operation_id    UUID REFERENCES shop_operations(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL CHECK (event_type IN ('in_process', 'final', 'ncr')),
  result          TEXT NOT NULL CHECK (result IN ('accept', 'reject', 'rework')),
  reason          TEXT,
  inspector_name  TEXT NOT NULL,
  recorded_at     TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shop_quality_router ON shop_quality_events(router_id);

CREATE TABLE IF NOT EXISTS shop_shipments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  router_id     UUID NOT NULL REFERENCES shop_routers(id) ON DELETE CASCADE,
  shipped_on    DATE NOT NULL,
  qty_shipped   INTEGER NOT NULL CHECK (qty_shipped > 0),
  packing_list  TEXT NOT NULL,
  sales_order   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shop_shipments_router ON shop_shipments(router_id);
CREATE INDEX IF NOT EXISTS idx_shop_shipments_date ON shop_shipments(shipped_on);

-- Where the live quantity sits, plus the stages the batch has already passed.
-- is_current rows are the only pieces still in the shop. Passed rows are history.
CREATE TABLE IF NOT EXISTS shop_router_stages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  router_id    UUID NOT NULL REFERENCES shop_routers(id) ON DELETE CASCADE,
  stage_name   TEXT NOT NULL,
  op_no        INTEGER,
  qty          INTEGER NOT NULL CHECK (qty >= 0),
  is_current   BOOLEAN NOT NULL,
  vendor_name  TEXT,
  UNIQUE (router_id, stage_name, is_current)
);

CREATE INDEX IF NOT EXISTS idx_shop_router_stages_router ON shop_router_stages(router_id);
CREATE INDEX IF NOT EXISTS idx_shop_router_stages_current ON shop_router_stages(is_current);
