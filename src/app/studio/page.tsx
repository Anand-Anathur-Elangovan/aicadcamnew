"use client";

// /studio — Split-screen CAPP workstation
// Layout: [Left: RoutingPanel 280px] [Center: Canvas3D/2D/FAI flex-1] [Right: GCodeMonacoEditor 380px]

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import type { ProcessPlan } from "@/lib/providers/capp.provider";
import type { PartFeatures } from "@/lib/cad/featureExtractor";
import { parseGCode, type ParseResult } from "@/lib/gcode/parser";
import { downloadProgram } from "@/lib/gcode/exportProgram";
import { CONTROLLERS, POST_NOTE, lintPosted, postProcess, type Controller } from "@/lib/post";
import InfoTip from "@/components/ui/InfoTip";
import { setupFromPlan } from "@/lib/sim/fromPlan";
import { inferSetup, prepareSim, type SimJob } from "@/lib/sim/prepare";
import { verifyPlan } from "@/lib/sim/verifyPlan";
import { unsupportedFeatures } from "@/lib/studio/limitations";
import type { StagePlan } from "@/lib/studio/stages";
import { bandsawSheet, cncSheet, deburrSheet, packSheet, rawStockSheet, vmcSheet } from "@/lib/studio/stageSheets";
import RawStockSheetView from "@/components/studio/RawStockSheet";
import BandsawSheetView from "@/components/studio/BandsawSheet";
import CncSheetView from "@/components/studio/CncSheet";
import VmcSheetView from "@/components/studio/VmcSheet";
import DeburrSheetView from "@/components/studio/DeburrSheet";
import PackSheetView from "@/components/studio/PackSheet";
import StudioHeader from "@/components/studio/StudioHeader";
import RoutingPanel, { type PanelTab } from "@/components/studio/RoutingPanel";
import DiffViewerModal from "@/components/studio/DiffViewerModal";

// Dynamic imports to avoid SSR issues with Three.js + Monaco + pdfjs
const MechSimPanel = dynamic(() => import("@/components/studio/MechSimPanel"), { ssr: false });
const CutSimViewport = dynamic(() => import("@/components/studio/CutSimViewport"),     { ssr: false });
const StageViewport = dynamic(() => import("@/components/studio/StageViewport"),      { ssr: false });
const BlockViewport = dynamic(() => import("@/components/studio/BlockViewport"),       { ssr: false });
const Canvas2D      = dynamic(() => import("@/components/studio/Canvas2D"),           { ssr: false });
const AS9102FormTable = dynamic(() => import("@/components/studio/AS9102FormTable"),  { ssr: false });
const GCodeMonacoEditor = dynamic(() => import("@/components/studio/GCodeMonacoEditor"), { ssr: false });

type ViewMode = "3d" | "2d" | "fai";

