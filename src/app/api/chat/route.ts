import { NextRequest } from "next/server";
import { streamAskGraph } from "@/lib/chat/graph";
import { createChatSession, getChatSession, insertChatMessage } from "@/lib/chat/sessions";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Longest question accepted; keeps prompts and token cost bounded. */
const MAX_QUESTION_CHARS = 4000;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as { content?: unknown; sessionId?: unknown } | null;
    if (!body || typeof body !== "object") {
      return Response.json({ error: "Send a JSON body with a content field." }, { status: 400 });
    }
    const content = typeof body.content === "string" ? body.content.trim() : "";
    const requestedSessionId = typeof body.sessionId === "string" ? body.sessionId : "";

    if (!content) {
      return Response.json({ error: "content required" }, { status: 400 });
    }
    if (content.length > MAX_QUESTION_CHARS) {
      return Response.json(
        { error: `Keep the question under ${MAX_QUESTION_CHARS} characters.` },
        { status: 413 },
      );
    }

    const session = requestedSessionId ? await getChatSession(requestedSessionId) : null;
    if (requestedSessionId && !session) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }
    const active = session ?? (await createChatSession());

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        // A closed stream (client left) must not crash the run; the answer is still saved.
        let open = true;
        const send = (event: unknown) => {
          if (!open) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch {
            open = false;
          }
        };
        try {
          const events = await streamAskGraph({
            sessionId: active.id,
            title: active.title,
            question: content,
          });
          for await (const event of events) send(event);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Stream error";
          await insertChatMessage({
            sessionId: active.id,
            role: "assistant",
            content: `*Error: ${message}*`,
          }).catch((saveErr) => console.error("[/api/chat] save failed", saveErr));
          send({ type: "error", message });
        } finally {
          try {
            controller.close();
          } catch {
            // Already closed by the client.
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    console.error("[/api/chat] Error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}
