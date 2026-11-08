"use client";

import { useMemo, useState } from "react";
import type { MachiningFeature, PartFeatures } from "@/lib/cad/featureExtractor";
import InfoTip from "@/components/ui/InfoTip";
import { READING_NOTE } from "@/lib/studio/limitations";
import { buildFeatureStagePlan } from "@/lib/studio/featureStages";
import { hasErrors, reviewFeatures, reviewTurning, type ReadingIssue } from "@/lib/studio/readingReview";
import { buildStagePlan, type StagePlan, type TurningJob } from "@/lib/studio/stages";

interface Props {
  plan: StagePlan;
  onApply: (plan: StagePlan) => void;
}

const COLORS: Record<ReadingIssue["level"], string> = {
  error: "text-red-300 border-red-800 bg-red-950/40",
  warning: "text-amber-300 border-amber-800 bg-amber-950/30",
  info: "text-slate-300 border-slate-700 bg-slate-800/50",
};

const LABELS: Record<ReadingIssue["level"], string> = { error: "Fix", warning: "Check", info: "Note" };

function Field({ label, value, onChange, step = "any", text = false }: { label: string; value: string | number; onChange: (value: string) => void; step?: string; text?: boolean }) {
  return (
    <label className="flex flex-col gap-0.5 text-[10px] text-slate-400">
      {label}
      <input
        className="rounded border border-slate-700 bg-slate-800 px-1.5 py-1 text-xs text-slate-100"
        type={text ? "text" : "number"}
        step={step}
        min={text ? undefined : 0}
        value={value === 0 ? "" : value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

const num = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

function IssueList({ issues }: { issues: ReadingIssue[] }) {
  if (!issues.length) return <p className="text-[11px] text-emerald-300">The reading looks complete.</p>;
  return (
    <ul className="space-y-1" data-testid="reading-issues">
      {issues.map((issue, index) => (
        <li key={`${issue.message}-${index}`} className={`rounded border px-2 py-1 text-[11px] ${COLORS[issue.level]}`}>
          <strong>{LABELS[issue.level]}.</strong> {issue.message}
        </li>
      ))}
    </ul>
  );
}

function TurningForm({ plan, onApply }: Props) {
  const [job, setJob] = useState<TurningJob>(plan.job);
  const issues = useMemo(() => reviewTurning(job), [job]);
  const set = (patch: Partial<TurningJob>) => setJob((current) => ({ ...current, ...patch }));
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Part number" text value={job.partNumber} onChange={(value) => set({ partNumber: value })} />
        <Field label="Material" text value={job.material} onChange={(value) => set({ material: value })} />
        <Field label="Bar width" value={job.stockWidth} onChange={(value) => set({ stockWidth: num(value) })} />
        <Field label="Bar height" value={job.stockHeight} onChange={(value) => set({ stockHeight: num(value) })} />
        <Field label="Bar length" value={job.stockLength} onChange={(value) => set({ stockLength: num(value) })} />
        <Field label="Finished length" value={job.length} onChange={(value) => set({ length: num(value) })} />
        <Field label="Outside diameter" value={job.diameter} onChange={(value) => set({ diameter: num(value) })} />
        <Field label="Bore diameter" value={job.bore} onChange={(value) => set({ bore: num(value) })} />
      </div>
      <IssueList issues={issues} />
      <button
        type="button"
        disabled={hasErrors(issues)}
        onClick={() => onApply(buildStagePlan(job, plan.selectedMachine))}
        className="w-full rounded bg-cyan-600 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-40"
      >
        Apply and replan
      </button>
    </div>
  );
}

const SHOWS: Record<string, (keyof MachiningFeature)[]> = {
  hole: ["count", "diameter", "depth"],
  bore: ["count", "diameter", "depth"],
  counterbore: ["count", "diameter", "depth"],
  countersink: ["count", "diameter", "depth"],
  thread: ["count", "diameter"],
  pocket: ["count", "width", "length", "depth"],
  slot: ["count", "width", "length", "depth"],
};

function FeatureForm({ plan, onApply }: Props) {
  const [draft, setDraft] = useState<PartFeatures>(plan.features);
  const issues = useMemo(() => reviewFeatures(draft), [draft]);
  const checkable = Boolean(draft.evidence) && (draft.extractionMethod === "ai_vision" || draft.extractionMethod === "pdf_ocr");
  const setStock = (key: "length" | "width" | "height", value: string) =>
    setDraft((current) => {
      const dimensions = { ...current.rawDimensions, [key]: num(value) };
      return { ...current, rawDimensions: dimensions, stockDimensions: { ...current.stockDimensions, ...dimensions } };
    });
  const setFeature = (index: number, key: keyof MachiningFeature, value: string) =>
    setDraft((current) => ({
      ...current,
      features: current.features.map((feature, at) => (at === index ? { ...feature, [key]: num(value) || (key === "count" ? 1 : undefined) } : feature)),
    }));
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Part number" text value={draft.partNumber} onChange={(value) => setDraft({ ...draft, partNumber: value })} />
        <Field label="Material" text value={draft.material} onChange={(value) => setDraft({ ...draft, material: value })} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Stock length" value={draft.rawDimensions.length} onChange={(value) => setStock("length", value)} />
        <Field label="Stock width" value={draft.rawDimensions.width} onChange={(value) => setStock("width", value)} />
        <Field label="Stock height" value={draft.rawDimensions.height} onChange={(value) => setStock("height", value)} />
      </div>
      {draft.features.map((feature, index) => {
        const keys = SHOWS[feature.type];
        if (!keys) return null;
        return (
          <div key={`${feature.type}-${index}`} className="rounded border border-slate-700 p-2">
            <div className="mb-1 text-[11px] font-semibold text-slate-300">{feature.type} {index + 1}</div>
            <div className="grid grid-cols-4 gap-2">
              {keys.map((key) => (
                <Field key={key} label={key} value={(feature[key] as number | undefined) ?? 0} onChange={(value) => setFeature(index, key, value)} />
              ))}
            </div>
          </div>
        );
      })}
      <IssueList issues={issues} />
      {checkable && (
        <label className="flex items-start gap-2 text-[11px] text-slate-300" data-testid="confirm-reading">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={Boolean(draft.evidence?.confirmed)}
            onChange={(event) => setDraft((current) => ({ ...current, evidence: { ...(current.evidence ?? { sheetText: false, numbers: [], conflicts: [] }), confirmed: event.target.checked } }))}
          />
          I compared these values with the drawing sheet.
        </label>
      )}      <button
        type="button"
        disabled={hasErrors(issues)}
        onClick={() => onApply(buildFeatureStagePlan({ ...draft, extractionMethod: draft.evidence && !draft.evidence.confirmed ? draft.extractionMethod : "manual" }, plan.selectedMachine))}
        className="w-full rounded bg-cyan-600 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-40"
      >
        Apply and replan
      </button>
    </div>
  );
}

/** What was read from the drawing, with checks and editable values. Applying rebuilds every operation and program. */
export default function ReadingReview({ plan, onApply }: Props) {
  const issues = useMemo(() => (plan.family === "turning" ? reviewTurning(plan.job) : reviewFeatures(plan.features)), [plan]);
  const attention = issues.filter((issue) => issue.level !== "info").length;
  return (
    <details className="rounded border border-slate-700 text-xs" open={attention > 0} data-testid="reading-review">
      <summary className="cursor-pointer px-2 py-1.5 font-semibold text-slate-200">
        Drawing reading {attention > 0 ? <span className="text-amber-300">({attention} to check)</span> : <span className="text-emerald-300">(complete)</span>}{" "}
        <InfoTip title="What this check cannot do" lines={[READING_NOTE]} />
      </summary>
      <div className="p-2">
        {plan.family === "turning" ? (
          <TurningForm key={plan.plan.generatedAt} plan={plan} onApply={onApply} />
        ) : (
          <FeatureForm key={plan.plan.generatedAt} plan={plan} onApply={onApply} />
        )}
      </div>
    </details>
  );
}
