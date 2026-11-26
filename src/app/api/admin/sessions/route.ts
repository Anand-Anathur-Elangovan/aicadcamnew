/**
 * GET /api/admin/sessions — list all chat sessions with message counts
 * GET /api/admin/sessions?id=xxx — get one session with all messages
 */
import { listChatSessions, getChatSession, listChatMessages } from "@/lib/chat/sessions";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  try {
    if (id) {
      const [session, messages] = await Promise.all([
        getChatSession(id),
        listChatMessages(id),
      ]);
      if (!session) return Response.json({ error: "Not found" }, { status: 404 });
      return Response.json({ session, messages });
    }

    const sessions = await listChatSessions();
    return Response.json({ sessions });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
