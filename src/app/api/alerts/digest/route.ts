/**
 * POST /api/alerts/digest
 *
 * Triggered by Vercel Cron (see vercel.json) or any HTTP scheduler.
 * Protected by a shared secret in CRON_SECRET so it cannot be called by anyone.
 *
 * To test manually:
 *   curl -X POST https://your-app.vercel.app/api/alerts/digest \
 *     -H "Authorization: Bearer YOUR_CRON_SECRET"
 *
 * To set up Vercel Cron, add vercel.json with:
 *   { "crons": [{ "path": "/api/alerts/digest", "schedule": "0 7 * * *" }] }
 * That fires at 07:00 UTC (12:30 IST) every day.
 */
import { NextRequest } from "next/server";
import { runDigest } from "@/lib/alerts/digest";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  // Guard with a bearer token so only your scheduler can trigger this
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await runDigest();
    return Response.json(result);
  } catch (err) {
    console.error("[/api/alerts/digest]", err);
    return Response.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

// Allow GET for Vercel Cron (Vercel calls cron routes with GET)
export async function GET(req: NextRequest) {
  return POST(req);
}
