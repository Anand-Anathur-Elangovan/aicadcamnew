import { createChatSession, listChatSessions } from "@/lib/chat/sessions";

export const runtime = "nodejs";

export async function GET() {
  try {
    const sessions = await listChatSessions();
    return Response.json({ sessions });
  } catch (err) {
    console.error("[/api/chat/sessions] GET", err);
    return Response.json({ error: err instanceof Error ? err.message : "Failed to list sessions" }, { status: 500 });
  }
}

export async function POST() {
  try {
    const session = await createChatSession();
    return Response.json({ session }, { status: 201 });
  } catch (err) {
    console.error("[/api/chat/sessions] POST", err);
    return Response.json({ error: err instanceof Error ? err.message : "Failed to create session" }, { status: 500 });
  }
}
