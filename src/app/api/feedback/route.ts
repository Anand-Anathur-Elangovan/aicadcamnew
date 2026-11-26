import { NextRequest } from "next/server";
import { insertFeedback } from "@/lib/training/feedback";

export const runtime = "nodejs";

/** POST /api/feedback — user thumbs up/down on an answer */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      sessionId?: string;
      messageId?: string;
      question?: string;
      answer?: string;
      citations?: unknown[];
      rating?: number;
    } | null;

    if (!body || typeof body.question !== "string" || typeof body.answer !== "string") {
      return Response.json({ error: "question and answer are required" }, { status: 400 });
    }
    if (body.rating !== 1 && body.rating !== -1) {
      return Response.json({ error: "rating must be 1 or -1" }, { status: 400 });
    }

    const id = await insertFeedback({
      sessionId: typeof body.sessionId === "string" ? body.sessionId : null,
      messageId: typeof body.messageId === "string" ? body.messageId : crypto.randomUUID(),
      question: body.question,
      answer: body.answer,
      citations: Array.isArray(body.citations) ? body.citations : [],
      rating: body.rating as 1 | -1,
    });

    return Response.json({ id });
  } catch (err) {
    console.error("[/api/feedback] POST error", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
