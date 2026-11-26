"use client";
/**
 * /admin/playground — AI Training Playground (enhanced)
 *
 * Features:
 *  1. Browse all conversations (left)
 *  2. Edit AI answers inline + A/B comparison
 *  3. Auto-suggest better answer (AI rewrites it)
 *  4. AI self-evaluation: score 1-10 + issue labels
 *  5. Label each example: perfect / incomplete / hallucination / wrong_citation / off_topic
 *  6. Batch evaluation: run N test questions, see pass/fail table
 *  7. Prompt template editor: edit system prompt, test live
 *  8. Fine-tune dataset builder: approved examples → export JSONL / CSV
 */
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft, MessageSquare, ThumbsUp, ThumbsDown, Edit3,
  Play, Download, RefreshCw, Sparkles, BookOpen, Loader2,
  X, FlaskConical, Settings2, CheckCircle, XCircle, AlertTriangle,
  Tag, Zap, ArrowLeftRight,
} from "lucide-react";

/* ═══════════════════ Types ═══════════════════ */
interface Session  { id: string; title: string; createdAt: string; updatedAt: string; }
interface Message  { id: string; role: "user"|"assistant"; content: string; createdAt: string; citations?: {documentName:string;pageNumber?:number}[]; }
interface FbRow    { id: string; createdAt: string; question: string; answer: string; correction: string|null; correctionNote: string|null; rating: 1|-1|null; status: string; label?: string; }
interface EvalResult {
  overall: number;
  dimensions: Record<string, number>;
  issues: string[];
  label: string;
  reasoning: string;
}
interface BatchResult {
  question: string; answer: string; score: number; pass: boolean; latencyMs: number;
  error?: string;
  details: { keywordsFound?: string[]; keywordsMissed?: string[]; citedExpectedPart?: boolean; hasSubstantiveAnswer?: boolean; noRefusal?: boolean; topRagScore?: number; citationsCount?: number; };
}

/* ═══════════════════ Constants ═══════════════════ */
const LABEL_OPTIONS = [
  { value: "perfect",       label: "✅ Perfect",          cls: "bg-green-100 text-green-800" },
  { value: "good",          label: "👍 Good",             cls: "bg-blue-100 text-blue-800" },
  { value: "incomplete",    label: "⚠️ Incomplete",       cls: "bg-amber-100 text-amber-800" },
  { value: "wrong_citation",label: "📄 Wrong citation",   cls: "bg-orange-100 text-orange-800" },
  { value: "hallucination", label: "🚨 Hallucination",    cls: "bg-red-100 text-red-800" },
  { value: "off_topic",     label: "❓ Off-topic",        cls: "bg-gray-100 text-gray-700" },
];

const DEFAULT_SYSTEM_PROMPT = `You are the Manufacturing AI Assistant for a factory. You talk like a knowledgeable, friendly colleague: natural, direct, and never robotic.
Answer using only the records and documents provided. Cite sources as [1], [2]. Close with a Summary.
If information is not in the records, say so plainly.`;

const DEFAULT_BATCH_TESTS = `[
  { "question": "What is the bore tolerance on the flange body?", "expectedKeywords": ["Ø28H7", "28.018"] },
  { "question": "What material is BRK-ASY-001 made of?", "expectedKeywords": ["6061-T6", "Aluminum"] },
  { "question": "Who inspected the bracket assembly?", "expectedKeywords": ["Martinez"] }
]`;

type Tab = "conversations" | "batch" | "prompt";

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function ScoreBar({ score, label }: { score: number; label: string }) {
  const color = score >= 80 ? "bg-green-500" : score >= 60 ? "bg-amber-400" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-mono w-8 text-right text-gray-600">{score}</span>
      <span className={`text-xs px-1.5 py-0.5 rounded-full ${LABEL_OPTIONS.find(l=>l.value===label)?.cls ?? "bg-gray-100 text-gray-600"}`}>{label}</span>
    </div>
  );
}

