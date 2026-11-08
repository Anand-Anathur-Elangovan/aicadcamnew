/** The only statements sent to the SAP database. Each one is a single read. */

export const SAP_SOURCE_SQL = {
  parts: `SELECT part_number, part_name, revision, material, part_type FROM sap.parts`,
  machines: `SELECT name, work_center, controller, machine_type FROM sap.machines`,
  operators: `SELECT name, shift, department FROM sap.operators`,
  routers: `SELECT router_no, part_number, order_qty, qty_issued, heat_lot, status, due_on, released_on, sales_order FROM sap.routers`,
  operations: `SELECT router_no, op_no, op_name, work_center, standard_minutes, status FROM sap.operations`,
  moves: `SELECT router_no, op_no, machine_name, operator_name, started_at, finished_at, qty_good, qty_scrap, qty_rework, actual_minutes, program_no FROM sap.moves`,
  quality: `SELECT router_no, op_no, event_type, result, reason, inspector_name, recorded_at FROM sap.quality`,
  shipments: `SELECT router_no, shipped_on, qty_shipped, packing_list, sales_order FROM sap.shipments`,
};

export function assertReadOnlySelect(sql) {
  const text = String(sql).trim();
  if (!/^select\b/i.test(text)) throw new Error("SAP source statement must be a SELECT");
  if (text.includes(";")) throw new Error("SAP source statement must be a single SELECT");
  if (/\b(insert|update|delete|drop|alter|truncate|grant|revoke|copy|create|comment|execute|call|do)\b/i.test(text)) {
    throw new Error("SAP source statement must be read only");
  }
  return text;
}
