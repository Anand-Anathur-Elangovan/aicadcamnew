/** Column contract for a SAP file export. One workbook sheet or one CSV per name. */

export const SAP_SHEETS = ["parts", "machines", "operators", "routers", "operations", "moves", "quality", "shipments"];

const REQUIRED = {
  parts: ["part_number", "part_name", "revision", "material", "part_type"],
  machines: ["name", "work_center", "controller", "machine_type"],
  operators: ["name", "shift", "department"],
  routers: ["router_no", "part_number", "order_qty", "qty_issued", "heat_lot", "status", "due_on", "released_on", "sales_order"],
  operations: ["router_no", "op_no", "op_name", "work_center", "standard_minutes", "status"],
  moves: ["router_no", "op_no", "machine_name", "operator_name", "started_at", "finished_at", "qty_good", "qty_scrap", "qty_rework", "actual_minutes", "program_no"],
  quality: ["router_no", "op_no", "event_type", "result", "reason", "inspector_name", "recorded_at"],
  shipments: ["router_no", "shipped_on", "qty_shipped", "packing_list", "sales_order"],
};

const ENUMS = {
  part_type: ["prismatic", "rotational"],
  status: {
    routers: ["Released", "Running", "Inspection", "Finished", "Shipped"],
    operations: ["Waiting", "Running", "Done"],
  },
  event_type: ["in_process", "final", "ncr"],
  result: ["accept", "reject", "rework"],
};

export function parseCsv(text) {
  const source = String(text).replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i += 1;
      row.push(cell.trim());
      cell = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    if (row.some((value) => value !== "")) rows.push(row);
  }
  if (rows.length === 0) return [];
  const header = rows[0];
  return rows.slice(1).map((values) => {
    const record = {};
    header.forEach((key, index) => {
      record[key] = values[index] ?? "";
    });
    return record;
  });
}

function blank(value) {
  return value == null || String(value).trim() === "";
}

function need(errors, sheet, rowNumber, record, column) {
  if (blank(record[column])) errors.push(`${sheet} row ${rowNumber}: ${column} is required`);
}

function integer(errors, sheet, rowNumber, record, column, { allowBlank = false } = {}) {
  if (blank(record[column])) {
    if (!allowBlank) errors.push(`${sheet} row ${rowNumber}: ${column} is required`);
    return null;
  }
  const value = Number(record[column]);
  if (!Number.isInteger(value)) errors.push(`${sheet} row ${rowNumber}: ${column} must be a whole number`);
  return value;
}

function oneOf(errors, sheet, rowNumber, record, column, allowed) {
  const value = String(record[column] ?? "").trim();
  if (!allowed.includes(value)) errors.push(`${sheet} row ${rowNumber}: ${column} must be ${allowed.join(", ")}`);
  return value;
}

