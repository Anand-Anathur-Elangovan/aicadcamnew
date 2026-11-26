import { NextRequest } from "next/server";
import { listFeedback } from "@/lib/training/feedback";

export const runtime = "nodejs";

/** GET /api/admin/feedback?status=pending&rating=-1&limit=50&offset=0 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const result = await listFeedback({
      status: searchParams.get("status") ?? "all",
      rating: searchParams.has("rating") ? parseInt(searchParams.get("rating")!) : undefined,
      limit: searchParams.has("limit") ? parseInt(searchParams.get("limit")!) : 50,
      offset: searchParams.has("offset") ? parseInt(searchParams.get("offset")!) : 0,
    });
    return Response.json(result);
  } catch (err) {
    console.error("[/api/admin/feedback] GET error", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
