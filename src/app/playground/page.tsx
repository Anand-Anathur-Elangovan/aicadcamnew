"use client";

// /playground — CNC Virtual Dry-Run Playground
// Select machine + tools → choose stock template (rod / plate / casting) or upload STEP
// Write / paste G-code → click Play → 3D animation runs in browser
// Zero risk: no machine touches, fully virtual

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { Play, Pause, RotateCcw, Download, Wrench, Cpu, ChevronDown, ChevronUp, Upload, Zap } from "lucide-react";
import { parseGCode } from "@/lib/gcode/parser";
import { inferSetup, prepareSim } from "@/lib/sim/prepare";

const GCodeMonacoEditor = dynamic(() => import("@/components/studio/GCodeMonacoEditor"), { ssr: false });
const CutSimViewport    = dynamic(() => import("@/components/studio/CutSimViewport"),    { ssr: false });

// ─── Types ───────────────────────────────────────────────────────────────────
interface DbMachine { id: string; machine_id: string; name: string; display_name?: string; kind: string; controller: string; max_rpm: number | null; }
interface DbTool    { id: string; tool_no: string; description: string; kind: string; diameter_mm: number | null; }

interface StockTemplate {
  id: string;
  label: string;
  desc: string;
  icon: string;
  gcode: string;
  dims: string;
}

// ─── Stock templates with starter G-code programs ────────────────────────────
const TEMPLATES: StockTemplate[] = [
  {
    id: "rod",
    label: "Round Rod (CNC Lathe)",
    desc: "Ø50 × 80 mm bar in 3-jaw chuck — OD turning & facing",
    icon: "🔵",
    dims: "Ø50×80",
    gcode: `%
O0001 (ROUND ROD - CNC LATHE OD TURNING)
(Machine: LTH-01  Tool: T0101 OD Turning Insert)
G21 G18 G40 G99

T0101 (OD ROUGHING INSERT)
G97 S1200 M03
G00 X54. Z2.

(--- Face end ---)
G01 Z0. F0.2
G01 X-1. F0.15
G00 Z2.

(--- OD Turn Ø50 -> Ø36 along Z-50 ---)
G00 X46. Z2.
G01 Z-50. F0.25
G00 X48. Z2.
G00 X42.
G01 Z-50. F0.25
G00 X44. Z2.
G00 X38.
G01 Z-50. F0.2
G00 X40. Z2.
G00 X36.
G01 Z-50. F0.15
G00 X54. Z20.

M05
M30
%`,
  },
  {
    id: "plate",
    label: "Flat Plate",
    desc: "100 × 80 × 25 mm plate — milling / drilling job",
    icon: "🟦",
    dims: "100×80×25",
    gcode: `%
O0002 (FLAT PLATE - 100x80x25)
(Machine: VMC-01  Tool: T01 Ø12 Endmill, T04 Ø10 Drill)
G21 G17 G40 G49 G80 G90

T01 M06 (Ø12 Endmill)
G43 H01 Z50.
S2500 M03

(--- Face mill top ---) 
G00 X-60. Y-50.
Z5.
G01 Z0. F200.
G01 X60. F600.
G00 Y-30.
G01 X-60. F600.
G00 Y-10.
G01 X60. F600.
G00 Y10.
G01 X-60. F600.
G00 Z50.

T04 M06 (Ø10 Drill)
G43 H04 Z50.
S2000 M03

(--- 4 corner holes ---) 
G81 Z-30. R5. F200.
X-35. Y-25.
X35.
X35. Y25.
X-35.
G80

G00 Z50.
M05
M30
%`,
  },
  {
    id: "casting",
    label: "Casting / Forging",
    desc: "80 × 80 × 60 mm near-net shape — semi-finish operations",
    icon: "🟫",
    dims: "80×80×60",
    gcode: `%
O0003 (CASTING 80x80x60)
(Machine: VMC-01  Tool: T03 Ø20 Face Mill, T06 Ø28 Boring)
G21 G17 G40 G49 G80 G90

T03 M06 (Ø20 Face Mill)
G43 H03 Z50.
S2000 M03

(--- Rough face ---) 
G00 X-50. Y0.
Z5.
G01 Z0. F150.
G01 X50. F400.
G00 Z50.

T06 M06 (Ø28 Boring Bar)
G43 H06 Z50.
S800 M03

(--- Bore Ø28 H7 ---) 
G00 X0. Y0.
Z5.
G85 Z-40. R5. F80.
G80

G00 Z50.
M05
M30
%`,
  },
  {
    id: "blank",
    label: "Blank (write your own)",
    desc: "Start from an empty program",
    icon: "⬜",
    dims: "80×80×80",
    gcode: `%
O0010 (MY PROGRAM)
G21 G17 G40 G49 G80 G90

T01 M06
G43 H01 Z50.
S2000 M03

(--- Write your G-code here ---)
G00 X0. Y0.
G00 Z5.


G00 Z50.
M05
M30
%`,
  },
];

