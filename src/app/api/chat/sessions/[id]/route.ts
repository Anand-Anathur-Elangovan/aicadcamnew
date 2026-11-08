import { NextRequest } from "next/server";
import { deleteChatSession, getChatSession, listChatMessages } from "@/lib/chat/sessions";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  try {
    const session = await getChatSession(id);
    if (!session) return Response.json({ error: "Session not found" }, { status: 404 });
    const messages = await listChatMessages(id);
    return Response.json({ session, messages });
  } catch (err) {
    console.error("[/api/chat/sessions/:id] GET", err);
    return Response.json({ error: err instanceof Error ? err.message : "Failed to load session" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  try {
    const deleted = await deleteChatSession(id);
    if (!deleted) return Response.json({ error: "Session not found" }, { status: 404 });
    return Response.json({ deleted: true });
  } catch (err) {
    console.error("[/api/chat/sessions/:id] DELETE", err);
    return Response.json({ error: err instanceof Error ? err.message : "Failed to delete session" }, { status: 500 });
  }
}