/* ═══════════════════ Page ═══════════════════ */
export default function PlaygroundPage() {
  const [tab, setTab] = useState<Tab>("conversations");

  /* Sessions */
  const [sessions, setSessions]         = useState<Session[]>([]);
  const [sessLoading, setSessLoading]   = useState(true);
  const [sessSearch, setSessSearch]     = useState("");
  const [activeSession, setActiveSession] = useState<Session|null>(null);
  const [messages, setMessages]         = useState<Message[]>([]);
  const [msgLoading, setMsgLoading]     = useState(false);

  /* Edit state */
  const [editingId, setEditingId]       = useState<string|null>(null);
  const [editText, setEditText]         = useState("");
  const [editQ, setEditQ]               = useState("");
  const [originalText, setOriginalText] = useState("");

  /* Auto-suggest + eval */
  const [suggestion, setSuggestion]     = useState<string|null>(null);
  const [evaluation, setEvaluation]     = useState<EvalResult|null>(null);
  const [aiLoading, setAiLoading]       = useState(false);

  /* A/B */
  const [showAB, setShowAB]             = useState(false);
  const [chosenSide, setChosenSide]     = useState<"original"|"suggested"|null>(null);

  /* Label */
  const [selectedLabel, setSelectedLabel] = useState("good");

  /* Live test */
  const [liveQ, setLiveQ]               = useState("");
  const [liveA, setLiveA]               = useState("");
  const [livePending, setLivePending]   = useState(false);

  /* Save */
  const [savingId, setSavingId]         = useState<string|null>(null);
  const [saveMsg, setSaveMsg]           = useState("");

  /* Dataset */
  const [dataset, setDataset]           = useState<FbRow[]>([]);
  const [dsLoading, setDsLoading]       = useState(false);
  const [exporting, setExporting]       = useState(false);

  /* Batch eval */
  const [batchInput, setBatchInput]     = useState(DEFAULT_BATCH_TESTS);
  const [batchResults, setBatchResults] = useState<BatchResult[]|null>(null);
  const [batchSummary, setBatchSummary] = useState<{total:number;passed:number;failed:number;avgScore:number;avgLatency:number}|null>(null);
  const [batchRunning, setBatchRunning] = useState(false);

  /* Prompt editor */
  const [promptText, setPromptText]     = useState(DEFAULT_SYSTEM_PROMPT);
  const [promptQ, setPromptQ]           = useState("");
  const [promptA, setPromptA]           = useState("");
  const [promptRunning, setPromptRunning] = useState(false);
  const [promptCitations, setPromptCitations] = useState<{documentName:string}[]>([]);

  /* ── Loaders ── */
  const loadSessions = useCallback(async () => {
    setSessLoading(true);
    try {
      const r = await fetch("/api/admin/sessions");
      const d = (await r.json()) as { sessions: Session[] };
      setSessions(d.sessions ?? []);
    } catch {/**/}
    setSessLoading(false);
  }, []);

  const loadDataset = useCallback(async () => {
    setDsLoading(true);
    try {
      const r = await fetch("/api/admin/feedback?status=approved&limit=200");
      const d = (await r.json()) as { rows: FbRow[] };
      setDataset(d.rows ?? []);
    } catch {/**/}
    setDsLoading(false);
  }, []);

  useEffect(() => { void loadSessions(); void loadDataset(); }, [loadSessions, loadDataset]);

  const openSession = async (s: Session) => {
    setActiveSession(s); setEditingId(null); setSuggestion(null); setEvaluation(null);
    setMsgLoading(true);
    try {
      const r = await fetch(`/api/admin/sessions?id=${s.id}`);
      const d = (await r.json()) as { messages: Message[] };
      setMessages(d.messages ?? []);
    } catch {/**/}
    setMsgLoading(false);
  };

  /* ── Edit ── */
  const startEdit = (msg: Message, q: string) => {
    setEditingId(msg.id); setEditText(msg.content); setOriginalText(msg.content);
    setEditQ(q); setSuggestion(null); setEvaluation(null);
    setShowAB(false); setChosenSide(null); setSaveMsg(""); setSelectedLabel("good");
  };

  /* ── Auto-suggest + eval ── */
  const runAutoSuggest = async () => {
    setAiLoading(true); setSuggestion(null); setEvaluation(null);
    try {
      const r = await fetch("/api/admin/training/autosuggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: editQ, originalAnswer: originalText }),
      });
      const d = (await r.json()) as { suggestion: string; evaluation: EvalResult };
      setSuggestion(d.suggestion ?? null);
      setEvaluation(d.evaluation ?? null);
      if (d.evaluation?.label) setSelectedLabel(d.evaluation.label);
      setShowAB(true);
    } catch (e) { setSaveMsg(`Error: ${String(e)}`); }
    setAiLoading(false);
  };

  /* ── Save example ── */
  const saveExample = async (msgId: string, rating: 1|-1) => {
    if (!editQ) return;
    setSavingId(msgId); setSaveMsg("");
    const finalAnswer = chosenSide === "suggested" ? (suggestion ?? editText) : editText;
    const r = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: msgId, sessionId: activeSession?.id ?? null, question: editQ, answer: finalAnswer, citations: [], rating }),
    });
    const data = (await r.json()) as { id?: string; error?: string };
    if (data.error) { setSaveMsg(`Error: ${data.error}`); setSavingId(null); return; }
    if (rating === 1 && data.id) {
      await fetch(`/api/admin/feedback/${data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved", correction: finalAnswer, correctionNote: selectedLabel, reviewedBy: "playground" }),
      });
    }
    setSaveMsg(rating === 1 ? `✓ Saved as good example [${selectedLabel}]` : "✓ Marked as bad");
    setSavingId(null); void loadDataset();
  };

  /* ── Live test ── */
  const runLive = async () => {
    if (!liveQ.trim()) return;
    setLivePending(true); setLiveA("");
    try {
      const r = await fetch("/api/chat", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ content: liveQ }) });
      const reader = r.body?.getReader(); const dec = new TextDecoder(); let full = "";
      if (reader) {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          for (const line of dec.decode(value).split("\n")) {
            if (!line.startsWith("data:")) continue;
            try { const ev = JSON.parse(line.slice(5)) as {type:string;text?:string}; if (ev.type==="token"&&ev.text) full+=ev.text; } catch {/**/}
          }
          setLiveA(full);
        }
      }
    } catch (e) { setLiveA(`Error: ${String(e)}`); }
    setLivePending(false);
  };

  /* ── Batch eval ── */
  const runBatch = async () => {
    setBatchRunning(true); setBatchResults(null); setBatchSummary(null);
    try {
      const tests = JSON.parse(batchInput) as {question:string;expectedKeywords?:string[];expectedPartNumber?:string}[];
      const r = await fetch("/api/admin/training/batch-eval", {
        method: "POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ tests }),
      });
      const d = (await r.json()) as { results: BatchResult[]; summary: typeof batchSummary };
      setBatchResults(d.results); setBatchSummary(d.summary);
    } catch (e) { setSaveMsg(`Batch error: ${String(e)}`); }
    setBatchRunning(false);
  };

  /* ── Prompt test ── */
  const runPromptTest = async () => {
    if (!promptQ.trim()) return;
    setPromptRunning(true); setPromptA(""); setPromptCitations([]);
    try {
      const r = await fetch("/api/admin/training/prompt-test", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ systemPrompt: promptText, question: promptQ, useRag: true }),
      });
      const d = (await r.json()) as { answer: string; citations:{documentName:string}[] };
      setPromptA(d.answer ?? ""); setPromptCitations(d.citations ?? []);
    } catch (e) { setPromptA(`Error: ${String(e)}`); }
    setPromptRunning(false);
  };

  /* ── Export ── */
  const exportDataset = async (format: "jsonl"|"csv") => {
    setExporting(true);
    const r = await fetch(`/api/admin/feedback/export?format=${format}`);
    const text = await r.text();
    const blob = new Blob([text], { type: format==="jsonl"?"application/jsonl":"text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href=url; a.download=`training_data.${format}`; a.click();
    URL.revokeObjectURL(url); setExporting(false);
  };

  /* ── Helpers ── */
  const pairs: {question:Message;answer:Message}[] = [];
  for (let i=0;i<messages.length-1;i++) {
    if (messages[i].role==="user"&&messages[i+1].role==="assistant") { pairs.push({question:messages[i],answer:messages[i+1]}); i++; }
  }
  const filteredSessions = sessions.filter(s => !sessSearch || s.title.toLowerCase().includes(sessSearch.toLowerCase()));

  /* ════════════════ Render ════════════════ */
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-20">
        <Link href="/" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><ArrowLeft className="h-4 w-4"/></Link>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-gray-900">AI Training Playground</h1>
          <p className="text-xs text-gray-500">Edit · Score · A/B Test · Batch Eval · Prompt Editor · Export</p>
        </div>
        {/* Tab buttons */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
          {([
            {id:"conversations",icon:MessageSquare,label:"Conversations"},
            {id:"batch",icon:FlaskConical,label:"Batch Eval"},
            {id:"prompt",icon:Settings2,label:"Prompt Editor"},
          ] as const).map(t=>(
            <button key={t.id} type="button" onClick={()=>setTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${tab===t.id?"bg-white shadow text-gray-900":"text-gray-500 hover:text-gray-700"}`}>
              <t.icon className="h-3.5 w-3.5"/>{t.label}
            </button>
          ))}
        </div>
        <Link href="/admin/training" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-xs font-medium hover:bg-gray-50">
          <BookOpen className="h-3.5 w-3.5"/>SME Review
        </Link>
      </header>

      {/* ════ TAB: Conversations ════ */}
      {tab==="conversations" && (
        <div className="flex flex-1 overflow-hidden" style={{height:"calc(100vh - 57px)"}}>

          {/* Left: session list */}
          <aside className="w-60 shrink-0 border-r border-gray-200 bg-white flex flex-col overflow-hidden">
            <div className="p-3 border-b border-gray-100">
              <input value={sessSearch} onChange={e=>setSessSearch(e.target.value)}
                placeholder="Search…" className="w-full px-3 py-1.5 rounded-lg border border-gray-300 text-xs focus:ring-2 focus:ring-blue-500 outline-none"/>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
              {sessLoading && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-gray-400"/></div>}
              {!sessLoading && filteredSessions.length===0 && <p className="text-xs text-gray-400 text-center py-8">No conversations</p>}
              {filteredSessions.map(s=>(
                <button key={s.id} type="button" onClick={()=>void openSession(s)}
                  className={`w-full text-left px-3 py-3 hover:bg-blue-50 transition-colors ${activeSession?.id===s.id?"bg-blue-50 border-l-2 border-l-blue-500":""}`}>
                  <p className="text-xs font-semibold text-gray-800 truncate">{s.title||"Untitled"}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{timeAgo(s.updatedAt)}</p>
                </button>
              ))}
            </div>
            <button type="button" onClick={()=>void loadSessions()} className="p-2 border-t border-gray-100 text-xs text-gray-400 hover:text-gray-600 flex items-center justify-center gap-1">
              <RefreshCw className="h-3 w-3"/>Refresh
            </button>
          </aside>

          {/* Centre: conversation + edit */}
          <main className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Live test bar */}
            <div className="bg-purple-50 rounded-xl border border-purple-200 p-3 flex gap-2">
              <input value={liveQ} onChange={e=>setLiveQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&void runLive()}
                placeholder="Quick live test — ask anything…" className="flex-1 px-3 py-1.5 rounded-lg border border-purple-300 text-xs focus:ring-2 focus:ring-purple-500 outline-none"/>
              <button type="button" disabled={livePending||!liveQ.trim()} onClick={()=>void runLive()}
                className="px-3 py-1.5 rounded-lg bg-purple-600 text-white text-xs font-semibold hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1">
                {livePending?<Loader2 className="h-3.5 w-3.5 animate-spin"/>:<Zap className="h-3.5 w-3.5"/>}Ask
              </button>
            </div>
            {liveA && (
              <div className="bg-white rounded-xl border border-purple-200 p-3 text-xs text-gray-800 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto">
                <p className="text-xs font-semibold text-purple-600 mb-1">Live response:</p>{liveA}
              </div>
            )}

            {!activeSession && !msgLoading && (
              <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <MessageSquare className="h-12 w-12 mb-3 text-gray-200"/>
                <p className="font-medium text-gray-500">Select a conversation on the left</p>
              </div>
            )}
            {msgLoading && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-400"/></div>}

            {activeSession && !msgLoading && pairs.map(({question,answer},idx)=>(
              <div key={answer.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                {/* Question */}
                <div className="px-4 py-3 bg-blue-50 border-b border-blue-100">
                  <p className="text-xs text-blue-500 font-semibold mb-1">Q{idx+1}</p>
                  <p className="text-sm text-gray-800">{question.content}</p>
                </div>
                {/* Answer */}
                <div className="px-4 py-3">
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-xs font-semibold text-gray-500">AI Answer</p>
                    <span className="text-xs text-gray-400">{timeAgo(answer.createdAt)}</span>
                    {editingId!==answer.id && (
                      <button type="button" onClick={()=>startEdit(answer,question.content)}
                        className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs border border-gray-300 hover:bg-gray-50 text-gray-600">
                        <Edit3 className="h-3 w-3"/>Edit & Train
                      </button>
                    )}
                  </div>

                  {editingId===answer.id ? (
                    <div className="space-y-3">
                      {/* A/B view */}
                      {showAB && suggestion ? (
                        <div className="grid grid-cols-2 gap-3">
                          <div className={`rounded-xl border-2 p-3 cursor-pointer transition-all ${chosenSide==="original"?"border-blue-500 bg-blue-50":"border-gray-200 hover:border-gray-300"}`}
                            onClick={()=>{setChosenSide("original");setEditText(originalText);}}>
                            <p className="text-xs font-semibold text-gray-500 mb-1">Original answer</p>
                            <p className="text-xs text-gray-700 leading-relaxed">{originalText.slice(0,400)}</p>
                            {chosenSide==="original" && <p className="text-xs text-blue-600 font-semibold mt-1">✓ Selected</p>}
                          </div>
                          <div className={`rounded-xl border-2 p-3 cursor-pointer transition-all ${chosenSide==="suggested"?"border-green-500 bg-green-50":"border-gray-200 hover:border-gray-300"}`}
                            onClick={()=>{setChosenSide("suggested");setEditText(suggestion);}}>
                            <p className="text-xs font-semibold text-gray-500 mb-1">AI-suggested improvement</p>
                            <p className="text-xs text-gray-700 leading-relaxed">{suggestion.slice(0,400)}</p>
                            {chosenSide==="suggested" && <p className="text-xs text-green-600 font-semibold mt-1">✓ Selected</p>}
                          </div>
                        </div>
                      ) : (
                        <textarea value={editText} onChange={e=>setEditText(e.target.value)} rows={5}
                          className="w-full px-3 py-2 rounded-xl border border-blue-300 text-sm font-mono leading-relaxed resize-none focus:ring-2 focus:ring-blue-500 outline-none"/>
                      )}

                      {/* AI eval score */}
                      {evaluation && (
                        <div className="bg-gray-50 rounded-xl border border-gray-200 p-3 space-y-2">
                          <p className="text-xs font-semibold text-gray-700">AI Self-Evaluation</p>
                          <ScoreBar score={evaluation.overall*10} label={evaluation.label}/>
                          <div className="grid grid-cols-2 gap-1 text-xs">
                            {Object.entries(evaluation.dimensions).map(([k,v])=>(
                              <div key={k} className="flex justify-between text-gray-500">
                                <span>{k.replace(/_/g," ")}</span>
                                <span className="font-mono font-semibold">{v}/10</span>
                              </div>
                            ))}
                          </div>
                          {evaluation.issues.length>0 && (
                            <div className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2">
                              <p className="font-semibold mb-0.5">Issues found:</p>
                              <ul className="list-disc pl-4 space-y-0.5">{evaluation.issues.map(i=><li key={i}>{i}</li>)}</ul>
                            </div>
                          )}
                          <p className="text-xs text-gray-500 italic">{evaluation.reasoning}</p>
                        </div>
                      )}

                      {/* Label picker */}
                      <div>
                        <p className="text-xs text-gray-500 font-semibold mb-1.5 flex items-center gap-1"><Tag className="h-3 w-3"/>Label this example</p>
                        <div className="flex flex-wrap gap-1.5">
                          {LABEL_OPTIONS.map(l=>(
                            <button key={l.value} type="button" onClick={()=>setSelectedLabel(l.value)}
                              className={`px-2.5 py-1 rounded-full text-xs font-medium border-2 transition-all ${selectedLabel===l.value?`${l.cls} border-current scale-105`:"border-gray-200 text-gray-500 hover:border-gray-300"}`}>
                              {l.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Action row */}
                      <div className="flex flex-wrap gap-2 items-center pt-1">
                        <button type="button" disabled={aiLoading} onClick={()=>void runAutoSuggest()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 text-white text-xs font-semibold hover:bg-purple-700 disabled:opacity-50">
                          {aiLoading?<Loader2 className="h-3.5 w-3.5 animate-spin"/>:<Sparkles className="h-3.5 w-3.5"/>}
                          {showAB?"Re-suggest":"Auto-suggest + Score"}
                        </button>
                        {showAB && (
                          <button type="button" onClick={()=>{setShowAB(false);setEditText(originalText);setChosenSide(null);}}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-300 text-gray-600 text-xs hover:bg-gray-50">
                            <ArrowLeftRight className="h-3.5 w-3.5"/>Edit manually
                          </button>
                        )}
                        <button type="button" disabled={savingId===answer.id} onClick={()=>void saveExample(answer.id,1)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs font-semibold hover:bg-green-700 disabled:opacity-50">
                          <ThumbsUp className="h-3.5 w-3.5"/>Good example
                        </button>
                        <button type="button" disabled={savingId===answer.id} onClick={()=>void saveExample(answer.id,-1)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-50">
                          <ThumbsDown className="h-3.5 w-3.5"/>Bad example
                        </button>
                        <button type="button" onClick={()=>{setEditingId(null);setSuggestion(null);setEvaluation(null);setShowAB(false);}}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-300 text-gray-600 text-xs hover:bg-gray-50">
                          <X className="h-3.5 w-3.5"/>Cancel
                        </button>
                        {saveMsg && <span className={`text-xs font-medium ${saveMsg.startsWith("Error")?"text-red-600":"text-green-700"}`}>{saveMsg}</span>}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap line-clamp-5">{answer.content}</p>
                  )}
                </div>
              </div>
            ))}
          </main>

          {/* Right: dataset */}
          <aside className="w-64 shrink-0 border-l border-gray-200 bg-white flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-gray-900">Fine-tune Dataset</p>
                <p className="text-xs text-gray-500">{dataset.length} examples</p>
              </div>
              <button type="button" onClick={()=>void loadDataset()} className="p-1 text-gray-400 hover:text-gray-600">
                <RefreshCw className={`h-3.5 w-3.5 ${dsLoading?"animate-spin":""}`}/>
              </button>
            </div>
            <div className="px-3 py-2 border-b border-gray-100 flex gap-2">
              <button type="button" disabled={exporting||dataset.length===0} onClick={()=>void exportDataset("jsonl")}
                className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 rounded-lg bg-gray-900 text-white text-xs font-semibold hover:bg-gray-700 disabled:opacity-40">
                <Download className="h-3 w-3"/>JSONL
              </button>
              <button type="button" disabled={exporting||dataset.length===0} onClick={()=>void exportDataset("csv")}
                className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-xs font-semibold hover:bg-gray-50 disabled:opacity-40">
                <Download className="h-3 w-3"/>CSV
              </button>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
              {dsLoading && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-gray-300"/></div>}
              {!dsLoading && dataset.length===0 && (
                <div className="text-center py-10 px-4 text-gray-400">
                  <BookOpen className="h-8 w-8 mx-auto mb-2 text-gray-200"/>
                  <p className="text-xs font-medium">No examples yet</p>
                  <p className="text-xs mt-1">Edit an answer → click "Good example"</p>
                </div>
              )}
              {dataset.map(row=>(
                <div key={row.id} className="px-3 py-2.5">
                  <div className="flex items-center gap-1 mb-0.5">
                    {row.rating===1?<ThumbsUp className="h-3 w-3 text-green-600 shrink-0"/>:<ThumbsDown className="h-3 w-3 text-red-500 shrink-0"/>}
                    {row.correctionNote && (
                      <span className={`text-xs px-1.5 rounded-full ${LABEL_OPTIONS.find(l=>l.value===row.correctionNote)?.cls??"bg-gray-100 text-gray-600"}`}>{row.correctionNote}</span>
                    )}
                    <span className="ml-auto text-xs text-gray-400">{timeAgo(row.createdAt)}</span>
                  </div>
                  <p className="text-xs text-gray-700 font-medium line-clamp-1">{row.question}</p>
                  <p className="text-xs text-gray-400 line-clamp-1">{row.correction??row.answer}</p>
                </div>
              ))}
            </div>
            <div className="px-3 py-3 border-t border-gray-100 bg-gray-50 text-xs text-gray-500">
              <p className="font-semibold text-gray-700 mb-1">JSONL format</p>
              <p>Compatible with OpenAI fine-tuning. Each row = one training example with system + user + assistant messages.</p>
            </div>
          </aside>
        </div>
      )}

      {/* ════ TAB: Batch Eval ════ */}
      {tab==="batch" && (
        <div className="max-w-4xl mx-auto px-4 py-6 space-y-5 w-full">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4">
            <div>
              <h2 className="font-bold text-gray-900">Batch Evaluation</h2>
              <p className="text-xs text-gray-500 mt-0.5">Run multiple test questions at once — each is scored automatically against expected keywords and citations</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-1.5">Test cases (JSON array)</p>
              <textarea value={batchInput} onChange={e=>setBatchInput(e.target.value)} rows={8}
                className="w-full px-3 py-2 rounded-xl border border-gray-300 text-xs font-mono resize-none focus:ring-2 focus:ring-blue-500 outline-none"/>
              <p className="text-xs text-gray-400 mt-1">
                Fields: <code className="bg-gray-100 px-1 rounded">question</code> (required),{" "}
                <code className="bg-gray-100 px-1 rounded">expectedKeywords</code> (array),{" "}
                <code className="bg-gray-100 px-1 rounded">expectedPartNumber</code> (string)
              </p>
            </div>
            <button type="button" disabled={batchRunning} onClick={()=>void runBatch()}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
              {batchRunning?<Loader2 className="h-4 w-4 animate-spin"/>:<FlaskConical className="h-4 w-4"/>}
              {batchRunning?"Running…":"Run Batch Evaluation"}
            </button>
          </div>

          {/* Summary */}
          {batchSummary && (
            <div className="grid grid-cols-5 gap-3">
              {[
                {label:"Total",    value:batchSummary.total,    cls:"bg-white"},
                {label:"Passed",   value:batchSummary.passed,   cls:"bg-green-50 border-green-200"},
                {label:"Failed",   value:batchSummary.failed,   cls:batchSummary.failed>0?"bg-red-50 border-red-200":"bg-white"},
                {label:"Avg Score",value:`${batchSummary.avgScore}%`,cls:"bg-white"},
                {label:"Avg Time", value:`${batchSummary.avgLatency}ms`,cls:"bg-white"},
              ].map(c=>(
                <div key={c.label} className={`rounded-xl border border-gray-200 ${c.cls} px-3 py-2.5 text-center`}>
                  <p className="text-2xl font-bold text-gray-900">{c.value}</p>
                  <p className="text-xs text-gray-500">{c.label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Results table */}
          {batchResults && (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-semibold text-gray-600">Question</th>
                    <th className="text-left px-3 py-2.5 font-semibold text-gray-600 w-48">Score</th>
                    <th className="px-3 py-2.5 font-semibold text-gray-600 w-16">Pass</th>
                    <th className="text-right px-3 py-2.5 font-semibold text-gray-600 w-20">Latency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {batchResults.map((r,i)=>(
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-800 mb-0.5">{r.question}</p>
                        {r.error && <p className="text-red-500">{r.error}</p>}
                        {!r.error && (
                          <p className="text-gray-400 line-clamp-1">{r.answer}</p>
                        )}
                        {r.details.keywordsMissed && r.details.keywordsMissed.length>0 && (
                          <p className="text-amber-600 mt-0.5">Missing: {r.details.keywordsMissed.join(", ")}</p>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                            <div className={`h-1.5 rounded-full ${r.score>=80?"bg-green-500":r.score>=60?"bg-amber-400":"bg-red-500"}`} style={{width:`${r.score}%`}}/>
                          </div>
                          <span className="font-mono w-8 text-right">{r.score}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center">
                        {r.pass
                          ? <CheckCircle className="h-4 w-4 text-green-500 mx-auto"/>
                          : <XCircle className="h-4 w-4 text-red-500 mx-auto"/>
                        }
                      </td>
                      <td className="px-3 py-3 text-right text-gray-500">{r.latencyMs}ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ════ TAB: Prompt Editor ════ */}
      {tab==="prompt" && (
        <div className="max-w-5xl mx-auto px-4 py-6 space-y-5 w-full">
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800">
            <p className="font-semibold">⚠️ Prompt Editor — changes here are for testing only</p>
            <p>To permanently change the system prompt, update <code>PERSONA</code> and <code>ANSWER_RULES</code> in <code>src/lib/chat/graph.ts</code> then redeploy.</p>
          </div>
          <div className="grid grid-cols-2 gap-5">
            {/* Editor */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 space-y-3">
              <h2 className="font-bold text-gray-900 text-sm">System Prompt</h2>
              <textarea value={promptText} onChange={e=>setPromptText(e.target.value)} rows={16}
                className="w-full px-3 py-2 rounded-xl border border-gray-300 text-xs font-mono leading-relaxed resize-none focus:ring-2 focus:ring-blue-500 outline-none"/>
              <div className="flex gap-2">
                <input value={promptQ} onChange={e=>setPromptQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&void runPromptTest()}
                  placeholder="Test question…" className="flex-1 px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-blue-500 outline-none"/>
                <button type="button" disabled={promptRunning||!promptQ.trim()} onClick={()=>void runPromptTest()}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
                  {promptRunning?<Loader2 className="h-4 w-4 animate-spin"/>:<Play className="h-4 w-4"/>}Test
                </button>
              </div>
            </div>
            {/* Result */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 space-y-3">
              <h2 className="font-bold text-gray-900 text-sm">AI Response</h2>
              {promptRunning && <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-gray-400"/></div>}
              {!promptRunning && !promptA && (
                <div className="flex flex-col items-center justify-center py-20 text-gray-300">
                  <Play className="h-10 w-10 mb-2"/>
                  <p className="text-sm">Enter a question and click Test</p>
                </div>
              )}
              {promptA && (
                <>
                  <div className="rounded-xl bg-gray-50 border border-gray-200 p-3 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto">{promptA}</div>
                  {promptCitations.length>0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 mb-1">Sources used ({promptCitations.length})</p>
                      <div className="flex flex-wrap gap-1.5">
                        {promptCitations.map((c,i)=>(
                          <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">{c.documentName}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  <button type="button" onClick={()=>void runPromptTest()} className="text-xs text-blue-600 hover:underline">Re-run</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
