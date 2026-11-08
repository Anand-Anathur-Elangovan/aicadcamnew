import { readFileSync } from "node:fs";
import pg from "pg";
import { loadSapPacket, readSapPacket } from "../../src/lib/sap/loadPacket.mjs";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: node scripts/sap/load_packet.mjs <folder-of-csv-or-xlsx>");
  process.exit(1);
}

const env = readFileSync(new URL("../../.env", import.meta.url), "utf8");
const connectionString = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
if (!connectionString) throw new Error("DATABASE_URL missing");

const { errors, packet } = readSapPacket(filePath);
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query("BEGIN");
  const loaded = await loadSapPacket(client, packet);
  await client.query("COMMIT");
  console.log(JSON.stringify({ loaded }, null, 2));
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  await client.end();
}
