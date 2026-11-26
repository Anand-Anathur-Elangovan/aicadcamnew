import { NextRequest } from "next/server";
import { compareRevisions, getRevision, deleteRevision } from "@/lib/gcode/history";

export const runtime = "nodejs";

/** GET /api/gcode/revisions/compare?a=ID&b=ID */
export async function GET(req: NextRequest) {
  try {
    const a = req.nextUrl.searchParams.get("a") ?? "";
    const b = req.nextUrl.searchParams.get("b") ?? "";
    if (!a || !b) return Response.json({ error: "a and b revision IDs are required" }, { status: 400 });
    const result = await compareRevisions(a, b);
    return Response.json(result);
  } catch (err) {
    console.error("[/api/gcode/revisions/compare] GET", err);
    return Response.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
