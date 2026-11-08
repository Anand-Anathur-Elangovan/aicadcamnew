import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { utils, write } from "xlsx";
import { packetFromSheets, parseCsv } from "@/lib/sap/packet.mjs";
import { readSapPacket } from "@/lib/sap/loadPacket.mjs";

describe("SAP file packet", () => {
  it("keeps a comma that sits inside quotes", () => {
    const rows = parseCsv('part_number,part_name\nSP-900,"Plate, sample"\n');
    expect(rows[0].part_name).toBe("Plate, sample");
  });

  it("rejects a router status outside the shop list", () => {
    const { errors } = packetFromSheets({
      parts: [{ part_number: "SP-900", part_name: "Sample Plate", revision: "A", material: "Al", part_type: "prismatic" }],
      routers: [{
        router_no: "R-46001", part_number: "SP-900", order_qty: "10", qty_issued: "10",
        heat_lot: "H-1", status: "Open", due_on: "2026-11-20", released_on: "2026-11-06", sales_order: "SO-1",
      }],
      operations: [{ router_no: "R-46001", op_no: "10", op_name: "Saw", work_center: "Saw", standard_minutes: "40", status: "Done" }],
    });
    expect(errors.some((error) => error.includes("status"))).toBe(true);
  });

  it("rejects a move for a router that is not in the packet", () => {
    const { errors } = packetFromSheets({
      parts: [{ part_number: "SP-900", part_name: "Sample Plate", revision: "A", material: "Al", part_type: "prismatic" }],
      routers: [{
        router_no: "R-46001", part_number: "SP-900", order_qty: "10", qty_issued: "10",
        heat_lot: "H-1", status: "Running", due_on: "2026-11-20", released_on: "2026-11-06", sales_order: "SO-1",
      }],
      operations: [{ router_no: "R-46001", op_no: "10", op_name: "Saw", work_center: "Saw", standard_minutes: "40", status: "Done" }],
      moves: [{
        router_no: "R-99999", op_no: "10", machine_name: "SAW-AMADA-01", operator_name: "Nina Volkov",
        started_at: "2026-11-06T06:00:00Z", finished_at: "", qty_good: "1", qty_scrap: "0", qty_rework: "0",
        actual_minutes: "30", program_no: "",
      }],
    });
    expect(errors.some((error) => error.includes("R-99999"))).toBe(true);
  });

  it("reads the same columns from an Excel workbook", () => {
    const dir = mkdtempSync(join(tmpdir(), "sap-packet-"));
    const file = join(dir, "packet.xlsx");
    const book = utils.book_new();
    utils.book_append_sheet(book, utils.aoa_to_sheet([
      ["part_number", "part_name", "revision", "material", "part_type"],
      ["SP-900", "Sample Plate", "REV00", "Aluminium", "prismatic"],
    ]), "Parts");
    utils.book_append_sheet(book, utils.aoa_to_sheet([
      ["router_no", "part_number", "order_qty", "qty_issued", "heat_lot", "status", "due_on", "released_on", "sales_order"],
      ["R-46001", "SP-900", 10, 10, "H-9001", "Running", "2026-11-20", "2026-11-06", "SO-90001"],
    ]), "Routers");
    utils.book_append_sheet(book, utils.aoa_to_sheet([
      ["router_no", "op_no", "op_name", "work_center", "standard_minutes", "status"],
      ["R-46001", 10, "Saw", "Saw", 40, "Done"],
    ]), "Operations");
    writeFileSync(file, write(book, { type: "buffer", bookType: "xlsx" }));
    const { errors, packet } = readSapPacket(file);
    rmSync(dir, { recursive: true, force: true });
    expect(errors).toEqual([]);
    expect(packet.routers[0].routerNo).toBe("R-46001");
    expect(packet.operations[0].opNo).toBe(10);
  });
});
