import { NextRequest } from "next/server";
import { listRevisions, saveRevision } from "@/lib/gcode/history";

export const runtime = "nodejs";

/** GET /api/gcode/revisions?program=O1001 */
export async function GET(req: NextRequest) {
  try {
    const name = req.nextUrl.searchParams.get("program") ?? "";
    if (!name) return Response.json({ error: "program is required" }, { status: 400 });
    const revisions = await listRevisions(name);
    return Response.json({ revisions });
  } catch (err) {
    console.error("[/api/gcode/revisions] GET", err);
    return Response.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

/** POST /api/gcode/revisions — save a new revision */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      programName?: string;
      content?: string;
      routerNo?: string;
      partNumber?: string;
      machine?: string;
      controller?: string;
      source?: string;
      note?: string;
      author?: string;
    } | null;

    if (!body?.programName || !body?.content) {
      return Response.json({ error: "programName and content are required" }, { status: 400 });
    }

    const id = await saveRevision({
      programName: body.programName,
      content:     body.content,
      routerNo:    body.routerNo,
      partNumber:  body.partNumber,
      machine:     body.machine,
      controller:  body.controller,
      source:      (body.source as "ai_generated" | "manual" | "imported" | "approved") ?? "manual",
      note:        body.note,
      author:      body.author,
    });
    return Response.json({ id });
  } catch (err) {
    console.error("[/api/gcode/revisions] POST", err);
    return Response.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
