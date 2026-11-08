import { readFileSync } from "node:fs";
import pg from "pg";

// Clock the shop uses for "today", "last week", and "last month".
const TODAY = new Date("2026-11-07T06:30:00Z");
const ROUTER_COUNT = 100;

const parts = [
  ["WB-100", "Wall Bracket", "REV00", "Cast Steel", "prismatic"],
  ["WB-110", "Wall Bracket", "REV01", "Cast Steel", "prismatic"],
  ["MB-083", "Mounting Bracket", "A", "Aluminium 6061-T6", "prismatic"],
  ["MB-090", "Mounting Bracket", "B", "Aluminium 7075-T6", "prismatic"],
  ["CB-214", "Clevis Bracket", "C", "Stainless 15-5PH", "prismatic"],
  ["HB-330", "Hinge Bracket", "A", "Aluminium 2024-T3", "prismatic"],
  ["FB-118", "Flange Bracket", "B", "Carbon Steel 4140", "prismatic"],
  ["SP-501", "Support Plate", "A", "Aluminium 6061-T6", "prismatic"],
  ["CP-220", "Cover Plate", "A", "Aluminium 5052-H32", "prismatic"],
  ["HP-014", "Housing", "D", "Aluminium 7075-T6", "prismatic"],
  ["GH-077", "Gear Housing", "B", "Cast Iron", "prismatic"],
  ["VH-305", "Valve Housing", "A", "Stainless 316", "prismatic"],
  ["MF-642", "Manifold", "C", "Aluminium 6061-T6", "prismatic"],
  ["FT-019", "Fitting", "A", "Stainless 304", "rotational"],
  ["FT-027", "Fitting", "B", "Titanium 6Al-4V", "rotational"],
  ["AD-088", "Adapter", "A", "Stainless 17-4PH", "rotational"],
  ["PN-441", "Pin", "A", "Alloy Steel 4340", "rotational"],
  ["BS-256", "Bushing", "B", "Bronze", "rotational"],
  ["SH-073", "Shaft", "C", "Alloy Steel 4140", "rotational"],
  ["SL-390", "Sleeve", "A", "Stainless 303", "rotational"],
  ["RG-012", "Retaining Ring Groove Shaft", "A", "Alloy Steel 4340", "rotational"],
  ["NZ-155", "Nozzle", "B", "Stainless 316", "rotational"],
  ["CL-208", "Collar", "A", "Aluminium 6061-T6", "rotational"],
  ["TB-064", "Tube End", "A", "Titanium 6Al-4V", "rotational"],
];

const machines = [
  ["SAW-AMADA-01", "Saw", "Amada controller", "Band saw"],
  ["HAAS-VF2-01", "Mill", "Haas NGC", "Vertical mill"],
  ["HAAS-VF2-02", "Mill", "Haas NGC", "Vertical mill"],
  ["HAAS-VF4-01", "Mill", "Haas NGC", "Vertical mill"],
  ["DMG-CMX-01", "Mill", "Siemens 840D", "Vertical mill"],
  ["MAKINO-PS-01", "Mill", "Fanuc 31i", "Vertical mill"],
  ["MAZAK-QT-200", "Turn", "Mazatrol SmoothG", "CNC lathe"],
  ["DOOSAN-LYNX-01", "Turn", "Fanuc 0i-TF", "CNC lathe"],
  ["STUDER-S33-01", "Grind", "Fanuc 0i", "Cylindrical grinder"],
  ["DEBURR-CELL-01", "Deburr", "Manual cell", "Deburr bench"],
  ["CMM-ZEISS-01", "Inspect", "Calypso", "CMM"],
  ["PACK-BENCH-01", "Pack", "Manual bench", "Pack station"],
];