export function packetFromSheets(sheets) {
  const errors = [];
  const present = Object.fromEntries(SAP_SHEETS.map((name) => [name, sheets[name] ?? []]));
  for (const name of ["parts", "routers", "operations"]) {
    if (present[name].length === 0) errors.push(`${name} sheet is required`);
  }
  for (const [name, rows] of Object.entries(present)) {
    rows.forEach((record, index) => {
      for (const column of REQUIRED[name]) {
        if (!(column in record)) errors.push(`${name} row ${index + 2}: missing column ${column}`);
      }
    });
  }

  const parts = present.parts.map((record, index) => {
    const rowNumber = index + 2;
    REQUIRED.parts.forEach((column) => need(errors, "parts", rowNumber, record, column));
    return {
      partNumber: String(record.part_number ?? "").trim(),
      partName: String(record.part_name ?? "").trim(),
      revision: String(record.revision ?? "").trim(),
      material: String(record.material ?? "").trim(),
      partType: oneOf(errors, "parts", rowNumber, record, "part_type", ENUMS.part_type),
    };
  });

  const machines = present.machines.map((record, index) => {
    const rowNumber = index + 2;
    REQUIRED.machines.forEach((column) => need(errors, "machines", rowNumber, record, column));
    return {
      name: String(record.name ?? "").trim(),
      workCenter: String(record.work_center ?? "").trim(),
      controller: String(record.controller ?? "").trim(),
      machineType: String(record.machine_type ?? "").trim(),
    };
  });

  const operators = present.operators.map((record, index) => {
    const rowNumber = index + 2;
    REQUIRED.operators.forEach((column) => need(errors, "operators", rowNumber, record, column));
    return {
      name: String(record.name ?? "").trim(),
      shift: String(record.shift ?? "").trim(),
      department: String(record.department ?? "").trim(),
    };
  });

  const routers = present.routers.map((record, index) => {
    const rowNumber = index + 2;
    ["router_no", "part_number", "heat_lot", "due_on", "released_on", "sales_order"].forEach((column) => {
      need(errors, "routers", rowNumber, record, column);
    });
    return {
      routerNo: String(record.router_no ?? "").trim(),
      partNumber: String(record.part_number ?? "").trim(),
      orderQty: integer(errors, "routers", rowNumber, record, "order_qty"),
      qtyIssued: integer(errors, "routers", rowNumber, record, "qty_issued"),
      heatLot: String(record.heat_lot ?? "").trim(),
      status: oneOf(errors, "routers", rowNumber, record, "status", ENUMS.status.routers),
      dueOn: String(record.due_on ?? "").trim(),
      releasedOn: String(record.released_on ?? "").trim(),
      salesOrder: String(record.sales_order ?? "").trim(),
    };
  });

  const operations = present.operations.map((record, index) => {
    const rowNumber = index + 2;
    ["router_no", "op_name", "work_center"].forEach((column) => need(errors, "operations", rowNumber, record, column));
    return {
      routerNo: String(record.router_no ?? "").trim(),
      opNo: integer(errors, "operations", rowNumber, record, "op_no"),
      opName: String(record.op_name ?? "").trim(),
      workCenter: String(record.work_center ?? "").trim(),
      standardMinutes: integer(errors, "operations", rowNumber, record, "standard_minutes"),
      status: oneOf(errors, "operations", rowNumber, record, "status", ENUMS.status.operations),
    };
  });

  const moves = present.moves.map((record, index) => {
    const rowNumber = index + 2;
    ["router_no", "machine_name", "operator_name", "started_at"].forEach((column) => {
      need(errors, "moves", rowNumber, record, column);
    });
    return {
      routerNo: String(record.router_no ?? "").trim(),
      opNo: integer(errors, "moves", rowNumber, record, "op_no"),
      machineName: String(record.machine_name ?? "").trim(),
      operatorName: String(record.operator_name ?? "").trim(),
      startedAt: String(record.started_at ?? "").trim(),
      finishedAt: blank(record.finished_at) ? null : String(record.finished_at).trim(),
      qtyGood: integer(errors, "moves", rowNumber, record, "qty_good"),
      qtyScrap: integer(errors, "moves", rowNumber, record, "qty_scrap"),
      qtyRework: integer(errors, "moves", rowNumber, record, "qty_rework"),
      actualMinutes: integer(errors, "moves", rowNumber, record, "actual_minutes", { allowBlank: true }),
      programNo: blank(record.program_no) ? null : String(record.program_no).trim(),
    };
  });

  const quality = present.quality.map((record, index) => {
    const rowNumber = index + 2;
    ["router_no", "inspector_name", "recorded_at"].forEach((column) => need(errors, "quality", rowNumber, record, column));
    return {
      routerNo: String(record.router_no ?? "").trim(),
      opNo: integer(errors, "quality", rowNumber, record, "op_no"),
      eventType: oneOf(errors, "quality", rowNumber, record, "event_type", ENUMS.event_type),
      result: oneOf(errors, "quality", rowNumber, record, "result", ENUMS.result),
      reason: blank(record.reason) ? null : String(record.reason).trim(),
      inspectorName: String(record.inspector_name ?? "").trim(),
      recordedAt: String(record.recorded_at ?? "").trim(),
    };
  });

  const shipments = present.shipments.map((record, index) => {
    const rowNumber = index + 2;
    ["router_no", "shipped_on", "packing_list", "sales_order"].forEach((column) => {
      need(errors, "shipments", rowNumber, record, column);
    });
    return {
      routerNo: String(record.router_no ?? "").trim(),
      shippedOn: String(record.shipped_on ?? "").trim(),
      qtyShipped: integer(errors, "shipments", rowNumber, record, "qty_shipped"),
      packingList: String(record.packing_list ?? "").trim(),
      salesOrder: String(record.sales_order ?? "").trim(),
    };
  });

  const routerNos = new Set(routers.map((router) => router.routerNo));
  for (const row of [...operations, ...moves, ...quality, ...shipments]) {
    if (row.routerNo && !routerNos.has(row.routerNo)) {
      errors.push(`router ${row.routerNo} is used but is not on the routers sheet`);
    }
  }

  return {
    errors: [...new Set(errors)],
    packet: { parts, machines, operators, routers, operations, moves, quality, shipments },
  };
}
