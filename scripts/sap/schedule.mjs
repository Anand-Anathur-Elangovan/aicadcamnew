import { readFileSync } from "node:fs";
import { runSapImport } from "../../src/lib/sap/runImport.mjs";

function fromFile(name) {
  try {
    const text = readFileSync(new URL("../../.env", import.meta.url), "utf8");
    const match = text.match(new RegExp(`^${name}=(.*)$`, "m"));
    return match?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
  } catch {
    return "";
  }
}

function env(name) {
  return process.env[name]?.trim() || fromFile(name);
}

const once = process.argv.includes("--once");
const demo = process.argv.includes("--demo");
const minutes = Math.max(1, Number(env("SAP_IMPORT_EVERY_MINUTES") || 15));
const appUrl = env("DATABASE_URL");
const filePath = env("SAP_IMPORT_PATH");
const sourceUrl = env("SAP_DATABASE_URL") || (demo ? appUrl : "");

async function tick() {
  const results = await runSapImport({ appUrl, filePath, sourceUrl });
  console.log(JSON.stringify({ everyMinutes: minutes, results }));
  if (results.some((result) => !result.ok)) process.exitCode = 1;
}

await tick();
if (!once) {
  setInterval(() => {
    tick().catch((err) => {
      console.error(err instanceof Error ? err.message : err);
    });
  }, minutes * 60 * 1000);
}
