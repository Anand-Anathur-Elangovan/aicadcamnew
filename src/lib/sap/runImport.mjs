import pg from "pg";
import { loadSapPacket, readSapPacket } from "./loadPacket.mjs";
import { readSapDatabase } from "./readSource.mjs";

function safeDetail(value) {
  return String(value).replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted]").slice(0, 500);
}

async function recordRun(appUrl, source, ok, detail) {
  const client = new pg.Client({ connectionString: appUrl });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS sap_import_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        source TEXT NOT NULL CHECK (source IN ('file', 'database')),
        started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        finished_at TIMESTAMPTZ,
        ok BOOLEAN NOT NULL,
        detail TEXT NOT NULL DEFAULT ''
      )
    `);
    await client.query(
      `INSERT INTO sap_import_runs (source, finished_at, ok, detail) VALUES ($1, now(), $2, $3)`,
      [source, ok, safeDetail(detail)]
    );
  } finally {
    await client.end();
  }
}

async function loadOnApp(appUrl, packet) {
  const client = new pg.Client({ connectionString: appUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    const loaded = await loadSapPacket(client, packet);
    await client.query("COMMIT");
    return loaded;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

async function runSource(appUrl, source, read) {
  try {
    const { errors, packet } = await read();
    if (errors.length > 0) throw new Error(errors.join("; "));
    if (packet.routers.length === 0) {
      await recordRun(appUrl, source, true, "No routers in the source");
      return { source, ok: true, detail: "No routers in the source" };
    }
    const loaded = await loadOnApp(appUrl, packet);
    const detail = loaded.map((row) => `${row.routerNo}: ${row.whereNow}`).join("; ");
    await recordRun(appUrl, source, true, detail);
    return { source, ok: true, detail };
  } catch (err) {
    const detail = safeDetail(err instanceof Error ? err.message : err);
    await recordRun(appUrl, source, false, detail);
    return { source, ok: false, detail };
  }
}

export async function runSapImport({ appUrl, filePath, sourceUrl }) {
  if (!appUrl) throw new Error("DATABASE_URL missing");
  const results = [];
  if (filePath) {
    results.push(await runSource(appUrl, "file", async () => readSapPacket(filePath)));
  }
  if (sourceUrl) {
    results.push(await runSource(appUrl, "database", async () => {
      const client = new pg.Client({ connectionString: sourceUrl });
      await client.connect();
      try {
        return await readSapDatabase(client);
      } finally {
        await client.end();
      }
    }));
  }
  if (results.length === 0) throw new Error("Set SAP_IMPORT_PATH or SAP_DATABASE_URL");
  return results;
}
