"use client";

import { useState, useRef, useEffect } from "react";
import { Sparkles, Wrench, Send, X, Check, Play, AlertTriangle, Loader2 } from "lucide-react";

export interface GCodeAIContext {
  machine?: string;
  tools?: string[];
  drawingContext?: string;
}

interface ChatItem {
  id: string;
  role: "user" | "assistant";
  text: string;
  suggestions?: string[];
  gcode?: string | null;
  applied?: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  gcode: string;
  issues?: string[];
  context?: GCodeAIContext;
  onApplyGCode: (code: string, autoPlay?: boolean) => void;
  triggerFixCounter?: number;
}

const QUICK_PROMPTS = [
  "Fix any errors or collisions",
  "Optimize feeds & speeds",
  "Add a chamfer finish pass",
  "Add a center drill hole",
];

export default function GCodeAIAssistant({
  open,
  onClose,
  gcode,
  issues = [],
  context,
  onApplyGCode,
  triggerFixCounter = 0,
}: Props) {
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastFixCounter = useRef(triggerFixCounter);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const sendRequest = async (mode: "fix" | "chat", userMessage?: string) => {
    if (loading) return;
    setLoading(true);
    setError(null);

    const displayPrompt =
      mode === "fix"
        ? issues.length
          ? `Fix ${issues.length} detected issue${issues.length > 1 ? "s" : ""} in G-code`
          : "Check & fix this G-code"
        : (userMessage ?? input).trim();

    if (!displayPrompt) {
      setLoading(false);
      return;
    }

    const userItem: ChatItem = {
      id: `u-${Date.now()}`,
      role: "user",
      text: displayPrompt,
    };

    const nextHistory = [...messages, userItem];
    setMessages(nextHistory);
    if (mode === "chat") setInput("");

    try {
      const res = await fetch("/api/gcode/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          message: mode === "chat" ? displayPrompt : undefined,
          gcode,
          issues,
          machine: context?.machine,
          tools: context?.tools,
          drawingContext: context?.drawingContext,
          history: messages.slice(-6).map((m) => ({ role: m.role, content: m.text })),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AI request failed");

      const assistantItem: ChatItem = {
        id: `a-${Date.now()}`,
        role: "assistant",
        text: data.explanation || "Done.",
        suggestions: data.suggestions ?? [],
        gcode: data.gcode ?? null,
        applied: false,
      };
      setMessages((prev) => [...prev, assistantItem]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reach AI");
    } finally {
      setLoading(false);
    }
  };

  // Triggered when user clicks the toolbar "Fix with AI" button
  useEffect(() => {
    if (triggerFixCounter > lastFixCounter.current) {
      lastFixCounter.current = triggerFixCounter;
      void sendRequest("fix");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerFixCounter]);

  const applyCode = (itemId: string, code: string, autoPlay: boolean) => {
    onApplyGCode(code, autoPlay);
    setMessages((prev) =>
      prev.map((m) => (m.id === itemId ? { ...m, applied: true } : m))
    );
  };

  if (!open) return null;

  return (
    <div className="border-t border-slate-700 bg-slate-900 flex flex-col max-h-[52%] min-h-[220px] shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-800/90 border-b border-slate-700 shrink-0">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-violet-300">
          <Sparkles className="w-3.5 h-3.5 text-violet-400" />
          <span>AI G-Code Assistant</span>
          {context?.machine && (
            <span className="text-[10px] font-normal text-slate-400 truncate max-w-[150px]">
              · {context.machine}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-200 p-0.5 rounded"
          title="Close AI Assistant"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Active issues banner */}
      {issues.length > 0 && (
        <div className="px-3 py-1.5 bg-amber-950/50 border-b border-amber-800/60 flex items-start gap-2 text-[11px] text-amber-200 shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <span className="font-semibold">{issues.length} issue{issues.length > 1 ? "s" : ""} detected:</span>{" "}
            <span className="text-amber-300/90 truncate block">{issues[0]}</span>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => void sendRequest("fix")}
            className="px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold shrink-0 disabled:opacity-50"
          >
            Fix
          </button>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2.5 text-xs">
        {messages.length === 0 && !loading && (
          <div className="space-y-2 py-1">
            <p className="text-[11px] text-slate-400">
              Ask in plain English to generate, edit, or troubleshoot G-code for your current part &amp; machine.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_PROMPTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => void sendRequest(q.startsWith("Fix") ? "fix" : "chat", q)}
                  className="text-[11px] px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={
              m.role === "user"
                ? "ml-6 bg-cyan-950/60 border border-cyan-800/60 text-cyan-100 rounded-lg px-2.5 py-1.5"
                : "mr-2 bg-slate-800/90 border border-slate-700 text-slate-200 rounded-lg px-2.5 py-2 space-y-1.5"
            }
          >
            <p className="leading-relaxed whitespace-pre-wrap">{m.text}</p>

            {m.suggestions && m.suggestions.length > 0 && (
              <ul className="list-disc pl-4 text-[11px] text-slate-400 space-y-0.5">
                {m.suggestions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            )}

            {m.gcode && (
              <div className="flex items-center gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => applyCode(m.id, m.gcode!, false)}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold transition-colors ${
                    m.applied
                      ? "bg-emerald-900/60 text-emerald-300 border border-emerald-700"
                      : "bg-emerald-600 hover:bg-emerald-500 text-white"
                  }`}
                >
                  <Check className="w-3 h-3" />
                  {m.applied ? "Applied" : "Apply G-Code"}
                </button>
                <button
                  type="button"
                  onClick={() => applyCode(m.id, m.gcode!, true)}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold bg-cyan-600 hover:bg-cyan-500 text-white transition-colors"
                >
                  <Play className="w-3 h-3" />
                  Apply &amp; Play
                </button>
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-violet-300 text-[11px] py-1">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>AI is analyzing G-code &amp; drawing context…</span>
          </div>
        )}

        {error && (
          <div className="text-[11px] text-red-300 bg-red-950/50 border border-red-800 rounded px-2 py-1.5">
            {error}
          </div>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void sendRequest("chat");
        }}
        className="flex items-center gap-1.5 px-2.5 py-2 border-t border-slate-700 bg-slate-950 shrink-0"
      >
        <button
          type="button"
          disabled={loading}
          onClick={() => void sendRequest("fix")}
          title="Auto-fix errors & warnings with AI"
          className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-amber-400 border border-slate-700 shrink-0 disabled:opacity-40"
        >
          <Wrench className="w-3.5 h-3.5" />
        </button>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
          placeholder="Tell AI what to generate or fix…"
          className="flex-1 bg-slate-800 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="p-1.5 rounded bg-violet-600 hover:bg-violet-500 text-white shrink-0 disabled:opacity-40"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
}
