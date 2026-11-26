/**
 * GET  /api/alarms   — list / search alarm records
 * POST /api/alarms   — ingest alarm batch (JSON array | CSV text | plain-text log)
 */
import { listAlarms, insertAlarms, parseTextLog, parseSiemensCSV, alarmSummary }
  from "@/lib/alarms/ingest";
import type { AlarmSeverity, AlarmInput } from "@/lib/alarms/ingest";

export const runtime = "nodejs";

/* ── GET ─────────────────────────────────────────────────────────────── */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  if (searchParams.get("summary") === "1") {
    try {
      return Response.json(await alarmSummary());
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 });
    }
  }

  try {
    const result = await listAlarms({
      machine_id:   searchParams.get("machine")   ?? undefined,
      severity:     (searchParams.get("severity") ?? undefined) as AlarmSeverity | undefined,
      alarm_code:   searchParams.get("code")       ?? undefined,
      acknowledged: searchParams.has("ack") ? searchParams.get("ack") === "true" : undefined,
      from:         searchParams.get("from")       ?? undefined,
      to:           searchParams.get("to")         ?? undefined,
      q:            searchParams.get("q")          ?? undefined,
      limit:        parseInt(searchParams.get("limit")  ?? "50"),
      offset:       parseInt(searchParams.get("offset") ?? "0"),
    });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

/* ── POST ────────────────────────────────────────────────────────────── */
export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";

  try {
    let alarms: AlarmInput[] = [];

    if (contentType.includes("application/json")) {
      const body = (await req.json()) as unknown;
      if (Array.isArray(body)) {
        alarms = body as AlarmInput[];
      } else if (body && typeof body === "object" && "alarms" in body) {
        alarms = (body as { alarms: AlarmInput[] }).alarms;
      } else {
        return Response.json({ error: "Body must be an array of alarm objects or { alarms: [...] }" }, { status: 400 });
      }
    } else {
      // Plain-text or CSV
      const text = await req.text();
      const firstLine = text.split("\n")[0] ?? "";
      if (/timestamp|alarmno/i.test(firstLine)) {
        alarms = parseSiemensCSV(text);
      } else {
        alarms = parseTextLog(text);
      }
    }

    if (alarms.length === 0) {
      return Response.json({ error: "No alarms parsed from input" }, { status: 400 });
    }

    const inserted = await insertAlarms(alarms);
    return Response.json({ success: true, inserted });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
