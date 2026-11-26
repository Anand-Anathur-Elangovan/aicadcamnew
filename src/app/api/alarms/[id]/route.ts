/**
 * PATCH /api/alarms/:id  — acknowledge an alarm
 */
import { acknowledgeAlarm } from "@/lib/alarms/ingest";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as { acknowledged_by?: string };
    await acknowledgeAlarm(id, body.acknowledged_by ?? "operator");
    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
