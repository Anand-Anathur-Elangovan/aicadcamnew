import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { read as readXlsx, utils as xlsxUtils } from "xlsx";
import { SAP_SHEETS, packetFromSheets, parseCsv } from "./packet.mjs";

const stageFillSql = readFileSync(new URL("../../../scripts/db/shop_stage_fill.sql", import.meta.url), "utf8");

function sheetRows(matrix) {
  if (!matrix || matrix.length === 0) return [];
  const [header, ...body] = matrix;
  return body
    .filter((values) => values.some((value) => String(value ?? "").trim() !== ""))
    .map((values) => {
      const record = {};
      header.forEach((key, index) => {
        record[String(key).trim()] = values[index] == null ? "" : String(values[index]).trim();
      });
      return record;
    });
}

export function readSapPacket(filePath) {
  const info = statSync(filePath);
  const sheets = {};
  if (info.isDirectory()) {
    for (const name of SAP_SHEETS) {
      const csvPath = join(filePath, `${name}.csv`);
      try {
        sheets[name] = parseCsv(readFileSync(csvPath, "utf8"));
      } catch (err) {
        if (err && err.code === "ENOENT") sheets[name] = [];
        else throw err;
      }
    }
  } else if (extname(filePath).toLowerCase() === ".xlsx") {
    const book = readXlsx(readFileSync(filePath));
    const byName = new Map(book.SheetNames.map((name) => [name.toLowerCase(), name]));
    for (const name of SAP_SHEETS) {
      const sheetName = byName.get(name);
      sheets[name] = sheetName ? sheetRows(xlsxUtils.sheet_to_json(book.Sheets[sheetName], { header: 1, raw: false })) : [];
    }
  } else {
    throw new Error("SAP packet must be a folder of CSV files or an .xlsx workbook");
  }
  const unused = info.isDirectory()
    ? readdirSync(filePath).filter((name) => name.endsWith(".csv") && !SAP_SHEETS.includes(name.replace(/\.csv$/, "")))
    : [];
  if (unused.length > 0) throw new Error(`Unexpected CSV files: ${unused.join(", ")}`);
  return packetFromSheets(sheets);
}

async function upsertPart(client, part) {
  const { rows } = await client.query(
    `INSERT INTO shop_parts (part_number, part_name, revision, material, part_type)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (part_number) DO UPDATE
       SET part_name = EXCLUDED.part_name, revision = EXCLUDED.revision,
           material = EXCLUDED.material, part_type = EXCLUDED.part_type
     RETURNING id`,
    [part.partNumber, part.partName, part.revision, part.material, part.partType]
  );
  return rows[0].id;
}

async function upsertMachine(client, machine) {
  const { rows } = await client.query(
    `INSERT INTO shop_machines (name, work_center, controller, machine_type)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (name) DO UPDATE
       SET work_center = EXCLUDED.work_center, controller = EXCLUDED.controller, machine_type = EXCLUDED.machine_type
     RETURNING id`,
    [machine.name, machine.workCenter, machine.controller, machine.machineType]
  );
  return rows[0].id;
}

async function upsertOperator(client, operator) {
  const { rows } = await client.query(
    `INSERT INTO shop_operators (name, shift, department)
     VALUES ($1,$2,$3)
     ON CONFLICT (name) DO UPDATE SET shift = EXCLUDED.shift, department = EXCLUDED.department
     RETURNING id`,
    [operator.name, operator.shift, operator.department]
  );
  return rows[0].id;
}

async function existingId(client, table, column, value) {
  const { rows } = await client.query(`SELECT id FROM ${table} WHERE ${column} = $1`, [value]);
  return rows[0]?.id ?? null;
}

