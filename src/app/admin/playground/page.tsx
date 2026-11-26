"use client";

/**
 * /admin/playground — AI Training Playground
 *
 * Full workflow:
 *  1. Browse all chat sessions (left panel)
 *  2. Click a session → see every Q&A turn (centre panel)
 *  3. Click any AI answer → edit it inline, test it live, mark good/bad
 *  4. Right panel = fine-tune dataset builder (approved examples)
 *  5. Export JSONL / CSV for fine-tuning
 */

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  ArrowLeft, MessageSquare, ThumbsUp, ThumbsDown, Edit3,
  Play, CheckCircle, XCircle, Download, RefreshCw, ChevronRight,
  Sparkles, BookOpen, Loader2, X, Save,
} from "lucide-react";

/* ── Types ────────────────────────────────────────────────────────────── */
interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}
interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  citations?: { documentName: string; pageNumber?: number }[];
}
interface FeedbackRow {
  id: string;
  createdAt: string;
  question: string;
  answer: string;
  correction: string | null;
  rating: 1 | -1 | null;
  status: "pending" | "approved" | "rejected" | "exported";
}

/* ── Helpers ──────────────────────────────────────────────────────────── */
function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/* ── Page ─────────────────────────────────────────────────────────────── */
export default function PlaygroundPage() {
  /* Sessions list */
  const [sessions, setSessions]       = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionSearch, setSessionSearch]     = useState("");

  /* Active session */
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [messages, setMessages]           = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);

  /* Edit mode */
  const [editingId, setEditingId]         = useState<string | null>(null);
  const [editText, setEditText]           = useState("");
  const [editQuestion, setEditQuestion]   = useState("");
  const [testResult, setTestResult]       = useState<string | null>(null);
  const [testLoading, setTestLoading]     = useState(false);
  const [saveMsg, setSaveMsg]             = useState("");
  const [savingId, setSavingId]           = useState<string | null>(null);

  /* Fine-tune dataset */
  const [dataset, setDataset]             = useState<FeedbackRow[]>([]);
  const [datasetLoading, setDatasetLoading] = useState(false);
  const [exporting, setExporting]         = useState(false);

  /* Live test panel */
  const [liveQ, setLiveQ]                 = useState("");
  const [liveA, setLiveA]                 = useState("");
  const [livePending, setLivePending]     = useState(false);
  const [showLive, setShowLive]           = useState(false);

  const reviewer = "playground";

  /* ── Load sessions ──────────────────────────────────────────────────── */
  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const res = await fetch("/api/admin/sessions");
      const d = (await res.json()) as { sessions: Session[] };
      setSessions(d.sessions ?? []);
    } catch { /* silent */ }
    setSessionsLoading(false);
  }, []);

  useEffect(() => { void loadSessions(); }, [loadSessions]);

  /* ── Load messages for a session ───────────────────────────────────── */
  const openSession = async (s: Session) => {
    setActiveSession(s);
    setEditingId(null);
    setTestResult(null);
    setMessagesLoading(true);
    try {
      const res = await fetch(`/api/admin/sessions?id=${s.id}`);
      const d = (await res.json()) as { messages: Message[] };
      setMessages(d.messages ?? []);
    } catch { /* silent */ }
    setMessagesLoading(false);
  };

  /* ── Load dataset (approved feedback) ──────────────────────────────── */
  const loadDataset = useCallback(async () => {
    setDatasetLoading(true);
    try {
      const res = await fetch("/api/admin/feedback?status=approved&limit=100");
      const d = (await res.json()) as { rows: FeedbackRow[] };
      setDataset(d.rows ?? []);
    } catch { /* silent */ }
    setDatasetLoading(false);
  }, []);

  useEffect(() => { void loadDataset(); }, [loadDataset]);

  /* ── Start editing an AI message ────────────────────────────────────── */
  const startEdit = (msg: Message, question: string) => {
    setEditingId(msg.id);
    setEditText(msg.content);
    setEditQuestion(question);
    setTestResult(null);
    setSaveMsg("");
  };

  /* ── Live test: ask AI the same question right now ──────────────────── */
  const testLive = async () => {
    if (!editQuestion) return;
    setTestLoading(true);
    setTestResult("");
    try {
      // Create a temp session and stream the answer
      const startRes = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editQuestion }),
      });
      const reader = startRes.body?.getReader();
      const dec = new TextDecoder();
      let full = "";
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = dec.decode(value);
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data:")) continue;
            try {
              const ev = JSON.parse(line.slice(5)) as { type: string; text?: string };
              if (ev.type === "token" && ev.text) full += ev.text;
            } catch { /* partial line */ }
          }
          setTestResult(full);
        }
      }
      setTestResult(full || "(no response)");
    } catch (e) {
      setTestResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setTestLoading(false);
  };

  /* ── Save correction as approved training example ───────────────────── */
  const saveExample = async (msgId: string, rating: 1 | -1) => {
    if (!editQuestion) return;
    setSavingId(msgId);
    setSaveMsg("");
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageId: msgId,
        sessionId: activeSession?.id ?? null,
        question: editQuestion,
        answer: editText,
        citations: [],
        rating,
      }),
    });
    const data = (await res.json()) as { id?: string; error?: string };
    if (data.error) { setSaveMsg(`Error: ${data.error}`); setSavingId(null); return; }

    // If rating=1 and we have a correction, auto-approve it
    if (rating === 1 && editText) {
      await fetch(`/api/admin/feedback/${data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved", correction: editText, reviewedBy: reviewer }),
      });
    }
    setSaveMsg(rating === 1 ? "✓ Added as good example" : "✓ Marked as bad example");
    setSavingId(null);
    void loadDataset();
  };

  /* ── Export dataset ──────────────────────────────────────────────────── */
  const exportDataset = async (format: "jsonl" | "csv") => {
    setExporting(true);
    const res = await fetch(`/api/admin/feedback/export?format=${format}`);
    const text = await res.text();
    const blob = new Blob([text], { type: format === "jsonl" ? "application/jsonl" : "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `training_data.${format}`; a.click();
    URL.revokeObjectURL(url);
    setExporting(false);
  };

  /* ── Live test panel ─────────────────────────────────────────────────── */
  const runLiveTest = async () => {
    if (!liveQ.trim()) return;
    setLivePending(true); setLiveA("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: liveQ }),
      });
      const reader = res.body?.getReader();
      const dec = new TextDecoder();
      let full = "";
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = dec.decode(value);
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data:")) continue;
            try {
              const ev = JSON.parse(line.slice(5)) as { type: string; text?: string };
              if (ev.type === "token" && ev.text) full += ev.text;
            } catch { /* partial */ }
          }
          setLiveA(full);
        }
      }
    } catch (e) { setLiveA(`Error: ${String(e)}`); }
    setLivePending(false);
  };

  /* ── Render ─────────────────────────────────────────────────────────── */
  const filteredSessions = sessions.filter((s) =>
    !sessionSearch || s.title.toLowerCase().includes(sessionSearch.toLowerCase())
  );

  // Build pairs: user question + following assistant answer
  const pairs: { question: Message; answer: Message }[] = [];
  for (let i = 0; i < messages.length - 1; i++) {
    if (messages[i].role === "user" && messages[i + 1].role === "assistant") {
      pairs.push({ question: messages[i], answer: messages[i + 1] });
      i++;
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top bar */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <Link href="/" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-gray-900">AI Training Playground</h1>
          <p className="text-xs text-gray-500">Browse conversations · Edit answers · Build fine-tune dataset</p>
        </div>
        <button
          type="button"
          onClick={() => setShowLive((v) => !v)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 text-white text-xs font-semibold hover:bg-purple-700"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Live Test
        </button>
        <Link
          href="/admin/training"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-xs font-medium hover:bg-gray-50"
        >
          <BookOpen className="h-3.5 w-3.5" />
          SME Review
        </Link>
      </header>

      {/* Live Test Panel */}
      {showLive && (
        <div className="bg-purple-50 border-b border-purple-200 px-4 py-4">
          <div className="max-w-4xl mx-auto space-y-3">
            <p className="text-xs font-semibold text-purple-800">Test the AI live — see current response before deciding if it needs correction</p>
            <div className="flex gap-2">
              <input
                value={liveQ}
                onChange={(e) => setLiveQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void runLiveTest()}
                placeholder="Ask anything…"
                className="flex-1 px-3 py-2 rounded-lg border border-purple-300 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
              />
              <button
                type="button"
                disabled={livePending || !liveQ.trim()}
                onClick={() => void runLiveTest()}
                className="px-4 py-2 rounded-lg bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
              >
                {livePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Ask
              </button>
            </div>
            {liveA && (
              <div className="bg-white rounded-xl border border-purple-200 p-4 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                {liveA}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden" style={{ height: "calc(100vh - 57px)" }}>

        {/* ── LEFT: Sessions list ─────────────────────────────────────── */}
        <aside className="w-64 shrink-0 border-r border-gray-200 bg-white flex flex-col overflow-hidden">
          <div className="p-3 border-b border-gray-100">
            <input
              value={sessionSearch}
              onChange={(e) => setSessionSearch(e.target.value)}
              placeholder="Search conversations…"
              className="w-full px-3 py-1.5 rounded-lg border border-gray-300 text-xs focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {sessionsLoading && (
              <div className="flex items-center justify-center py-8 text-gray-400">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            )}
            {!sessionsLoading && filteredSessions.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-8">No conversations yet</p>
            )}
            {filteredSessions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => void openSession(s)}
                className={`w-full text-left px-3 py-3 border-b border-gray-100 hover:bg-blue-50 transition-colors ${activeSession?.id === s.id ? "bg-blue-50 border-l-2 border-l-blue-500" : ""}`}
              >
                <p className="text-xs font-semibold text-gray-800 truncate">{s.title || "Untitled"}</p>
                <p className="text-xs text-gray-400 mt-0.5">{timeAgo(s.updatedAt)}</p>
              </button>
            ))}
          </div>
          <div className="p-2 border-t border-gray-100">
            <button type="button" onClick={() => void loadSessions()} className="w-full flex items-center justify-center gap-1 py-1.5 text-xs text-gray-500 hover:text-gray-700">
              <RefreshCw className="h-3 w-3" /> Refresh
            </button>
          </div>
        </aside>

        {/* ── CENTRE: Conversation + edit ────────────────────────────── */}
        <main className="flex-1 overflow-y-auto p-4 space-y-4">
          {!activeSession && (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <MessageSquare className="h-12 w-12 mb-3 text-gray-200" />
              <p className="font-medium text-gray-500">Select a conversation</p>
              <p className="text-xs mt-1">Click any session on the left to see its messages</p>
            </div>
          )}

          {activeSession && messagesLoading && (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}

          {activeSession && !messagesLoading && pairs.length === 0 && (
            <p className="text-center text-gray-400 py-16 text-sm">No messages in this session</p>
          )}

          {activeSession && !messagesLoading && pairs.map(({ question, answer }, idx) => (
            <div key={answer.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              {/* Question */}
              <div className="px-4 py-3 bg-blue-50 border-b border-blue-100">
                <p className="text-xs text-blue-500 font-semibold mb-1">Q{idx + 1} · User</p>
                <p className="text-sm text-gray-800">{question.content}</p>
              </div>

              {/* Answer */}
              <div className="px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-xs text-gray-500 font-semibold">AI Answer</p>
                  <span className="text-xs text-gray-400">{timeAgo(answer.createdAt)}</span>
                  <div className="ml-auto flex gap-1">
                    <button
                      type="button"
                      onClick={() => { startEdit(answer, question.content); }}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs border border-gray-300 hover:bg-gray-50 text-gray-600"
                    >
                      <Edit3 className="h-3 w-3" /> Edit & Train
                    </button>
                  </div>
                </div>

                {editingId === answer.id ? (
                  /* ── Edit mode ── */
                  <div className="space-y-3">
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={6}
                      className="w-full px-3 py-2 rounded-xl border border-blue-300 text-sm font-mono leading-relaxed resize-none focus:ring-2 focus:ring-blue-500 outline-none"
                    />

                    {/* Action bar */}
                    <div className="flex flex-wrap gap-2 items-center">
                      <button
                        type="button"
                        disabled={testLoading}
                        onClick={() => void testLive()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 text-white text-xs font-semibold hover:bg-purple-700 disabled:opacity-50"
                      >
                        {testLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                        Test live
                      </button>
                      <button
                        type="button"
                        disabled={savingId === answer.id}
                        onClick={() => void saveExample(answer.id, 1)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs font-semibold hover:bg-green-700 disabled:opacity-50"
                      >
                        <ThumbsUp className="h-3.5 w-3.5" /> Good example
                      </button>
                      <button
                        type="button"
                        disabled={savingId === answer.id}
                        onClick={() => void saveExample(answer.id, -1)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-50"
                      >
                        <ThumbsDown className="h-3.5 w-3.5" /> Bad example
                      </button>
                      <button
                        type="button"
                        onClick={() => { setEditingId(null); setTestResult(null); }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 text-xs hover:bg-gray-50"
                      >
                        <X className="h-3.5 w-3.5" /> Cancel
                      </button>
                      {saveMsg && (
                        <span className={`text-xs font-medium ${saveMsg.startsWith("Error") ? "text-red-600" : "text-green-700"}`}>{saveMsg}</span>
                      )}
                    </div>

                    {/* Live test result */}
                    {testResult !== null && (
                      <div className="rounded-xl border border-purple-200 bg-purple-50 p-3">
                        <p className="text-xs font-semibold text-purple-700 mb-1">Current AI response (live):</p>
                        <p className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">{testResult}</p>
                        <p className="text-xs text-gray-400 mt-2">↑ Compare this with your edited answer above. If yours is better, click "Good example".</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap line-clamp-6">{answer.content}</p>
                )}
              </div>
            </div>
          ))}
        </main>

        {/* ── RIGHT: Fine-tune dataset ────────────────────────────────── */}
        <aside className="w-72 shrink-0 border-l border-gray-200 bg-white flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-gray-900">Fine-tune Dataset</p>
              <p className="text-xs text-gray-500">{dataset.length} approved examples</p>
            </div>
            <button type="button" onClick={() => void loadDataset()} className="p-1 text-gray-400 hover:text-gray-600">
              <RefreshCw className={`h-3.5 w-3.5 ${datasetLoading ? "animate-spin" : ""}`} />
            </button>
          </div>

          {/* Export buttons */}
          <div className="px-3 py-2 border-b border-gray-100 flex gap-2">
            <button
              type="button"
              disabled={exporting || dataset.length === 0}
              onClick={() => void exportDataset("jsonl")}
              className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg bg-gray-900 text-white text-xs font-semibold hover:bg-gray-700 disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" /> JSONL
            </button>
            <button
              type="button"
              disabled={exporting || dataset.length === 0}
              onClick={() => void exportDataset("csv")}
              className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg border border-gray-300 text-gray-700 text-xs font-semibold hover:bg-gray-50 disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
          </div>

          {/* Dataset items */}
          <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
            {datasetLoading && (
              <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
            )}
            {!datasetLoading && dataset.length === 0 && (
              <div className="text-center py-10 px-4">
                <BookOpen className="h-8 w-8 mx-auto mb-2 text-gray-200" />
                <p className="text-xs text-gray-500 font-medium">No examples yet</p>
                <p className="text-xs text-gray-400 mt-1">Edit an AI answer and click "Good example" to add it here</p>
              </div>
            )}
            {dataset.map((row) => (
              <div key={row.id} className="px-3 py-3">
                <div className="flex items-center gap-1 mb-1">
                  {row.rating === 1
                    ? <ThumbsUp className="h-3 w-3 text-green-600 shrink-0" />
                    : <ThumbsDown className="h-3 w-3 text-red-500 shrink-0" />
                  }
                  <span className={`text-xs font-medium ${row.rating === 1 ? "text-green-700" : "text-red-600"}`}>
                    {row.rating === 1 ? "Good" : "Bad"}
                  </span>
                  <span className="ml-auto text-xs text-gray-400">{timeAgo(row.createdAt)}</span>
                </div>
                <p className="text-xs text-gray-700 font-medium line-clamp-2">{row.question}</p>
                <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{row.correction ?? row.answer}</p>
              </div>
            ))}
          </div>

          {/* Help text */}
          <div className="px-3 py-3 border-t border-gray-100 bg-gray-50 text-xs text-gray-500 leading-relaxed">
            <p className="font-semibold text-gray-700 mb-1">How to use JSONL export</p>
            <p>Upload to OpenAI fine-tuning or Anthropic when available. Each row = one training example.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
