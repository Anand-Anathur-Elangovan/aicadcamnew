"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageBubble } from "./MessageBubble";
import { ChatInput } from "./ChatInput";
import type { ChatMessage, Citation } from "@/lib/types";
import { Bot, Loader2, Plus, Trash2 } from "lucide-react";

interface ChatSessionSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export function ChatInterface() {
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [status, setStatus] = useState("Thinking");
  const [loadingSession, setLoadingSession] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** Latest session-open request; older responses are ignored. */
  const openTokenRef = useRef(0);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const refreshSessions = useCallback(async () => {
    const response = await fetch("/api/chat/sessions");
    if (!response.ok) return;
    const body = (await response.json()) as { sessions: ChatSessionSummary[] };
    setSessions(body.sessions ?? []);
  }, []);


  useEffect(() => {
    // Jump while tokens stream so the view does not lag; glide otherwise.
    bottomRef.current?.scrollIntoView({ behavior: isStreaming ? "auto" : "smooth" });
  }, [messages, isStreaming]);

  const openSavedSession = async (id: string) => {
    setLoadingSession(true);
    setSessionId(id);
    try {
      const response = await fetch(`/api/chat/sessions/${id}`);
      if (!response.ok) {
        window.localStorage.removeItem("askai.sessionId");
        setSessionId(null);
        return;
      }
      const body = (await response.json()) as { messages: ChatMessage[] };
      setMessages(body.messages ?? []);
    } finally {
      setLoadingSession(false);
    }
  };