export async function loadSapPacket(client, packet) {
  const partIds = new Map();
  for (const part of packet.parts) partIds.set(part.partNumber, await upsertPart(client, part));
  const machineIds = new Map();
  for (const machine of packet.machines) machineIds.set(machine.name, await upsertMachine(client, machine));
  const operatorIds = new Map();
  for (const operator of packet.operators) operatorIds.set(operator.name, await upsertOperator(client, operator));

  const routerIds = new Map();
  for (const router of packet.routers) {
    let partId = partIds.get(router.partNumber);
    if (!partId) partId = await existingId(client, "shop_parts", "part_number", router.partNumber);
    if (!partId) throw new Error(`Unknown part ${router.partNumber} on router ${router.routerNo}`);
    const { rows } = await client.query(
      `INSERT INTO shop_routers
         (router_no, part_id, order_qty, qty_issued, heat_lot, status, due_on, released_on, sales_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (router_no) DO UPDATE SET
         part_id = EXCLUDED.part_id, order_qty = EXCLUDED.order_qty, qty_issued = EXCLUDED.qty_issued,
         heat_lot = EXCLUDED.heat_lot, status = EXCLUDED.status, due_on = EXCLUDED.due_on,
         released_on = EXCLUDED.released_on, sales_order = EXCLUDED.sales_order
       RETURNING id`,
      [router.routerNo, partId, router.orderQty, router.qtyIssued, router.heatLot, router.status, router.dueOn, router.releasedOn, router.salesOrder]
    );
    routerIds.set(router.routerNo, rows[0].id);
  }

  for (const routerId of routerIds.values()) {
    await client.query(`DELETE FROM shop_quality_events WHERE router_id = $1`, [routerId]);
    await client.query(`DELETE FROM shop_shipments WHERE router_id = $1`, [routerId]);
    await client.query(`DELETE FROM shop_operations WHERE router_id = $1`, [routerId]);
  }

  const operationIds = new Map();
  for (const operation of packet.operations) {
    const { rows } = await client.query(
      `INSERT INTO shop_operations (router_id, op_no, op_name, work_center, standard_minutes, status)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [routerIds.get(operation.routerNo), operation.opNo, operation.opName, operation.workCenter, operation.standardMinutes, operation.status]
    );
    operationIds.set(`${operation.routerNo}:${operation.opNo}`, rows[0].id);
  }

  async function machineId(name) {
    if (machineIds.has(name)) return machineIds.get(name);
    const id = await existingId(client, "shop_machines", "name", name);
    if (!id) throw new Error(`Unknown machine ${name}`);
    machineIds.set(name, id);
    return id;
  }
  async function operatorId(name) {
    if (operatorIds.has(name)) return operatorIds.get(name);
    const id = await existingId(client, "shop_operators", "name", name);
    if (!id) throw new Error(`Unknown operator ${name}`);
    operatorIds.set(name, id);
    return id;
  }

  for (const move of packet.moves) {
    const operationId = operationIds.get(`${move.routerNo}:${move.opNo}`);
    if (!operationId) throw new Error(`Move on ${move.routerNo} op ${move.opNo} has no operation row`);
    await client.query(
      `INSERT INTO shop_moves
         (operation_id, machine_id, operator_id, started_at, finished_at, qty_good, qty_scrap, qty_rework, actual_minutes, program_no)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        operationId,
        await machineId(move.machineName),
        await operatorId(move.operatorName),
        move.startedAt,
        move.finishedAt,
        move.qtyGood,
        move.qtyScrap,
        move.qtyRework,
        move.actualMinutes,
        move.programNo,
      ]
    );
  }

  for (const event of packet.quality) {
    const operationId = operationIds.get(`${event.routerNo}:${event.opNo}`);
    if (!operationId) throw new Error(`Quality event on ${event.routerNo} op ${event.opNo} has no operation row`);
    await client.query(
      `INSERT INTO shop_quality_events
         (router_id, operation_id, event_type, result, reason, inspector_name, recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [routerIds.get(event.routerNo), operationId, event.eventType, event.result, event.reason, event.inspectorName, event.recordedAt]
    );
  }

  for (const shipment of packet.shipments) {
    await client.query(
      `INSERT INTO shop_shipments (router_id, shipped_on, qty_shipped, packing_list, sales_order)
       VALUES ($1,$2,$3,$4,$5)`,
      [routerIds.get(shipment.routerNo), shipment.shippedOn, shipment.qtyShipped, shipment.packingList, shipment.salesOrder]
    );
  }

  await client.query(stageFillSql);
  const loaded = [...routerIds.keys()];
  const check = await client.query(
    `SELECT r.router_no,
            (r.order_qty = b.qty_running + b.qty_waiting + b.qty_scrap + b.qty_finished + b.qty_shipped) AS balanced,
            COALESCE((
              SELECT string_agg(s.stage_name || ' ' || s.qty::text, ', ' ORDER BY s.stage_name)
              FROM shop_v_stages s WHERE s.router_no = r.router_no AND s.is_current
            ), '') AS where_now
     FROM shop_routers r
     JOIN shop_v_job_balance b ON b.router_no = r.router_no
     WHERE r.router_no = ANY($1::text[])
     ORDER BY r.router_no`,
    [loaded]
  );
  const unbalanced = check.rows.filter((row) => row.balanced !== true).map((row) => row.router_no);
  if (unbalanced.length > 0) {
    throw new Error(`Quantity does not add up for ${unbalanced.join(", ")}`);
  }
  return check.rows.map((row) => ({ routerNo: row.router_no, whereNow: row.where_now }));
}
