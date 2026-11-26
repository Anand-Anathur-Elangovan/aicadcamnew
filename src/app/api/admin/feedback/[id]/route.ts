import { NextRequest } from "next/server";
import { reviewFeedback } from "@/lib/training/feedback";

export const runtime = "nodejs";

/** PATCH /api/admin/feedback/:id — SME approve / reject + correction */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as {
      status?: string;
      correction?: string;
      correctionNote?: string;
      reviewedBy?: string;
    } | null;

    if (!body || (body.status !== "approved" && body.status !== "rejected")) {
      return Response.json({ error: "status must be 'approved' or 'rejected'" }, { status: 400 });
    }

    await reviewFeedback({
      id,
      status: body.status,
      correction: body.correction,
      correctionNote: body.correctionNote,
      reviewedBy: body.reviewedBy,
    });

    return Response.json({ ok: true });
  } catch (err) {
    console.error("[/api/admin/feedback/:id] PATCH error", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