export default function StudioPage() {
  const [viewMode, setViewMode]       = useState<ViewMode>("3d");
  const [gcode, setGcode]             = useState<string>("");
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [highlightLine, setHighlightLine] = useState<number | undefined>(undefined);
  const [isPlaying, setIsPlaying]     = useState(false);
  const [plan, setPlan]               = useState<ProcessPlan | null>(null);
  const [features, setFeatures]       = useState<PartFeatures | null>(null);
  const [stagePlan, setStagePlan]     = useState<StagePlan | null>(null);
  const [stageIndex, setStageIndex]   = useState(0);
  const [panelTab, setPanelTab]       = useState<PanelTab>("upload");
  const [drawingSheet, setDrawingSheet] = useState<"raw" | "bandsaw" | "cnc" | "vmc" | "deburr" | "pack" | "customer">("raw");
  const [pathMode, setPathMode] = useState<"stage" | "program">("stage");
  const [controller, setController] = useState<Controller>("fanuc");
  const [postWarnings, setPostWarnings] = useState<string[]>([]);
  const [viewer, setViewer] = useState<"built-in" | "mechsim">("built-in");
  const [pdfUrl, setPdfUrl]           = useState<string | undefined>(undefined);
  const [isGeneratingGCode, setIsGeneratingGCode] = useState(false);
  const [generatedGcodeSnapshot, setGeneratedGcodeSnapshot] = useState("");
  const [diffModalOpen, setDiffModalOpen] = useState(false);

  const gcodeRef = useRef("");
  const stagePlanRef = useRef(stagePlan);
  const stageIndexRef = useRef(stageIndex);
  const playAllRef = useRef(false);
  const pathModeRef = useRef(pathMode);
  useEffect(() => {
    stagePlanRef.current = stagePlan;
    stageIndexRef.current = stageIndex;
    pathModeRef.current = pathMode;
  }, [stagePlan, stageIndex, pathMode]);

  // When G-code changes (from editor or AI), re-parse it.
  // Ignore repeats: the editor reports the same text again while applying it.
  const loadProgram = useCallback((value: string) => {
    const next = value.replace(/\r\n/g, "\n");
    gcodeRef.current = next;
    setGcode(next);
    try {
      setParseResult(parseGCode(next));
    } catch {
      setParseResult(null);
    }
  }, []);

  const handleLineClick = useCallback((lineIdx: number) => {
    setHighlightLine(lineIdx);
  }, []);

  // AI-generated G-code
  const handleGCodeGenerated = useCallback((newGCode: string) => {
    setIsGeneratingGCode(false);
    setGeneratedGcodeSnapshot(newGCode);  // save AI baseline for diff
    loadProgram(newGCode);
    setViewMode("3d");
  }, [loadProgram]);

  const handlePlanGenerated = useCallback((newPlan: ProcessPlan, newFeatures: PartFeatures) => {
    setPlan(newPlan);
    setFeatures(newFeatures);
  }, []);

  const handleStagePlan = useCallback((next: StagePlan | null, index: number) => {
    playAllRef.current = false;
    setPathMode("program");
    setStagePlan(next);
    setStageIndex(index);
    stageIndexRef.current = index;
    setIsPlaying(false);
    const stage = next?.stages[index];
    if (stage) {
      loadProgram(stage.gcode);
      setViewMode("3d");
    }
  }, [loadProgram]);

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      playAllRef.current = false;
      setIsPlaying(false);
      return;
    }
    const current = stagePlanRef.current;
    if (current && panelTab === "plan") {
      playAllRef.current = true;
      const first = current.stages[0];
      stageIndexRef.current = 0;
      setStageIndex(0);
      if (first) loadProgram(first.gcode);
      setViewMode("3d");
      setIsPlaying(true);
      return;
    }
    if (pathModeRef.current === "program") {
      setViewMode("3d");
      setIsPlaying(true);
      return;
    }
    playAllRef.current = false;
    setIsPlaying(true);
  }, [isPlaying, panelTab, loadProgram]);

  const handleStagePlayEnd = useCallback(() => {
    const current = stagePlanRef.current;
    if (playAllRef.current && current) {
      const next = stageIndexRef.current + 1;
      const stage = current.stages[next];
      if (stage) {
        stageIndexRef.current = next;
        setStageIndex(next);
        loadProgram(stage.gcode);
        return;
      }
    }
    playAllRef.current = false;
    setIsPlaying(false);
  }, [loadProgram]);

  const handleSimCollision = useCallback(() => {
    playAllRef.current = false;
    setIsPlaying(false);
  }, []);

  const handleSimPause = useCallback(() => {
    playAllRef.current = false;
    setIsPlaying(false);
  }, []);

  const simNotes = useMemo(() => unsupportedFeatures(gcode), [gcode]);

  const planChecks = useMemo(() => {
    if (!stagePlan || viewMode !== "3d" || viewer !== "built-in") return null;
    try {
      return verifyPlan(stagePlan);
    } catch {
      return null;
    }
  }, [stagePlan, viewMode, viewer]);

  const simJob = useMemo<SimJob | null>(() => {
    if (!gcode.trim() || viewMode !== "3d" || viewer !== "built-in" || (pathMode !== "program" && stagePlan)) return null;
    try {
      const setup = stagePlan ? setupFromPlan(stagePlan, stageIndex) : inferSetup(gcode);
      return prepareSim(gcode, setup);
    } catch {
      return null;
    }
  }, [gcode, stagePlan, stageIndex, pathMode, viewMode, viewer]);

  const handleFileUploaded = useCallback((url: string) => {
    setPdfUrl(url);
  }, []);

  // Load sample G-code for demo
  const loadSample = useCallback(async () => {
    const { SAMPLE_GCODE } = await import("@/lib/gcode/parser");
    setPathMode("program");
    loadProgram(SAMPLE_GCODE);
    setViewMode("3d");
  }, [loadProgram]);

  const handleSaveProgram = useCallback((text: string) => {
    loadProgram(text);
    setPathMode("program");
    setViewMode("3d");
    setIsPlaying(false);
    setStagePlan((current) => {
      if (!current) return current;
      const index = stageIndexRef.current;
      return {
        ...current,
        stages: current.stages.map((stage, stageNumber) => stageNumber === index ? { ...stage, gcode: text.replace(/\r\n/g, "\n") } : stage),
      };
    });
  }, [loadProgram]);

  const handlePlayProgram = useCallback(() => {
    if (pathModeRef.current === "program" && isPlaying) {
      setIsPlaying(false);
      return;
    }
    setPathMode("program");
    setViewMode("3d");
    setIsPlaying(true);
  }, [isPlaying]);

  const handleExportProgram = useCallback((text: string) => {
    const stage = stagePlanRef.current?.stages[stageIndexRef.current];
    const partNumber = stagePlanRef.current?.job.partNumber ?? plan?.partNumber ?? features?.partNumber;
    const kind = /\bG18\b/.test(text) ? "lathe" : "mill";
    const posted = postProcess(text, { controller, kind });
    setPostWarnings([...posted.warnings, ...lintPosted(posted.text, controller)]);
    downloadProgram(posted.text, partNumber, stage?.opNumber);
  }, [controller, features?.partNumber, plan?.partNumber]);

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-200 overflow-hidden">
      <StudioHeader
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        partName={plan?.partName ?? features?.partName}
        isPlaying={isPlaying}
        canPlay={Boolean(stagePlan) || Boolean(parseResult?.segments.length)}
        onPlayToggle={togglePlay}
      />

      <div className="flex flex-1 min-h-0">
        {/* ── Left Panel: Routing / CAPP ── */}
        <aside className="w-72 shrink-0 border-r border-slate-700 overflow-hidden flex flex-col">
          <RoutingPanel
            onPlanGenerated={handlePlanGenerated}
            onGCodeGenerated={(g) => { setIsGeneratingGCode(false); handleGCodeGenerated(g); }}
            onFileUploaded={handleFileUploaded}
            onStagePlan={handleStagePlan}
            stageIndex={stageIndex}
            onTabChange={setPanelTab}
          />
        </aside>

        {/* ── Center: Canvas (3D / 2D / FAI) ── */}
        <main className="flex-1 min-w-0 relative overflow-hidden">
          {viewMode === "3d" && pathMode === "stage" && stagePlan?.family === "machined" && (
            <BlockViewport
              stock={stagePlan.job}
              stage={stagePlan.stages[stageIndex] ?? stagePlan.stages[0]}
              previous={stagePlan.stages[stageIndex - 1]?.completed}
              isPlaying={isPlaying}
              onPlayEnd={handleStagePlayEnd}
            />
          )}
          {viewMode === "3d" && pathMode === "stage" && stagePlan && stagePlan.family !== "machined" && (
            <StageViewport
              job={stagePlan.job}
              stage={stagePlan.stages[stageIndex] ?? stagePlan.stages[0]}
              isPlaying={isPlaying}
              onPlayEnd={handleStagePlayEnd}
            />
          )}
          {viewMode === "3d" && simJob && (
            <CutSimViewport
              job={simJob}
              isPlaying={isPlaying}
              onLine={handleLineClick}
              onCollision={handleSimCollision}
              onPlayEnd={handleStagePlayEnd}
              onPause={handleSimPause}
              planChecks={planChecks}
              notes={simNotes}
              material={stagePlan?.job.material ?? plan?.material ?? features?.material}
              machine={stagePlan?.selectedMachine}
            />
          )}
          {viewMode === "3d" && viewer === "mechsim" && (
            <MechSimPanel
              gcode={gcode}
              lathe={/\bG18\b/i.test(gcode)}
              fileName={`${stagePlan?.job.partNumber ?? plan?.partNumber ?? "program"}${stagePlan ? `-OP${stagePlan.stages[stageIndex]?.opNumber ?? 10}` : ""}.nc`}
            />
          )}
          {viewMode === "3d" && viewer === "built-in" && !simJob && (pathMode === "program" || !stagePlan) && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">
              Generate or paste G-code to see the part being cut.
            </div>
          )}

          {viewMode === "2d" && stagePlan && drawingSheet === "raw" && (
            <RawStockSheetView sheet={rawStockSheet(stagePlan)} />
          )}
          {viewMode === "2d" && stagePlan && drawingSheet === "bandsaw" && (
            <BandsawSheetView sheet={bandsawSheet(stagePlan)} />
          )}
          {viewMode === "2d" && stagePlan && drawingSheet === "cnc" && (
            <CncSheetView sheet={cncSheet(stagePlan)} />
          )}
          {viewMode === "2d" && stagePlan && drawingSheet === "vmc" && (
            <VmcSheetView sheet={vmcSheet(stagePlan)} />
          )}
          {viewMode === "2d" && stagePlan && drawingSheet === "deburr" && (
            <DeburrSheetView sheet={deburrSheet(stagePlan)} />
          )}
          {viewMode === "2d" && stagePlan && drawingSheet === "pack" && (
            <PackSheetView sheet={packSheet(stagePlan)} />
          )}
          {viewMode === "2d" && (!stagePlan || drawingSheet === "customer") && (
            <Canvas2D
              pdfUrl={pdfUrl}
              balloonsData={features?.tolerances}
            />
          )}
          {viewMode === "2d" && stagePlan && (
            <div className="absolute top-3 left-3 z-20 flex gap-2">
              <button
                type="button"
                onClick={() => setDrawingSheet("raw")}
                className={`px-3 py-1.5 text-xs font-semibold rounded ${drawingSheet === "raw" ? "bg-cyan-600 text-white" : "bg-slate-900/80 text-slate-200"}`}
              >
                Raw stock
              </button>
              <button
                type="button"
                onClick={() => setDrawingSheet("bandsaw")}
                className={`px-3 py-1.5 text-xs font-semibold rounded ${drawingSheet === "bandsaw" ? "bg-cyan-600 text-white" : "bg-slate-900/80 text-slate-200"}`}
              >
                Bandsaw
              </button>
              <button
                type="button"
                onClick={() => setDrawingSheet("cnc")}
                className={`px-3 py-1.5 text-xs font-semibold rounded ${drawingSheet === "cnc" ? "bg-cyan-600 text-white" : "bg-slate-900/80 text-slate-200"}`}
              >
                CNC
              </button>
              <button
                type="button"
                onClick={() => setDrawingSheet("vmc")}
                className={`px-3 py-1.5 text-xs font-semibold rounded ${drawingSheet === "vmc" ? "bg-cyan-600 text-white" : "bg-slate-900/80 text-slate-200"}`}
              >
                VMC
              </button>
              <button
                type="button"
                onClick={() => setDrawingSheet("deburr")}
                className={`px-3 py-1.5 text-xs font-semibold rounded ${drawingSheet === "deburr" ? "bg-cyan-600 text-white" : "bg-slate-900/80 text-slate-200"}`}
              >
                Deburr
              </button>
              <button
                type="button"
                onClick={() => setDrawingSheet("pack")}
                className={`px-3 py-1.5 text-xs font-semibold rounded ${drawingSheet === "pack" ? "bg-cyan-600 text-white" : "bg-slate-900/80 text-slate-200"}`}
              >
                Pack
              </button>
              <button
                type="button"
                onClick={() => setDrawingSheet("customer")}
                className={`px-3 py-1.5 text-xs font-semibold rounded ${drawingSheet === "customer" ? "bg-cyan-600 text-white" : "bg-slate-900/80 text-slate-200"}`}
              >
                Customer drawing
              </button>
            </div>
          )}

          {viewMode === "fai" && (
            <AS9102FormTable
              tolerances={features?.tolerances}
              partNumber={plan?.partNumber ?? features?.partNumber}
              partName={plan?.partName ?? features?.partName}
              revision={plan?.revision ?? features?.revision}
            />
          )}

          {viewMode === "3d" && (
            <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
              <button
                type="button"
                onClick={togglePlay}
                disabled={!stagePlan && !parseResult?.segments.length}
                className="px-3 py-1.5 text-xs font-semibold rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white"
              >
                {isPlaying ? "Stop" : "Play"}
              </button>
              {!stagePlan && !parseResult?.segments.length && (
                <button
                  type="button"
                  onClick={loadSample}
                  className="px-3 py-1.5 text-xs font-semibold rounded border border-slate-500 text-slate-200 hover:bg-slate-800"
                >
                  Sample path
                </button>
              )}
              <div className="flex overflow-hidden rounded border border-slate-500 text-xs font-semibold" role="group" aria-label="Simulator">
                <button
                  type="button"
                  onClick={() => setViewer("built-in")}
                  className={`px-3 py-1.5 ${viewer === "built-in" ? "bg-cyan-600 text-white" : "bg-slate-900/80 text-slate-200 hover:bg-slate-800"}`}
                >
                  Built-in
                </button>
                <button
                  type="button"
                  onClick={() => { setViewer("mechsim"); setIsPlaying(false); }}
                  className={`px-3 py-1.5 ${viewer === "mechsim" ? "bg-cyan-600 text-white" : "bg-slate-900/80 text-slate-200 hover:bg-slate-800"}`}
                >
                  MechSimulator
                </button>
              </div>
              {pathMode === "program" && stagePlan && viewer === "built-in" && (
                <button
                  type="button"
                  onClick={() => { setPathMode("stage"); setIsPlaying(false); }}
                  className="px-3 py-1.5 text-xs font-semibold rounded border border-slate-500 text-slate-200 hover:bg-slate-800"
                >
                  Stage view
                </button>
              )}
              <span className="text-[11px] text-slate-300 bg-slate-900/80 rounded px-2 py-1">
                {pathMode === "program"
                  ? isPlaying
                    ? `Playing line ${highlightLine != null ? highlightLine + 1 : 1}`
                    : parseResult?.segments.length
                      ? `${parseResult.segments.length} moves from the saved program`
                      : "Save a program with motion"
                  : stagePlan
                  ? panelTab === "plan"
                    ? isPlaying
                      ? `OP${stagePlan.stages[stageIndex]?.opNumber ?? 10} playing${stageIndex < stagePlan.stages.length - 1 ? ", then the next" : ""}`
                      : "Play runs every operation"
                    : `OP${stagePlan.stages[stageIndex]?.opNumber ?? 10} ${isPlaying ? "playing" : "only"}`
                  : isPlaying
                    ? `Playing line ${highlightLine != null ? highlightLine + 1 : 1}`
                    : parseResult
                      ? `${parseResult.segments.length} moves`
                      : "Waiting for G-code"}
              </span>
            </div>
          )}
        </main>

        {/* ── Right Panel: Monaco G-Code Editor ── */}
        <aside className="w-[28rem] shrink-0 border-l border-slate-700 overflow-hidden flex flex-col">
          <GCodeMonacoEditor
            value={gcode}
            programLabel={stagePlan ? `OP${stagePlan.stages[stageIndex]?.opNumber ?? 10}` : undefined}
            moves={parseResult?.segments.length ?? 0}
            playing={pathMode === "program" && isPlaying}
            onSave={handleSaveProgram}
            onPlay={handlePlayProgram}
            onExport={handleExportProgram}
            onLineClick={handleLineClick}
            highlightLine={highlightLine}
            readOnly={isGeneratingGCode}
            className="flex-1"
          />
          <div className="shrink-0 px-3 py-2 border-t border-slate-700 bg-slate-900 text-xs">
            <div className="flex items-center gap-2">
              <label htmlFor="controller" className="text-slate-400">Controller for Export</label>
              <select
                id="controller"
                value={controller}
                onChange={(event) => { setController(event.target.value as Controller); setPostWarnings([]); }}
                className="flex-1 rounded bg-slate-800 border border-slate-600 px-2 py-1 text-slate-200"
              >
                {CONTROLLERS.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
              <InfoTip
                title="Controller post"
                lines={[CONTROLLERS.find((item) => item.id === controller)?.note ?? "", POST_NOTE]}
                attention
              />
            </div>
            {postWarnings.length > 0 && (
              <ul className="mt-2 list-disc pl-4 text-amber-300 space-y-0.5">
                {postWarnings.map((warning) => (<li key={warning}>{warning}</li>))}
              </ul>
            )}
          </div>
          {/* Approve & Train button — appears after AI generates G-code */}
          {generatedGcodeSnapshot && (
            <div className="shrink-0 px-3 py-2 border-t border-slate-700 bg-slate-900">
              <button
                onClick={() => setDiffModalOpen(true)}
                className="w-full py-2 text-xs font-semibold rounded bg-green-700 hover:bg-green-600 text-white transition-colors"
              >
                ✓ Review Diff &amp; Approve
              </button>
            </div>
          )}
        </aside>
      </div>

      {/* Diff + Approval modal */}
      <DiffViewerModal
        open={diffModalOpen}
        onClose={() => setDiffModalOpen(false)}
        generatedGcode={generatedGcodeSnapshot}
        approvedGcode={gcode}
        plan={plan}
        features={features}
        onApproved={(diffId) => {
          console.log("[Studio] Diff approved, id:", diffId);
          setDiffModalOpen(false);
        }}
      />
    </div>
  );
}
