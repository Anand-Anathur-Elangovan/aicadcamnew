import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/chat/graph", () => ({ streamAskGraph: vi.fn() }));
vi.mock("@/lib/chat/sessions", () => ({
  createChatSession: vi.fn(async () => ({ id: "s1", title: "New chat" })),
  getChatSession: vi.fn(async () => null),
  insertChatMessage: vi.fn(async () => undefined),
}));

import { POST } from "@/app/api/chat/route";
import { NextRequest } from "next/server";

const call = (body: string) =>
  POST(
    new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
    }),
  );

describe("POST /api/chat validation", () => {
  it("rejects a body that is not JSON with 400", async () => {
    expect((await call("{oops")).status).toBe(400);
  });
  it("rejects an empty question", async () => {
    expect((await call(JSON.stringify({ content: "   " }))).status).toBe(400);
  });
  it("rejects an oversized question with 413", async () => {
    expect((await call(JSON.stringify({ content: "x".repeat(4001) }))).status).toBe(413);
  });
  it("returns 404 for an unknown session", async () => {
    expect((await call(JSON.stringify({ content: "hi", sessionId: "nope" }))).status).toBe(404);
  });
});
