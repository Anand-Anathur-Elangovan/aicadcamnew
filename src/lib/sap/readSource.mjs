import { packetFromSheets } from "./packet.mjs";
import { SAP_SOURCE_SQL, assertReadOnlySelect } from "./sourceSql.mjs";

function textCell(value) {
  if (value == null) return "";
  return String(value).trim();
}

export async function readSapDatabase(client) {
  await client.query("BEGIN READ ONLY");
  try {
    const sheets = {};
    for (const [name, sql] of Object.entries(SAP_SOURCE_SQL)) {
      const result = await client.query(assertReadOnlySelect(sql));
      sheets[name] = result.rows.map((row) => {
        const record = {};
        for (const [key, value] of Object.entries(row)) record[key] = textCell(value);
        return record;
      });
    }
    await client.query("COMMIT");
    return packetFromSheets(sheets);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}
