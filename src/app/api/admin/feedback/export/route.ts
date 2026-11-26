import { NextRequest } from "next/server";
import { exportApproved } from "@/lib/training/feedback";

export const runtime = "nodejs";

/** GET /api/admin/feedback/export?format=jsonl|csv */
export async function GET(req: NextRequest) {
  try {
    const format = (req.nextUrl.searchParams.get("format") ?? "jsonl") === "csv" ? "csv" : "jsonl";
    const content = await exportApproved(format);

    const mime = format === "csv" ? "text/csv" : "application/x-ndjson";
    const filename = `training_${new Date().toISOString().slice(0, 10)}.${format}`;

    return new Response(content, {
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("[/api/admin/feedback/export] GET error", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
