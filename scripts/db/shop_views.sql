-- The only shop surfaces Ask AI may query. One row meanings are fixed here.
-- Run after shop_floor.sql and the seed.

CREATE OR REPLACE VIEW shop_v_labor AS
SELECT
  m.id AS move_id,
  r.router_no,
  p.part_number,
  p.part_name,
  p.revision,
  p.material,
  o.op_no,
  o.op_name,
  o.work_center,
  o.standard_minutes,
  ROUND(o.standard_minutes / 60.0, 2) AS standard_hours,
  m.actual_minutes,
  ROUND(COALESCE(m.actual_minutes, 0) / 60.0, 2) AS actual_hours,
  m.started_at,
  m.finished_at,
  (m.finished_at IS NULL) AS is_running,
  m.qty_good,
  m.qty_scrap,
  m.qty_rework,
  m.program_no,
  op.name AS operator_name,
  op.shift,
  mac.name AS machine_name,
  mac.controller,
  mac.machine_type
FROM shop_moves m
JOIN shop_operations o ON o.id = m.operation_id
JOIN shop_routers r ON r.id = o.router_id
JOIN shop_parts p ON p.id = r.part_id
JOIN shop_operators op ON op.id = m.operator_id
JOIN shop_machines mac ON mac.id = m.machine_id;

CREATE OR REPLACE VIEW shop_v_quality AS
SELECT
  q.id AS quality_id,
  r.router_no,
  p.part_number,
  p.part_name,
  o.op_no,
  o.op_name,
  q.event_type,
  q.result,
  q.reason,
  q.inspector_name,
  q.recorded_at
FROM shop_quality_events q
JOIN shop_routers r ON r.id = q.router_id
JOIN shop_parts p ON p.id = r.part_id
LEFT JOIN shop_operations o ON o.id = q.operation_id;

CREATE OR REPLACE VIEW shop_v_machines AS
SELECT
  name AS machine_name,
  work_center,
  controller,
  machine_type
FROM shop_machines;

CREATE OR REPLACE VIEW shop_v_job_balance AS
WITH move_totals AS (
  SELECT
    o.router_id,
    COALESCE(SUM(m.qty_scrap), 0)::int AS qty_scrap,
    COALESCE(SUM(m.qty_rework), 0)::int AS qty_rework_loops,
    COUNT(*) FILTER (WHERE m.finished_at IS NULL)::int AS open_moves
  FROM shop_operations o
  JOIN shop_moves m ON m.operation_id = o.id
  GROUP BY o.router_id
),
last_done AS (
  SELECT DISTINCT ON (o.router_id)
    o.router_id,
    m.qty_good
  FROM shop_operations o
  JOIN shop_moves m ON m.operation_id = o.id
  WHERE o.status = 'Done' AND m.finished_at IS NOT NULL
  ORDER BY o.router_id, o.op_no DESC
),
shipped AS (
  SELECT router_id, COALESCE(SUM(qty_shipped), 0)::int AS qty_shipped, MAX(shipped_on) AS shipped_on
  FROM shop_shipments
  GROUP BY router_id
)
SELECT
  r.router_no,
  p.part_number,
  p.part_name,
  p.revision,
  p.material,
  r.status,
  r.order_qty,
  r.qty_issued,
  r.heat_lot,
  r.due_on,
  r.released_on,
  r.sales_order,
  COALESCE(t.qty_scrap, 0) AS qty_scrap,
  COALESCE(t.qty_rework_loops, 0) AS qty_rework_loops,
  CASE
    WHEN COALESCE(t.open_moves, 0) > 0 THEN COALESCE(d.qty_good, r.order_qty)
    ELSE 0
  END AS qty_running,
  CASE
    WHEN r.status = 'Released' THEN r.order_qty
    WHEN r.status = 'Inspection' THEN COALESCE(d.qty_good, 0)
    ELSE 0
  END AS qty_waiting,
  CASE
    WHEN r.status = 'Finished' THEN COALESCE(d.qty_good, 0)
    ELSE 0
  END AS qty_finished,
  CASE
    WHEN r.status = 'Shipped' THEN COALESCE(s.qty_shipped, 0)
    ELSE 0
  END AS qty_shipped,
  CASE
    WHEN r.status = 'Shipped' THEN s.shipped_on
    ELSE NULL
  END AS shipped_on
FROM shop_routers r
JOIN shop_parts p ON p.id = r.part_id
LEFT JOIN move_totals t ON t.router_id = r.id
LEFT JOIN last_done d ON d.router_id = r.id
LEFT JOIN shipped s ON s.router_id = r.id;

CREATE OR REPLACE VIEW shop_v_stages AS
SELECT
  r.router_no,
  p.part_number,
  p.part_name,
  p.revision,
  s.stage_name,
  s.op_no,
  s.qty,
  s.is_current,
  s.vendor_name,
  r.heat_lot,
  r.status AS router_status
FROM shop_router_stages s
JOIN shop_routers r ON r.id = s.router_id
JOIN shop_parts p ON p.id = r.part_id;