const operators = [
  ["Ravi Menon", "A", "Machining"],
  ["Anita Rao", "A", "Machining"],
  ["Joseph DSouza", "B", "Machining"],
  ["Mei Chen", "B", "Machining"],
  ["Arun Patel", "A", "Turning"],
  ["Sara Iqbal", "B", "Turning"],
  ["Luis Ortega", "C", "Turning"],
  ["Priya Nair", "A", "Quality"],
  ["Daniel Brooks", "B", "Quality"],
  ["Fatima Khan", "A", "Quality"],
  ["Owen Clarke", "A", "Finishing"],
  ["Harpreet Singh", "B", "Finishing"],
  ["Nina Volkov", "C", "Saw"],
  ["Kabir Shah", "A", "Saw"],
  ["Elena Petrov", "B", "Pack"],
  ["Marcus Hale", "A", "Pack"],
];

const PRISMATIC_OPS = [
  [10, "Saw", "Saw"],
  [20, "CNC mill", "Mill"],
  [30, "Deburr", "Deburr"],
  [40, "In-process inspect", "Inspect"],
  [50, "Finish mill", "Mill"],
  [60, "Final inspect", "Inspect"],
  [70, "Pack", "Pack"],
];
const ROTATIONAL_OPS = [
  [10, "Saw", "Saw"],
  [20, "CNC turn", "Turn"],
  [30, "Deburr", "Deburr"],
  [40, "In-process inspect", "Inspect"],
  [50, "Grind", "Grind"],
  [60, "Final inspect", "Inspect"],
  [70, "Pack", "Pack"],
];

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20261107);
const pick = (list) => list[Math.floor(rand() * list.length)];
const between = (min, max) => min + Math.floor(rand() * (max - min + 1));

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function atHour(date, hour, minute) {
  const next = new Date(date.getTime());
  next.setUTCHours(hour, minute, 0, 0);
  return next;
}