  useEffect(() => {
    void (async () => {
      await refreshSessions();
      const saved = window.localStorage.getItem("askai.sessionId");
      if (saved) await openSavedSession(saved);
    })();
    // The saved session is restored once, after the list loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openSession = async (id: string) => {
    if (isStreaming || id === sessionId) return;
    const token = ++openTokenRef.current;
    window.localStorage.setItem("askai.sessionId", id);
    setLoadingSession(true);
    setSessionId(id);
    sessionIdRef.current = id;
    try {
      const response = await fetch(`/api/chat/sessions/${id}`);
      if (!response.ok) throw new Error("Could not open that chat");
      const body = (await response.json()) as { messages: ChatMessage[] };
      if (token !== openTokenRef.current) return;
      setMessages(body.messages ?? []);
    } catch (err) {
      if (token !== openTokenRef.current) return;
      const message = err instanceof Error ? err.message : "Could not open that chat";
      setMessages([
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `*${message}*`,
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      if (token === openTokenRef.current) setLoadingSession(false);
    }
  };

  const startNewChat = () => {
    if (isStreaming) return;
    openTokenRef.current++;
    setLoadingSession(false);
    sessionIdRef.current = null;
    window.localStorage.removeItem("askai.sessionId");
    setSessionId(null);
    setMessages([]);
    setInput("");
  };

  const removeSession = async (id: string) => {
    if (isStreaming) return;
    const response = await fetch(`/api/chat/sessions/${id}`, { method: "DELETE" });
    if (!response.ok) return;
    setSessions((prev) => prev.filter((session) => session.id !== id));
    if (sessionId === id) startNewChat();
  };

  const sendMessage = async () => {
    const userContent = input.trim();
    if (!userContent || isStreaming) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: userContent,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setStatus("Thinking");
    setIsStreaming(true);

    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        citations: [],
        createdAt: new Date().toISOString(),
      },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/chat", {
        signal: controller.signal,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionIdRef.current, content: userContent }),
      });

      if (!response.ok || !response.body) {
        const failed = await response.json().catch(() => ({ error: "No response body" }));
        throw new Error(failed.error ?? "Request failed");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let citations: Citation[] = [];
      let content = "";

      while (true) {
        const { done, value } = await reader.read();
        // On the last read, terminate any unfinished line so it is still parsed.
        buffer += done ? `${decoder.decode()}\n` : decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6)) as {
              type: "session" | "status" | "enhanced" | "attempt" | "citations" | "token" | "done" | "error";
              sessionId?: string;
              title?: string;
              citations?: Citation[];
              text?: string;
              message?: string;
            };

            if (event.type === "session" && event.sessionId) {
              setSessionId(event.sessionId);
              sessionIdRef.current = event.sessionId;
              window.localStorage.setItem("askai.sessionId", event.sessionId);
              setSessions((prev) => {
                const title = event.title ?? "New chat";
                const existing = prev.find((session) => session.id === event.sessionId);
                const next = {
                  id: event.sessionId as string,
                  title,
                  updatedAt: new Date().toISOString(),
                };
                if (!existing) return [next, ...prev];
                return [next, ...prev.filter((session) => session.id !== event.sessionId)];
              });
            } else if (event.type === "status" && event.message) {
              setStatus(event.message);
            } else if (event.type === "citations") {
              citations = event.citations ?? [];
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, citations } : m))
              );
            } else if (event.type === "token") {
              content += event.text ?? "";
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content } : m))
              );
            } else if (event.type === "error") {
              content += content ? `\n\n*Error: ${event.message}*` : `*Error: ${event.message}*`;
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content } : m))
              );
            }
          } catch {
            // Ignore a partial SSE line.
          }
        }
        if (done) break;
      }
      if (!content.trim()) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: "*No answer came back. Please try again.*" }
              : m
          )
        );
      }
      await refreshSessions();
    } catch (err) {
      if (controller.signal.aborted) {
        // The user pressed Stop: keep what was written, or say it was stopped.
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId && !m.content.trim() ? { ...m, content: "*Stopped.*" } : m
          )
        );
        void refreshSessions();
      } else {
        const message = err instanceof Error ? err.message : "Connection failed";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: `*Sorry, something went wrong: ${message}*` }
              : m
          )
        );
      }
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
    }
  };

  const stopStreaming = () => abortRef.current?.abort();

  useEffect(() => () => abortRef.current?.abort(), []);

  const isEmpty = messages.length === 0;

  return (
    <div className="flex h-full">
      <aside className="w-64 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col">
        <div className="p-3 border-b border-gray-100">
          <button
            type="button"
            onClick={startNewChat}
            disabled={isStreaming}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            New chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {sessions.length === 0 && (
            <p className="px-2 py-3 text-xs text-gray-400">Saved chats appear here.</p>
          )}
          {sessions.map((session) => (
            <div key={session.id} className="group flex items-center gap-1">
              <button
                type="button"
                onClick={() => void openSession(session.id)}
                className={`flex-1 min-w-0 text-left px-2 py-2 rounded-lg text-xs truncate ${
                  session.id === sessionId ? "bg-blue-50 text-blue-800" : "text-gray-700 hover:bg-gray-50"
                }`}
                title={session.title}
              >
                {session.title}
              </button>
              <button
                type="button"
                onClick={() => void removeSession(session.id)}
                disabled={isStreaming}
                className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-600"
                title="Delete chat"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex-1 overflow-y-auto px-4 py-6">
          {loadingSession ? (
            <p className="flex items-center justify-center gap-2 text-center text-sm text-gray-400" role="status"><Loader2 className="h-4 w-4 animate-spin" />Loading chat…</p>
          ) : isEmpty ? (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
              <div className="h-16 w-16 rounded-2xl bg-blue-600 flex items-center justify-center">
                <Bot className="h-8 w-8 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Manufacturing AI Assistant</h2>
                <p className="text-sm text-gray-500 mt-1 max-w-md">
                  Ask about drawings, inspection reports, purchase orders, inventory, or any indexed manufacturing document. This chat is saved.
                </p>
              </div>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto space-y-6">
              {messages.map((msg, i) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isStreaming={isStreaming && i === messages.length - 1 && msg.role === "assistant"}
                  status={status}
                />
              ))}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-gray-200 bg-white px-4 py-4">
          <div className="max-w-4xl mx-auto">
            <ChatInput
              value={input}
              onChange={setInput}
              onSubmit={sendMessage}
              onStop={stopStreaming}
              streaming={isStreaming}
              disabled={isStreaming || loadingSession}
              showSuggestions={isEmpty}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
