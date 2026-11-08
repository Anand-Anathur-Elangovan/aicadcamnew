import { describe, expect, it } from "vitest";
import { SAP_SOURCE_SQL, assertReadOnlySelect } from "@/lib/sap/sourceSql.mjs";

describe("SAP database source", () => {
  it("allows only the fixed select list", () => {
    for (const sql of Object.values(SAP_SOURCE_SQL)) {
      expect(assertReadOnlySelect(sql)).toMatch(/^SELECT /);
    }
    expect(() => assertReadOnlySelect("DELETE FROM sap.routers")).toThrow(/SELECT/);
    expect(() => assertReadOnlySelect("SELECT 1; SELECT 2")).toThrow(/single/);
    expect(() => assertReadOnlySelect("SELECT 1 FROM sap.routers; DROP TABLE sap.routers")).toThrow(/single/);
  });
});