const env = readFileSync(new URL("../../.env", import.meta.url), "utf8");
const match = env.match(/^DATABASE_URL=(.*)$/m);
if (!match) throw new Error("DATABASE_URL missing");
const connectionString = match[1].trim().replace(/^["']|["']$/g, "");

const client = new pg.Client({ connectionString });
await client.connect();

try {
  await client.query("BEGIN");
  await client.query(readFileSync(new URL("./shop_floor.sql", import.meta.url), "utf8"));
  await client.query(`
    TRUNCATE shop_router_stages, shop_shipments, shop_quality_events, shop_moves, shop_operations,
             shop_routers, shop_operators, shop_machines, shop_parts RESTART IDENTITY CASCADE
  `);

  const partIds = [];
  for (const [partNumber, partName, revision, material, partType] of parts) {
    const { rows } = await client.query(
      `INSERT INTO shop_parts (part_number, part_name, revision, material, part_type)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [partNumber, partName, revision, material, partType]
    );
    partIds.push({ id: rows[0].id, partNumber, partName, partType });
  }

  const machineIds = {};
  for (const [name, workCenter, controller, machineType] of machines) {
    const { rows } = await client.query(
      `INSERT INTO shop_machines (name, work_center, controller, machine_type)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [name, workCenter, controller, machineType]
    );
    machineIds[workCenter] = machineIds[workCenter] ?? [];
    machineIds[workCenter].push({ id: rows[0].id, name });
  }

  const operatorIds = [];
  for (const [name, shift, department] of operators) {
    const { rows } = await client.query(
      `INSERT INTO shop_operators (name, shift, department) VALUES ($1,$2,$3) RETURNING id`,
      [name, shift, department]
    );
    operatorIds.push({ id: rows[0].id, name, department });
  }

  const operatorsFor = (workCenter) => {
    const department = {
      Saw: "Saw",
      Mill: "Machining",
      Turn: "Turning",
      Grind: "Turning",
      Deburr: "Finishing",
      Inspect: "Quality",
      Pack: "Pack",
    }[workCenter];
    const pool = operatorIds.filter((person) => person.department === department);
    return pool.length > 0 ? pool : operatorIds;
  };

  const wallBracket = partIds[0];
  let longHoursRouter = null;

  for (let index = 0; index < ROUTER_COUNT; index += 1) {
    const featured = index === 20;
    const part = featured ? wallBracket : partIds[index % partIds.length];
    const routerNo = `R-${45021 + index}`;
    const orderQty = featured ? 20 : between(8, 40);
    const releasedOn = featured
      ? new Date("2026-11-02T00:00:00Z")
      : addDays(new Date("2026-09-08T00:00:00Z"), index % 58);
    const dueOn = addDays(releasedOn, featured ? 12 : between(10, 25));
    const heat = `H-${2400 + (index % 36)}`;
    const salesOrder = `SO-${78000 + (index % 40)}`;
    const opPlan = part.partType === "rotational" ? ROTATIONAL_OPS : PRISMATIC_OPS;

    let status;
    let completedThrough;
    if (featured) {
      status = "Running";
      completedThrough = 2;
    } else if (index < 28) {
      status = "Shipped";
      completedThrough = opPlan.length;
    } else if (index < 40) {
      status = "Finished";
      completedThrough = opPlan.length;
    } else if (index < 52) {
      status = "Inspection";
      completedThrough = 4;
    } else if (index < 92) {
      status = "Running";
      completedThrough = between(1, 4);
    } else {
      status = "Released";
      completedThrough = 0;
    }

    const { rows: routerRows } = await client.query(
      `INSERT INTO shop_routers
         (router_no, part_id, order_qty, qty_issued, heat_lot, status, due_on, released_on, sales_order)
       VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [routerNo, part.id, orderQty, heat, status, dueOn, releasedOn, salesOrder]
    );
    const routerId = routerRows[0].id;

    let qtyRemaining = orderQty;
    let cursor = atHour(releasedOn, 6, 15);
    const operationIds = [];

    for (let opIndex = 0; opIndex < opPlan.length; opIndex += 1) {
      const [opNo, opName, workCenter] = opPlan[opIndex];
      const standardMinutes = 25 + orderQty * (workCenter === "Mill" || workCenter === "Turn" ? 6 : 2);
      let opStatus = "Waiting";
      if (opIndex < completedThrough) opStatus = "Done";
      else if (opIndex === completedThrough && status === "Running") opStatus = "Running";
      else if (status === "Inspection" && opIndex === 3) opStatus = "Done";

      const { rows: opRows } = await client.query(
        `INSERT INTO shop_operations (router_id, op_no, op_name, work_center, standard_minutes, status)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [routerId, opNo, opName, workCenter, standardMinutes, opStatus]
      );
      const operationId = opRows[0].id;
      operationIds.push(operationId);

      const shouldMove = opIndex < completedThrough || opStatus === "Running";
      if (!shouldMove) continue;

      const machine = pick(machineIds[workCenter]);
      const person = workCenter === "Mill" && index % 5 === 0
        ? operatorIds[0]
        : pick(operatorsFor(workCenter));
      const open = opStatus === "Running";
      const scrap = !open && opIndex === 1 && index % 7 === 0 ? between(1, 2) : 0;
      const good = open ? 0 : Math.max(qtyRemaining - scrap, 0);
      if (!open) qtyRemaining = good;

      let actualMinutes = Math.round(standardMinutes * (0.85 + rand() * 0.35));
      let startedAt = new Date(cursor.getTime());
      if (startedAt > TODAY) startedAt = addDays(TODAY, -1);
      const isLongWallBracket = featured && opNo === 20;
      if (isLongWallBracket) {
        actualMinutes = standardMinutes * 2 + 120;
        longHoursRouter = routerNo;
        startedAt = new Date("2026-11-03T01:00:00Z");
      }
      if (open) startedAt = new Date(TODAY.getTime() - 2 * 60 * 60 * 1000);
      if (!open && startedAt.getTime() + actualMinutes * 60 * 1000 > TODAY.getTime()) {
        actualMinutes = Math.max(30, Math.round((TODAY.getTime() - startedAt.getTime()) / 60000) - 30);
      }
      const closedAt = open ? null : new Date(startedAt.getTime() + actualMinutes * 60 * 1000);

      await client.query(
        `INSERT INTO shop_moves
           (operation_id, machine_id, operator_id, started_at, finished_at, qty_good, qty_scrap, qty_rework, actual_minutes, program_no)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          operationId,
          machine.id,
          person.id,
          startedAt,
          closedAt,
          good,
          open ? 0 : scrap,
          isLongWallBracket ? 3 : 0,
          open ? null : actualMinutes,
          workCenter === "Mill" || workCenter === "Turn" ? `O${routerNo.slice(2)}` : null,
        ]
      );

      if (scrap > 0) {
        await client.query(
          `INSERT INTO shop_quality_events
             (router_id, operation_id, event_type, result, reason, inspector_name, recorded_at)
           VALUES ($1,$2,'ncr','reject',$3,$4,$5)`,
          [routerId, operationId, "Dimension out of tolerance", pick(operatorsFor("Inspect")).name, closedAt]
        );
      }
      if (isLongWallBracket) {
        await client.query(
          `INSERT INTO shop_quality_events
             (router_id, operation_id, event_type, result, reason, inspector_name, recorded_at)
           VALUES ($1,$2,'in_process','rework','Op 20 reworked three times, no downtime code booked',$3,$4)`,
          [routerId, operationId, "Priya Nair", closedAt]
        );
      }
      if ((opNo === 40 || opNo === 60) && opStatus === "Done" && scrap === 0) {
        await client.query(
          `INSERT INTO shop_quality_events
             (router_id, operation_id, event_type, result, reason, inspector_name, recorded_at)
           VALUES ($1,$2,$3,'accept',NULL,$4,$5)`,
          [routerId, operationId, opNo === 60 ? "final" : "in_process", pick(operatorsFor("Inspect")).name, closedAt]
        );
      }

      cursor = closedAt ? new Date(closedAt.getTime() + 30 * 60 * 1000) : new Date(TODAY.getTime() - 2 * 60 * 60 * 1000);
    }

    if (status === "Shipped") {
      const shipQty = qtyRemaining;
      const shippedOn = addDays(releasedOn, between(8, 20));
      const shipDate = shippedOn > TODAY ? addDays(TODAY, -2) : shippedOn;
      await client.query(
        `INSERT INTO shop_shipments (router_id, shipped_on, qty_shipped, packing_list, sales_order)
         VALUES ($1,$2,$3,$4,$5)`,
        [routerId, shipDate, shipQty, `PL-${routerNo}`, salesOrder]
      );
    }
  }

  await client.query(readFileSync(new URL("./shop_views.sql", import.meta.url), "utf8"));
  await client.query(readFileSync(new URL("./shop_stage_fill.sql", import.meta.url), "utf8"));

  const counts = await client.query(`
    SELECT 'shop_parts' AS table_name, count(*) FROM shop_parts
    UNION ALL SELECT 'shop_machines', count(*) FROM shop_machines
    UNION ALL SELECT 'shop_operators', count(*) FROM shop_operators
    UNION ALL SELECT 'shop_routers', count(*) FROM shop_routers
    UNION ALL SELECT 'shop_operations', count(*) FROM shop_operations
    UNION ALL SELECT 'shop_moves', count(*) FROM shop_moves
    UNION ALL SELECT 'shop_quality_events', count(*) FROM shop_quality_events
    UNION ALL SELECT 'shop_shipments', count(*) FROM shop_shipments
    UNION ALL SELECT 'shop_router_stages', count(*) FROM shop_router_stages
    ORDER BY table_name
  `);
  const total = counts.rows.reduce((sum, row) => sum + Number(row.count), 0);
  if (total < 800) throw new Error(`dataset has ${total} rows, need at least 800`);
  if (!longHoursRouter) throw new Error("long-hours Wall Bracket router was not created");

  await client.query("COMMIT");
  console.log(JSON.stringify({ total, longHoursRouter, counts: counts.rows }, null, 2));
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  await client.end();
}
