"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createSimScene, type SimControls, type SimHandle } from "@/components/studio/simScene";
import InfoTip from "@/components/ui/InfoTip";
import type { SimJob } from "@/lib/sim/prepare";
import { SIMULATOR_LIMITS, VOXEL_NOTE } from "@/lib/studio/limitations";
import { voxelGrid } from "@/lib/sim/voxelEngine";
import { cycleTime, formatClock, toolpathCsv } from "@/lib/sim/stats";
import { allMaterials, machineLimits, materialById, timingOf } from "@/lib/cutting/library";
import { analyzeLoad } from "@/lib/cutting/load";
import type { StageCheck } from "@/lib/sim/verifyPlan";
import type { Collision } from "@/lib/sim/types";

interface Props {
  job: SimJob;
  isPlaying: boolean;
  onPlayEnd?: () => void;
  onPause?: () => void;
  onLine?: (line: number) => void;
  onCollision?: (collision: Collision) => void;
  planChecks?: StageCheck[] | null;
  /** Parts of the program the simulator skips. */
  notes?: string[];
  /** Material name from the drawing. It sets the load and tool-life estimate. */
  material?: string;
  /** Machine id (vmc, vmc5, lathe). */
  machine?: string;
}

const SPEEDS = [1, 2, 4, 8];

function download(name: string, href: string): void {
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  link.click();
}

