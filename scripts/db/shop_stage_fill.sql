-- Rebuild stage rows from the routers, operations, and job balance already loaded.
-- Current rows are where pieces sit now. Passed rows are stages already completed.
-- For one router, current quantities add up to order quantity minus scrap.

DELETE FROM shop_router_stages;

INSERT INTO shop_router_stages (router_id, stage_name, op_no, qty, is_current, vendor_name)
SELECT r.id, 'Stores', NULL, r.qty_issued, (r.status = 'Released'), NULL
FROM shop_routers r;

INSERT INTO shop_router_stages (router_id, stage_name, op_no, qty, is_current, vendor_name)
SELECT r.id, o.op_name, o.op_no, COALESCE(SUM(m.qty_good), 0)::int, false, NULL
FROM shop_routers r
JOIN shop_operations o ON o.router_id = r.id AND o.status = 'Done'
LEFT JOIN shop_moves m ON m.operation_id = o.id
GROUP BY r.id, o.op_name, o.op_no;

INSERT INTO shop_router_stages (router_id, stage_name, op_no, qty, is_current, vendor_name)
SELECT r.id, o.op_name, o.op_no, b.qty_running, true, NULL
FROM shop_routers r
JOIN shop_v_job_balance b ON b.router_no = r.router_no
JOIN shop_operations o ON o.router_id = r.id AND o.status = 'Running'
WHERE r.status = 'Running' AND b.qty_running > 0;

INSERT INTO shop_router_stages (router_id, stage_name, op_no, qty, is_current, vendor_name)
SELECT
  hold.router_id,
  'In-process inspect',
  40,
  hold.qty_waiting - hold.outside_qty,
  true,
  NULL
FROM (
  SELECT
    r.id AS router_id,
    b.qty_waiting,
    CASE
      WHEN b.qty_waiting > 4 THEN 2
      ELSE 0
    END AS outside_qty
  FROM shop_routers r
  JOIN shop_v_job_balance b ON b.router_no = r.router_no
  WHERE r.status = 'Inspection' AND b.qty_waiting > 0
) hold
WHERE hold.qty_waiting - hold.outside_qty > 0;

INSERT INTO shop_router_stages (router_id, stage_name, op_no, qty, is_current, vendor_name)
SELECT
  r.id,
  'Outside process',
  NULL,
  2,
  true,
  (ARRAY['HT-AeroVac', 'Plate-ChemTech', 'NDT-Magna'])[1 + (substring(r.router_no from 3)::int % 3)]
FROM shop_routers r
JOIN shop_v_job_balance b ON b.router_no = r.router_no
WHERE r.status = 'Inspection' AND b.qty_waiting > 4;

INSERT INTO shop_router_stages (router_id, stage_name, op_no, qty, is_current, vendor_name)
SELECT r.id, 'Finished goods', NULL, b.qty_finished, true, NULL
FROM shop_routers r
JOIN shop_v_job_balance b ON b.router_no = r.router_no
WHERE r.status = 'Finished' AND b.qty_finished > 0;

INSERT INTO shop_router_stages (router_id, stage_name, op_no, qty, is_current, vendor_name)
SELECT r.id, 'Shipped', NULL, b.qty_shipped, true, NULL
FROM shop_routers r
JOIN shop_v_job_balance b ON b.router_no = r.router_no
WHERE r.status = 'Shipped' AND b.qty_shipped > 0;
