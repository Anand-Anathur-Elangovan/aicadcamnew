"use client";

// Left panel of the Studio: file upload, feature summary, CAPP process plan display,
// and controls to generate G-code.

import { useState, useCallback, useEffect } from "react";
import type { OperationCutting, ProcessPlan, ProcessOperation } from "@/lib/providers/capp.provider";
import type { PartFeatures } from "@/lib/cad/featureExtractor";
import ReadingReview from "@/components/studio/ReadingReview";
import InfoTip from "@/components/ui/InfoTip";
import { VMC_BORING_NOTE } from "@/lib/studio/limitations";
import { rebuildStagePlan } from "@/lib/studio/featureStages";
import { type MachineId, type StagePlan } from "@/lib/studio/stages";

interface Props {
  onPlanGenerated: (plan: ProcessPlan, features: PartFeatures) => void;
  onGCodeGenerated: (gcode: string) => void;
  onFileUploaded?: (pdfUrl: string) => void;
  onStagePlan?: (plan: StagePlan | null, index: number) => void;
  stageIndex?: number;
  onTabChange?: (tab: PanelTab) => void;
}

export type PanelTab = "upload" | "plan" | "ops";

export default function RoutingPanel({ onPlanGenerated, onGCodeGenerated, onFileUploaded, onStagePlan, stageIndex = 0, onTabChange }: Props) {
  const [activeTab, setActiveTab]     = useState<PanelTab>("upload");

  useEffect(() => {
    onTabChange?.(activeTab);
  }, [activeTab, onTabChange]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGcoding, setIsGcoding]     = useState(false);
  const [plan, setPlan]               = useState<ProcessPlan | null>(null);
  const [features, setFeatures]       = useState<PartFeatures | null>(null);
  const [targetMachine, setTargetMachine] = useState("Fanuc 3-Axis VMC");
  const [stagePlan, setStagePlan] = useState<StagePlan | null>(null);
  const [error, setError]             = useState<string | null>(null);
  const [progress, setProgress]       = useState("");
  const [dragOver, setDragOver]       = useState(false);

  const handleFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setError(null);
    setIsGenerating(true);
    setProgress(files.length > 1 ? `Reading ${files.length} sheets…` : "Reading the drawing…");
    setActiveTab("plan");

    try {
      const pdf = files.find((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
      if (pdf) onFileUploaded?.(URL.createObjectURL(pdf));

      const fd = new FormData();
      for (const file of files) fd.append("file", file);

      setProgress("Planning each operation…");
      const res = await fetch("/api/process/generate", { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());

      const data = await res.json() as { plan: ProcessPlan; features: PartFeatures; stagePlan?: StagePlan };
      setPlan(data.plan);
      setFeatures(data.features);
      setStagePlan(data.stagePlan ?? null);
      onPlanGenerated(data.plan, data.features);
      onStagePlan?.(data.stagePlan ?? null, 0);
      setActiveTab("plan");
      setProgress("");

    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
      setActiveTab("upload");
    } finally {
      setIsGenerating(false);
    }
  }, [onPlanGenerated, onFileUploaded, onStagePlan]);

  const loadSampleDrawing = useCallback(async () => {
    try {
      const res = await fetch("/samples/hc-100-hollow-cylinder.pdf");
      if (!res.ok) throw new Error("Sample drawing is missing");
      const blob = await res.blob();
      const file = new File([blob], "hc-100-hollow-cylinder.pdf", { type: "application/pdf" });
      await handleFiles([file]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sample drawing failed");
    }
  }, [handleFiles]);

  const applyReading = useCallback((next: StagePlan) => {
    setStagePlan(next);
    setPlan(next.plan);
    setFeatures(next.features);
    onPlanGenerated(next.plan, next.features);
    onStagePlan?.(next, 0);
  }, [onPlanGenerated, onStagePlan]);

  const chooseStageMachine = useCallback((id: MachineId) => {
    if (!stagePlan) return;
    const next = rebuildStagePlan(stagePlan, id);
    setStagePlan(next);
    setPlan(next.plan);
    setFeatures(next.features);
    onPlanGenerated(next.plan, next.features);
    onStagePlan?.(next, stageIndex);
  }, [stagePlan, stageIndex, onPlanGenerated, onStagePlan]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = [...e.dataTransfer.files];
    if (files.length) void handleFiles(files);
  }, [handleFiles]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    if (files.length) void handleFiles(files);
  }, [handleFiles]);

  const generateGCode = useCallback(async () => {
    if (!plan || !features) return;
    setIsGcoding(true);
    setError(null);

    try {
      const res = await fetch("/api/gcode/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, features, targetMachine }),
      });
      if (!res.ok) throw new Error(await res.text());

      const reader = res.body!.getReader();
      const dec    = new TextDecoder();
      let gcode    = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = dec.decode(value);
        for (const line of text.split("\n")) {
          if (line.startsWith("data: ")) {
            const evt = JSON.parse(line.slice(6)) as { step: string; progress: number; gcode?: string; error?: string };
            setProgress(evt.step);
            if (evt.gcode) gcode = evt.gcode;
            if (evt.error) throw new Error(evt.error);
          }
        }
      }

      if (gcode) onGCodeGenerated(gcode);
      setProgress("");

    } catch (err) {
      setError(err instanceof Error ? err.message : "G-code generation failed");
    } finally {
      setIsGcoding(false);
    }
  }, [plan, features, targetMachine, onGCodeGenerated]);

  const tabs: { id: PanelTab; label: string }[] = [
    { id: "upload", label: "Upload" },
    { id: "plan",   label: "Plan" },
    { id: "ops",    label: "Operations" },
  ];

  return (
    <div className="flex flex-col h-full bg-slate-900 text-slate-200">
      {/* Tabs */}
      <div className="flex border-b border-slate-700 shrink-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${
              activeTab === t.id
                ? "text-cyan-400 border-b-2 border-cyan-400"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Error */}
        {error && (
          <div className="text-xs text-red-400 bg-red-950/40 border border-red-800 rounded p-2">
            {error}
          </div>
        )}

        {/* Progress */}
        {(isGenerating || isGcoding) && progress && (
          <div className="text-xs text-yellow-400 animate-pulse">{progress}</div>
        )}

        {/* Upload tab */}
        {activeTab === "upload" && (
          <div className="space-y-3">
            <label
              className={`flex flex-col items-center justify-center gap-2 p-6 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
                dragOver
                  ? "border-cyan-400 bg-cyan-950/20"
                  : "border-slate-600 hover:border-slate-500"
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <svg className="w-8 h-8 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <span className="text-xs text-slate-400">
                Drop one drawing, or several sheets of the same part
              </span>
              <input
                type="file"
                className="hidden"
                accept=".stp,.step,.igs,.iges,.pdf,.png,.jpg,.jpeg"
                multiple
                onChange={handleInputChange}
                disabled={isGenerating}
              />
              <span className="text-xs text-cyan-500 font-medium">
                {isGenerating ? "Generating…" : "Click to browse"}
              </span>
            </label>

            <button
              type="button"
              onClick={() => void loadSampleDrawing()}
              disabled={isGenerating}
              className="w-full py-2 text-xs font-semibold rounded border border-cyan-700 text-cyan-300 hover:bg-cyan-950 disabled:opacity-50"
            >
              Use hollow-cylinder sample
            </button>
            <p className="text-[11px] text-slate-500">
              40 x 40 x 80 mm bar, turned to Ø32 and bored Ø16.
            </p>

            <div className="space-y-1">
              <label className="text-xs text-slate-400">Target Machine</label>
              <select
                className="w-full text-xs bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-slate-200"
                value={targetMachine}
                onChange={(e) => setTargetMachine(e.target.value)}
              >
                <option>Fanuc 3-Axis VMC</option>
                <option>Haas VF-2</option>
                <option>Fanuc 5-Axis VMC</option>
                <option>CNC Lathe (Fanuc)</option>
                <option>CNC Lathe (Haas)</option>
              </select>
            </div>
          </div>
        )}

        {/* Plan summary tab */}
        {activeTab === "plan" && plan && (
          <div className="space-y-3">
            <PlanSummaryCard plan={plan} features={features} />
            {stagePlan && <ReadingReview plan={stagePlan} onApply={applyReading} />}
            {stagePlan && (
              <p className="text-[11px] text-slate-400">
                Play runs every operation in order, starting with the bar.
              </p>
            )}

            {!stagePlan && (
              <button
                onClick={generateGCode}
                disabled={isGcoding}
                className="w-full py-2 text-xs font-semibold rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white transition-colors"
              >
                {isGcoding ? "Generating G-Code…" : "⚙ Generate G-Code"}
              </button>
            )}

            <div className="space-y-1">
              <label className="text-xs text-slate-400">
                Machine{" "}
                {stagePlan?.family === "turning" && stagePlan.selectedMachine === "vmc" && (
                  <InfoTip title="Boring on the VMC" lines={[VMC_BORING_NOTE]} attention />
                )}
              </label>
              {stagePlan ? (
                <select
                  className="w-full text-xs bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-slate-200"
                  value={stagePlan.selectedMachine}
                  onChange={(e) => chooseStageMachine(e.target.value as MachineId)}
                >
                  {stagePlan.machines.map((machine) => (
                    <option key={machine.id} value={machine.id}>
                      {machine.label}{machine.recommended ? " (recommended)" : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  className="w-full text-xs bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-slate-200"
                  value={targetMachine}
                  onChange={(e) => setTargetMachine(e.target.value)}
                >
                  <option>Fanuc 3-Axis VMC</option>
                  <option>Haas VF-2</option>
                  <option>Fanuc 5-Axis VMC</option>
                  <option>CNC Lathe (Fanuc)</option>
                </select>
              )}
            </div>
          </div>
        )}

        {activeTab === "plan" && !plan && !isGenerating && (
          <p className="text-xs text-slate-500 text-center pt-8">
            Upload a file to generate a process plan.
          </p>
        )}

        {/* Operations tab */}
        {activeTab === "ops" && plan && (
          <div className="space-y-2">
            {plan.operations.map((op, index) => (
              <OperationCard
                key={op.opNumber}
                op={op}
                selected={Boolean(stagePlan) && index === stageIndex}
                onSelect={stagePlan ? () => onStagePlan?.(stagePlan, index) : undefined}
              />
            ))}
          </div>
        )}

        {activeTab === "ops" && !plan && (
          <p className="text-xs text-slate-500 text-center pt-8">
            No plan yet. Upload a file first.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function PlanSummaryCard({ plan, features }: { plan: ProcessPlan; features: PartFeatures | null }) {
  const grouped = new Map<string, number>();
  for (const feature of features?.features ?? []) {
    grouped.set(feature.type, (grouped.get(feature.type) ?? 0) + feature.count);
  }

  return (
    <div className="space-y-2 text-xs">
      <div className="font-semibold text-slate-200 truncate" title={plan.partName}>{plan.partName}</div>
      <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px]">
        <dt className="text-slate-500">P/N</dt>
        <dd className="text-slate-200 truncate">{plan.partNumber}</dd>
        <dt className="text-slate-500">Rev · Material</dt>
        <dd className="text-slate-200 truncate">{plan.revision} · {plan.material}</dd>
        <dt className="text-slate-500">Machine</dt>
        <dd className="text-slate-200 truncate" title={plan.machineType}>{plan.machineType}</dd>
        <dt className="text-slate-500">Ops · Time</dt>
        <dd className="text-slate-200">{plan.operations.length} · {plan.totalEstimatedTime} min</dd>
      </dl>
      {features && (
        <div className="flex gap-1 flex-wrap">
          <Badge color="cyan">{features.partType}</Badge>
          <Badge color="violet">{features.estimatedComplexity}</Badge>
          {[...grouped.entries()].map(([type, count]) => (
            <Badge key={type} color="slate">{count}× {type}</Badge>
          ))}
        </div>
      )}
      {plan.generalNotes.length > 0 && (
        <details className="text-[11px] text-slate-400">
          <summary className="cursor-pointer text-slate-500">Notes ({plan.generalNotes.length})</summary>
          <ul className="mt-1 space-y-0.5">
            {plan.generalNotes.map((note, i) => <li key={i}>• {note}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

function OperationCard({ op, selected, onSelect }: { op: ProcessOperation; selected?: boolean; onSelect?: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`rounded border text-xs ${selected ? "border-cyan-500 bg-cyan-950/30" : "border-slate-700 bg-slate-800/50"}`}>
      <button
        className="w-full flex items-center justify-between px-3 py-2 text-left"
        onClick={() => { onSelect?.(); setOpen((o) => !o); }}
      >
        <div className="flex items-center gap-2">
          <span className="text-cyan-400 font-mono font-bold">OP{op.opNumber}</span>
          <span className="text-slate-200">{op.name}</span>
        </div>
        <div className="flex items-center gap-2 text-slate-400">
          <span>{op.estimatedTime}m</span>
          <span>{open ? "▲" : "▼"}</span>
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-slate-700">
          <p className="text-slate-400 mt-2">{op.description}</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-400">
            <span>Tool</span>       <span className="text-slate-200">{op.tool.type} Ø{op.tool.diameter}mm</span>
            <span>Material</span>   <span className="text-slate-200">{op.tool.material}</span>
            <span>Spindle</span>    <span className="text-slate-200">S{op.cuttingParams.spindleSpeed}</span>
            <span>Feed</span>       <span className="text-slate-200">F{op.cuttingParams.feedRate}</span>
            <span>DOC</span>        <span className="text-slate-200">{op.cuttingParams.depthOfCut}mm</span>
            <span>Coolant</span>    <span className="text-slate-200">{op.cuttingParams.coolant}</span>
            <span>Clamping</span>   <span className="text-slate-200">{op.setup.clampingMethod}</span>
            <span>Datum</span>      <span className="text-slate-200">{op.setup.datumFace}</span>
          </div>
          {op.cutting && <CuttingSummary cutting={op.cutting} />}
          {op.qualityChecks.length > 0 && (
            <div>
              <p className="text-[11px] text-slate-400 mb-1">Quality Checks</p>
              <ul className="space-y-0.5 text-[11px] text-slate-300">
                {op.qualityChecks.map((q, i) => <li key={i}>✓ {q}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CuttingSummary({ cutting }: { cutting: OperationCutting }) {
  const machineMinutes = (cutting.cutSeconds + cutting.rapidSeconds + cutting.toolChangeSeconds + cutting.accelSeconds) / 60;
  return (
    <div className="rounded border border-slate-700 bg-slate-900/50 p-2 text-[11px] text-slate-400" data-testid="cutting-summary">
      <div className="mb-1 flex items-center gap-1 font-semibold text-slate-200">
        Cutting data
        <InfoTip
          title="How these are worked out"
          lines={[
            "Speeds and feeds come from a material table. The simulator then runs the program to get the metal removed by each move, and power, force and tool life follow from that.",
            "They are handbook estimates, good to about 25 percent, not measured on your machine. Check them against your tool maker's data.",
          ]}
        />
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        <span>Material</span>   <span className={cutting.materialRecognised ? "text-slate-200" : "text-amber-300"}>{cutting.materialRecognised ? cutting.material : `${cutting.material} (stand-in)`}</span>
        <span>Machine time</span><span className="text-slate-200">{machineMinutes.toFixed(1)} min (cut {(cutting.cutSeconds / 60).toFixed(1)}, rapid {((cutting.rapidSeconds + cutting.accelSeconds) / 60).toFixed(1)}, tool changes {cutting.toolChanges})</span>
        <span>Handling</span>   <span className="text-slate-200">{cutting.handlingMinutes} min per part</span>
        <span>Setup (once)</span><span className="text-slate-200">{cutting.setupMinutes} min</span>
        <span>Peak power</span> <span className={cutting.spindleLoadPercent > 80 ? "text-amber-300" : "text-slate-200"}>{cutting.peakKw} kW ({Math.round(cutting.spindleLoadPercent)}% of spindle)</span>
        <span>Peak force</span> <span className="text-slate-200">{cutting.peakForceN} N</span>
      </div>
      {cutting.tools.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {cutting.tools.map((tool) => (
            <li key={tool.name} className={tool.lifeUsedPercent > 80 ? "text-amber-300" : "text-slate-300"}>
              {tool.name}: {tool.vc} m/min, edge life {tool.lifeMinutes} min, this op uses {tool.lifeUsedPercent}%
            </li>
          ))}
        </ul>
      )}
      {cutting.warnings.map((warning) => <p key={warning} className="mt-1 text-amber-300">{warning}</p>)}
    </div>
  );
}

function Badge({ children, color }: { children: React.ReactNode; color: "cyan" | "violet" | "slate" }) {
  const cls = {
    cyan:   "bg-cyan-900/50 text-cyan-300 border-cyan-800",
    violet: "bg-violet-900/50 text-violet-300 border-violet-800",
    slate:  "bg-slate-700/50 text-slate-300 border-slate-600",
  }[color];
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] border ${cls}`}>
      {children}
    </span>
  );
}