export default function CutSimViewport({ job, isPlaying, onPlayEnd, onPause, onLine, onCollision, planChecks, notes = [], material, machine }: Props) {
  const [materialId, setMaterialId] = useState("");
  const mountRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<SimHandle | null>(null);
  const controls = useRef<SimControls>({ playing: isPlaying, speed: 1, section: false, path: false });
  const callbacks = useRef({ onPlayEnd, onLine, onCollision });

  const [speed, setSpeed] = useState(1);
  const [section, setSection] = useState(false);
  const [path, setPath] = useState(false);
  const [stats, setStats] = useState(false);
  const [crash, setCrash] = useState<Collision | null>(null);
  const [progress, setProgress] = useState(0);
  const scrubbing = useRef(false);

  useEffect(() => {
    callbacks.current = { onPlayEnd, onLine, onCollision };
    Object.assign(controls.current, { playing: isPlaying, speed, section, path });
  }, [onPlayEnd, onLine, onCollision, isPlaying, speed, section, path]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;
    let cancelled = false;
    setCrash(null);
    setProgress(0);
    createSimScene(container, job, controls.current, {
      onLine: (line) => callbacks.current.onLine?.(line),
      onProgress: (fraction) => {
        if (!scrubbing.current) setProgress(fraction);
      },
      onCollision: (collision) => {
        setCrash(collision);
        callbacks.current.onCollision?.(collision);
      },
      onEnd: () => callbacks.current.onPlayEnd?.(),
    }).then((handle) => {
      if (cancelled) {
        handle.dispose();
        return;
      }
      handleRef.current = handle;
    });
    return () => {
      cancelled = true;
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, [job]);

  const { report } = job;
  const machineId = machine ?? (job.setup.family === "lathe" ? "lathe" : "vmc");
  // The load needs a full engine run, so it is worked out only while the statistics panel is open.
  const analysis = useMemo(() => {
    if (!stats) return null;
    const chosen = materialId ? materialById(materialId) : undefined;
    const limits = machineLimits(machineId);
    return {
      load: analyzeLoad(job, chosen ?? material, machineId),
      time: cycleTime(job.program, timingOf(limits)),
    };
  }, [stats, job, material, materialId, machineId]);
  const solidCell = job.initial.family === "voxel" && job.setup.family === "mill" ? Math.min(...[voxelGrid(job.setup)].map((grid) => Math.max(grid.dx, grid.dy, grid.dz))) : null;
  const planned = report.collision;
  const lathe = job.setup.family === "lathe";
  const unitX = lathe ? "diameter" : "X";
  const bad = planChecks?.filter((check) => !check.ok) ?? [];
  const button = (active: boolean) =>
    `rounded px-2 py-1 font-semibold ${active ? "bg-cyan-600 text-white" : "bg-slate-900/80 text-slate-200 hover:bg-slate-800"}`;

  return (
    <div className="absolute inset-0">
      <div ref={mountRef} className="absolute inset-0" data-testid="cut-sim" />

      <div className="absolute top-14 left-3 z-10 flex max-w-sm flex-col items-start gap-2">
        {planned ? (
          <button
            type="button"
            onClick={() => callbacks.current.onLine?.(planned.line)}
            className="rounded border border-red-500 bg-red-950/90 px-3 py-2 text-left text-xs text-red-100 shadow"
            data-testid="sim-collision"
          >
            <span className="font-semibold">Collision at line {planned.line + 1}.</span> {planned.message}
          </button>
        ) : (
          <div className="rounded border border-emerald-600/60 bg-emerald-950/80 px-3 py-1.5 text-xs text-emerald-200" data-testid="sim-clear">
            No collision. {report.feedMoves} cutting moves, {report.moves - report.feedMoves} rapid.{" "}
            <InfoTip
              title={notes.length ? "This program uses things the simulator skips" : "What the simulator does not show"}
              lines={[...notes, ...SIMULATOR_LIMITS]}
              attention={notes.length > 0}
            />
          </div>
        )}
        {solidCell !== null && (
          <div className="rounded border border-sky-600/60 bg-sky-950/80 px-3 py-1.5 text-xs text-sky-200" data-testid="sim-solid">
            Solid model, {solidCell.toFixed(2)} mm boxes.{" "}
            <InfoTip title="Solid model" lines={[VOXEL_NOTE]} />
          </div>
        )}
        {planChecks && planChecks.length > 0 && (
          <div
            className={`rounded border px-3 py-1.5 text-xs ${bad.length ? "border-red-500 bg-red-950/90 text-red-100" : "border-emerald-600/60 bg-emerald-950/80 text-emerald-200"}`}
            data-testid="plan-check"
            title={planChecks.map((check) => `OP${check.opNumber} ${check.name}: ${check.ok ? "clean" : check.problem}`).join("\n")}
          >
            {bad.length
              ? `Plan check: ${bad.map((check) => `OP${check.opNumber}`).join(", ")} collide${bad.length === 1 ? "s" : ""}`
              : `Plan check: all ${planChecks.length} operations run clean`}
          </div>
        )}
        {report.warnings.map((warning) => (
          <div key={warning} className="rounded border border-amber-600/60 bg-amber-950/80 px-3 py-1.5 text-xs text-amber-200">
            {warning}
          </div>
        ))}
      </div>

      {stats && (
        <div className="absolute top-14 right-3 z-10 w-60 rounded border border-slate-600 bg-slate-900/95 p-3 text-xs text-slate-200" data-testid="sim-stats">
          <div className="mb-2 font-semibold text-slate-100">Toolpath statistics</div>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
            <dt className="text-slate-400">Cut distance</dt>
            <dd>{report.cutDistance.toFixed(1)} mm</dd>
            <dt className="text-slate-400">Rapid distance</dt>
            <dd>{report.rapidDistance.toFixed(1)} mm</dd>
            <dt className="text-slate-400">Total moves</dt>
            <dd>{report.moves}</dd>
            <dt className="text-slate-400">Est. cycle time</dt>
            <dd>{formatClock(analysis?.time.totalSeconds ?? report.estimatedSeconds)}</dd>
            <dt className="text-slate-400">Drill holes</dt>
            <dd>{report.holes}</dd>
            <dt className="text-slate-400">Cut box ({unitX})</dt>
            <dd>
              {report.bbox
                ? lathe
                  ? `Ø${(report.bbox.max[0] - Math.max(report.bbox.min[0], 0)).toFixed(1)} x ${(report.bbox.max[2] - report.bbox.min[2]).toFixed(1)}`
                  : `${(report.bbox.max[0] - report.bbox.min[0]).toFixed(1)} x ${(report.bbox.max[1] - report.bbox.min[1]).toFixed(1)}`
                : "none"}
            </dd>
          </dl>
          {analysis && (
            <div className="mt-3 border-t border-slate-700 pt-2" data-testid="sim-load">
              <div className="mb-1 flex items-center gap-1 font-semibold text-slate-100">
                Cutting load
                <InfoTip
                  title="Estimates"
                  lines={[
                    "Power and force follow from the Kienzle cutting force and the metal each move removes. Tool life follows the Taylor equation.",
                    "They are handbook estimates, good to about 25 percent. They do not model tool wear growth, chatter or machine stiffness.",
                  ]}
                />
              </div>
              <label className="mb-1 flex items-center gap-2 text-slate-400">
                Material
                <select
                  value={materialId}
                  onChange={(event) => setMaterialId(event.target.value)}
                  className="min-w-0 flex-1 rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-slate-200"
                  aria-label="Material for load estimate"
                >
                  <option value="">{analysis.load.recognised ? `${analysis.load.material.label} (drawing)` : "Not recognised, using steel"}</option>
                  {allMaterials().map((entry) => (
                    <option key={entry.id} value={entry.id}>{entry.label}</option>
                  ))}
                </select>
              </label>
              <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                <dt className="text-slate-400">Cutting time</dt>
                <dd>{formatClock(analysis.time.cutSeconds)}</dd>
                <dt className="text-slate-400">Rapid + accel</dt>
                <dd>{formatClock(analysis.time.rapidSeconds + analysis.time.motionSeconds)}</dd>
                <dt className="text-slate-400">Tool changes ({analysis.time.toolChanges})</dt>
                <dd>{formatClock(analysis.time.toolChangeSeconds)}</dd>
                <dt className="text-slate-400">Peak power</dt>
                <dd className={analysis.load.spindleLoadPercent > 80 ? "text-amber-300" : ""}>
                  {analysis.load.peakKw.toFixed(1)} kW ({Math.round(analysis.load.spindleLoadPercent)}%)
                </dd>
                <dt className="text-slate-400">Peak force</dt>
                <dd>{Math.round(analysis.load.peakForceN)} N</dd>
              </dl>
              {analysis.load.tools.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {analysis.load.tools.map((tool) => (
                    <li key={tool.index} className={tool.lifeUsedPercent > 80 ? "text-amber-300" : ""}>
                      {tool.name}: {Math.round(tool.vc)} m/min, edge life {Math.round(tool.lifeMinutes)} min, uses {tool.lifeUsedPercent.toFixed(1)}%
                    </li>
                  ))}
                </ul>
              )}
              {analysis.load.warnings.map((warning) => (
                <p key={warning} className="mt-1 text-amber-300">{warning}</p>
              ))}
            </div>
          )}
          <div className="mt-2 text-slate-400">Tools</div>
          <ul className="mt-1 space-y-0.5">
            {job.program.tools.slice(1).map((tool, index) => (
              <li key={index}>
                {tool.kind}
                {tool.diameter ? ` Ø${Math.round(tool.diameter * 10) / 10}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="absolute bottom-3 left-3 right-3 z-10 flex flex-col gap-2 text-xs">
        <div className="flex items-center gap-2 rounded bg-slate-900/80 px-2 py-1.5">
          <span className="text-slate-300">Scrub</span>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(progress * 1000)}
            aria-label="Scrub through the program"
            className="flex-1 accent-cyan-500"
            onPointerDown={() => {
              scrubbing.current = true;
              onPause?.();
            }}
            onPointerUp={() => {
              scrubbing.current = false;
            }}
            onChange={(event) => {
              const value = Number(event.target.value) / 1000;
              setProgress(value);
              handleRef.current?.seek(value);
            }}
          />
          <span className="w-10 text-right text-slate-300">{Math.round(progress * 100)}%</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-300 bg-slate-900/80 rounded px-2 py-1">Speed</span>
          {SPEEDS.map((value) => (
            <button key={value} type="button" onClick={() => setSpeed(value)} className={button(speed === value)}>
              {value}x
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              onPause?.();
              handleRef.current?.step();
            }}
            className={button(false)}
            title="Run to the end of the next program line"
          >
            Step
          </button>
          <button type="button" onClick={() => handleRef.current?.restart()} className={button(false)}>
            Restart
          </button>
          <button type="button" onClick={() => setPath((value) => !value)} className={button(path)}>
            Tool path
          </button>
          {lathe && (
            <button type="button" onClick={() => setSection((value) => !value)} className={button(section)}>
              Section
            </button>
          )}
          <button type="button" onClick={() => setStats((value) => !value)} className={button(stats)}>
            Stats
          </button>
          <button
            type="button"
            onClick={() => {
              const data = handleRef.current?.snapshot();
              if (data) download("toolpath.png", data);
            }}
            className={button(false)}
          >
            PNG
          </button>
          <button
            type="button"
            onClick={() => {
              const url = URL.createObjectURL(new Blob([toolpathCsv(job.program)], { type: "text/csv" }));
              download("toolpath.csv", url);
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
            className={button(false)}
          >
            CSV
          </button>
          {crash && <span className="rounded bg-red-600 px-2 py-1 font-semibold text-white">Crash at line {crash.line + 1}</span>}
        </div>
      </div>
    </div>
  );
}
