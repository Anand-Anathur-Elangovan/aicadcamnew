/**
 * PATCH /api/alarms/:id  — acknowledge an alarm
 */
import { acknowledgeAlarm } from "@/lib/alarms/ingest";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = (await req.json()) as { acknowledged_by?: string };
    await acknowledgeAlarm(params.id, body.acknowledged_by ?? "operator");
    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