// ─── Page ────────────────────────────────────────────────────────────────────
export default function PlaygroundPage() {
  const [machines, setMachines] = useState<DbMachine[]>([]);
  const [tools, setTools]       = useState<DbTool[]>([]);
  const [selMachine, setSelMachine] = useState<DbMachine | null>(null);
  const [selTools, setSelTools]     = useState<DbTool[]>([]);
  const [template, setTemplate]     = useState<StockTemplate>(TEMPLATES[0]);
  const [gcode, setGcode]           = useState(TEMPLATES[0].gcode);
  const [isPlaying, setIsPlaying]   = useState(false);
  const [highlightLine, setHighlightLine] = useState<number | undefined>();
  const [showToolPicker, setShowToolPicker] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState("");
  const [simKey, setSimKey] = useState(0);

  const gcodeRef = useRef(gcode);
  useEffect(() => { gcodeRef.current = gcode; }, [gcode]);

  useEffect(() => {
    fetch("/api/machines").then(r => r.json()).then((d: DbMachine[]) => {
      const list = Array.isArray(d) ? d : [];
      setMachines(list);
      if (list.length) setSelMachine(list[0]);
    }).catch(() => {});
    fetch("/api/tools").then(r => r.json()).then((d: DbTool[]) => {
      const list = Array.isArray(d) ? d : [];
      setTools(list);
      setSelTools(list.slice(0, 3));
    }).catch(() => {});
  }, []);

  const selectTemplate = useCallback((t: StockTemplate) => {
    setTemplate(t);
    setGcode(t.gcode);
    setIsPlaying(false);
  }, []);

  const toggleTool = (t: DbTool) => {
    setSelTools(prev =>
      prev.find(x => x.id === t.id) ? prev.filter(x => x.id !== t.id) : [...prev, t]
    );
  };

  // Rebuild the 3D job only when G-code text changes — not on play/pause.
  const simJob = useMemo(() => {
    if (!gcode.trim()) return null;
    try {
      const setup = inferSetup(gcode);
      return prepareSim(gcode, setup);
    } catch {
      return null;
    }
  }, [gcode]);

  // Auto-generate G-code from template + machine + tools using AI
  const autoGenerate = useCallback(async () => {
    if (!selMachine) return;
    setGenerating(true);
    setGenProgress("Sending to AI…");
    try {
      const machineCtx = `${selMachine.machine_id} – ${selMachine.name}`;
      const toolList = selTools.length
        ? selTools.map(t => `${t.tool_no}: ${t.description}`).join(", ")
        : "default tooling";
      const prompt = `Stock: ${template.label} (${template.dims} mm). Machine: ${machineCtx}. Tools: ${toolList}. Generate a complete Fanuc G-code program for this setup.`;

      // Use the prompt-test endpoint from training playground
      const r = await fetch("/api/admin/training/prompt-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemPrompt: "You are a CNC programming expert. Generate production-ready Fanuc G-code. Output only the G-code program, no explanation. Start with % and end with M30 and %.",
          question: prompt,
          useRag: false,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json() as { answer: string };
      // Extract just the G-code block
      const raw = data.answer;
      const start = raw.indexOf("%");
      const end   = raw.lastIndexOf("%");
      const extracted = start !== -1 && end > start ? raw.slice(start, end + 1) : raw;
      setGcode(extracted);
      setIsPlaying(false);
      setGenProgress("");
    } catch (err) {
      setGenProgress(err instanceof Error ? err.message : "Failed");
      setTimeout(() => setGenProgress(""), 4000);
    } finally {
      setGenerating(false);
    }
  }, [selMachine, selTools, template]);

  const handleLineClick = useCallback((lineIdx: number) => {
    setHighlightLine(lineIdx);
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-3">
          <Zap className="text-cyan-400" size={20} />
          <span className="font-bold text-lg">CNC Playground</span>
          <span className="text-xs text-zinc-500">Virtual Dry-Run — no machine risk</span>
        </div>
        <a href="/studio" className="text-xs text-zinc-500 hover:text-zinc-300 transition">← Back to Studio</a>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* ── Left config panel ── */}
        <div className="w-72 shrink-0 border-r border-zinc-800 overflow-y-auto p-4 space-y-5">

          {/* Machine */}
          <div>
            <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1 mb-2">
              <Cpu size={12}/> Machine
            </label>
            <select
              className="w-full text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100"
              value={selMachine?.id ?? ""}
              onChange={e => {
                const found = machines.find(m => m.id === e.target.value);
                setSelMachine(found ?? null);
              }}
            >
              {machines.length > 0 ? (
                machines.map(m => {
                  const kindLabel: Record<string, string> = { vmc: "VMC", lathe: "CNC Lathe", vmc5: "5-Axis VMC", lathe5: "5-Axis Lathe", grinder: "Grinder", edm: "EDM" };
                  const label = kindLabel[m.kind] ?? m.kind?.toUpperCase() ?? "Machine";
                  const display = m.display_name && m.display_name !== m.machine_id ? m.display_name : m.name;
                  return (
                    <option key={m.id} value={m.id}>
                      {m.machine_id} — {display} ({label})
                    </option>
                  );
                })
              ) : (
                <>
                  <option value="vmc01">VMC-01 — 3-Axis VMC, Fanuc</option>
                  <option value="vmc02">VMC-02 — 5-Axis VMC, Fanuc</option>
                  <option value="lth01">LTH-01 — CNC Lathe, Fanuc</option>
                  <option value="lth02">LTH-02 — CNC Lathe, Haas</option>
                  <option value="generic-vmc">Generic — 3-Axis VMC</option>
                  <option value="generic-lathe">Generic — CNC Lathe</option>
                </>
              )}
            </select>
            {selMachine && (
              <p className="text-[10px] text-zinc-500 mt-1">
                {({ vmc: "Vertical Machining Centre", lathe: "CNC Turning Centre", vmc5: "5-Axis VMC", lathe5: "5-Axis Lathe", grinder: "CNC Grinder", edm: "EDM" } as Record<string, string>)[selMachine.kind] ?? selMachine.kind?.toUpperCase()}
                {" · "}{selMachine.controller?.toUpperCase()}
                {selMachine.max_rpm ? ` · ${selMachine.max_rpm.toLocaleString()} RPM` : ""}
              </p>
            )}
          </div>

          {/* Tools */}
          <div>
            <button
              className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1 w-full text-left mb-2"
              onClick={() => setShowToolPicker(v => !v)}
            >
              <Wrench size={12}/> Tools ({selTools.length} selected)
              {showToolPicker ? <ChevronUp size={12} className="ml-auto"/> : <ChevronDown size={12} className="ml-auto"/>}
            </button>
            {showToolPicker && (
              <div className="bg-zinc-800 rounded p-2 max-h-52 overflow-y-auto space-y-1">
                {tools.map(t => {
                  const on = !!selTools.find(x => x.id === t.id);
                  return (
                    <label key={t.id} className={`flex items-center gap-2 text-xs cursor-pointer rounded px-2 py-1 ${on ? "bg-cyan-900/40 text-cyan-200" : "text-zinc-300 hover:bg-zinc-700"}`}>
                      <input type="checkbox" checked={on} onChange={() => toggleTool(t)} className="accent-cyan-500"/>
                      <span className="font-mono text-cyan-500 w-7 shrink-0">{t.tool_no}</span>
                      <span className="truncate">{t.description}</span>
                      {t.diameter_mm && <span className="text-zinc-500 ml-auto shrink-0">Ø{t.diameter_mm}</span>}
                    </label>
                  );
                })}
                {tools.length === 0 && <p className="text-zinc-600 text-xs text-center py-2">Add tools in Admin → Machines</p>}
              </div>
            )}
            {selTools.length > 0 && !showToolPicker && (
              <div className="flex flex-wrap gap-1 mt-1">
                {selTools.map(t => (
                  <span key={t.id} className="text-[10px] bg-cyan-900/30 text-cyan-300 px-1.5 py-0.5 rounded font-mono">{t.tool_no}</span>
                ))}
              </div>
            )}
          </div>

          {/* Stock template */}
          <div>
            <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2 block">Stock Template</label>
            <div className="space-y-1.5">
              {TEMPLATES.map(t => (
                <button
                  key={t.id}
                  onClick={() => selectTemplate(t)}
                  className={`w-full text-left rounded-lg px-3 py-2.5 border transition ${
                    template.id === t.id
                      ? "border-cyan-600 bg-cyan-900/20 text-cyan-200"
                      : "border-zinc-700 hover:border-zinc-600 text-zinc-300"
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs font-medium">
                    <span>{t.icon}</span> {t.label}
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">{t.dims} mm</div>
                </button>
              ))}
            </div>

            {/* Upload custom STEP */}
            <label className="mt-2 flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer border border-dashed border-zinc-700 rounded px-3 py-2">
              <Upload size={12}/> Upload STEP / STL
              <input type="file" className="hidden" accept=".stp,.step,.stl"
                onChange={() => alert("STEP import coming next — for now use a template to get started")} />
            </label>
          </div>

          {/* AI generate */}
          <div className="border-t border-zinc-800 pt-4">
            <button
              onClick={autoGenerate}
              disabled={generating || !selMachine}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-cyan-700 hover:bg-cyan-600 text-white text-xs font-semibold disabled:opacity-50 transition"
            >
              <Zap size={13}/>
              {generating ? genProgress || "Generating…" : "AI Generate G-code"}
            </button>
            <p className="text-[10px] text-zinc-600 text-center mt-1">
              AI writes a program for the selected machine + tools + stock
            </p>
          </div>
        </div>

        {/* ── Centre: 3D viewport ── */}
        <div className="flex flex-col flex-1 min-w-0">
          {/* Playback toolbar */}
          <div className="flex items-center gap-3 px-4 py-2 border-b border-zinc-800 shrink-0">
            <button
              onClick={() => setIsPlaying(v => !v)}
              disabled={!simJob}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition ${
                isPlaying ? "bg-amber-600 hover:bg-amber-700 text-white" : "bg-cyan-600 hover:bg-cyan-700 text-white"
              } disabled:opacity-40`}
            >
              {isPlaying ? <><Pause size={13}/> Pause</> : <><Play size={13}/> Play</>}
            </button>
            <button
              onClick={() => { setIsPlaying(false); setSimKey(k => k + 1); }}
              className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1.5 rounded hover:bg-zinc-800"
            >
              <RotateCcw size={13}/> Reset
            </button>
            {simJob && (
              <span className="text-xs text-zinc-500 ml-2">
                {simJob.report?.moves ?? 0} moves · {selMachine?.machine_id ?? "—"}
              </span>
            )}
            {!simJob && gcode.trim() && (
              <span className="text-xs text-amber-500">Parse error — check G-code</span>
            )}
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => {
                  const blob = new Blob([gcode], { type: "text/plain" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = `playground_${template.id}.nc`;
                  a.click();
                }}
                className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1.5 rounded hover:bg-zinc-800"
              >
                <Download size={13}/> Export .nc
              </button>
            </div>
          </div>

          {/* 3D Sim */}
          <div className="flex-1 relative bg-zinc-900">
            {simJob ? (
              <CutSimViewport
                key={simKey}
                job={simJob}
                isPlaying={isPlaying}
                machine={selMachine?.kind}
                onLine={setHighlightLine}
                onPlayEnd={() => setIsPlaying(false)}
                onCollision={() => { setIsPlaying(false); }}
                onPause={() => setIsPlaying(false)}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-zinc-600 gap-3">
                <Zap size={40} />
                <p className="text-sm">Select a template and click <strong className="text-zinc-400">Play</strong> to start the virtual dry-run</p>
                <p className="text-xs text-zinc-700">Or write your own G-code in the editor →</p>
              </div>
            )}
          </div>
        </div>

        {/* ── Right: G-code editor ── */}
        <div className="w-96 shrink-0 border-l border-zinc-800 flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 shrink-0">
            <span className="text-xs font-semibold text-zinc-400">G-code Editor</span>
            <span className="text-[10px] text-zinc-600">Edit → Play to simulate</span>
          </div>
          <div className="flex-1 min-h-0">
            <GCodeMonacoEditor
              value={gcode}
              onChange={v => { setGcode(v); setIsPlaying(false); }}
              onSave={v => { setGcode(v); setIsPlaying(false); }}
              onLineClick={handleLineClick}
              highlightLine={highlightLine}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
