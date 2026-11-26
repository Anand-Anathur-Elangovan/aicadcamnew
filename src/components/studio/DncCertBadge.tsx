"use client";

/**
 * DncCertBadge
 * Shows the DNC certification status of the current G-code program.
 * When no cert exists → amber "Needs dry-run" badge + button to log one.
 * When a PASS cert exists → green "DNC Certified" badge.
 * When a FAIL cert exists → red badge.
 *
 * Usage:
 *   <DncCertBadge programName="OP10" revisionId={savedRevId} />
 */
import { useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert, ShieldX, Loader2 } from "lucide-react";

type CertResult = "pass" | "conditional_pass" | "fail";

interface Certification {
  id:             string;
  certified_at:   string;
  machine_id:     string;
  operator:       string;
  result:         CertResult;
  dry_run_cycles: number;
  note?:          string;
  issues?:        string;
}

interface Props {
  programName: string;
  revisionId?: string;
}

const RESULT_CFG: Record<CertResult, { label: string; cls: string; icon: React.ReactNode }> = {
  pass:             { label: "DNC Certified ✓", cls: "bg-green-100 text-green-800 border-green-300", icon: <ShieldCheck className="h-3.5 w-3.5" /> },
  conditional_pass: { label: "Conditional Pass", cls: "bg-amber-100 text-amber-800 border-amber-300", icon: <ShieldAlert className="h-3.5 w-3.5" /> },
  fail:             { label: "Dry-run FAIL",    cls: "bg-red-100 text-red-800 border-red-300",   icon: <ShieldX className="h-3.5 w-3.5" /> },
};

export function DncCertBadge({ programName, revisionId }: Props) {
  const [certs, setCerts]     = useState<Certification[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  // Form state
  const [machineId, setMachineId] = useState("");
  const [operator, setOperator]   = useState("");
  const [result, setResult]       = useState<CertResult>("pass");
  const [cycles, setCycles]       = useState(1);
  const [note, setNote]           = useState("");
  const [issues, setIssues]       = useState("");
  const [saving, setSaving]       = useState(false);
  const [saveMsg, setSaveMsg]     = useState("");

  const fetchCerts = async () => {
    if (!programName) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/gcode/certify?program=${encodeURIComponent(programName)}`);
      const data = (await res.json()) as Certification[];
      setCerts(Array.isArray(data) ? data : []);
    } catch { /* silent */ }
    setLoading(false);
  };

  useEffect(() => { void fetchCerts(); }, [programName]); // eslint-disable-line react-hooks/exhaustive-deps

  const latest = certs[0];

  const saveCert = async () => {
    if (!machineId || !operator) { setSaveMsg("Machine ID and Operator are required"); return; }
    setSaving(true); setSaveMsg("");
    const res = await fetch("/api/gcode/certify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        program_name:  programName,
        revision_id:   revisionId ?? undefined,
        machine_id:    machineId,
        operator,
        result,
        dry_run_cycles: cycles,
        note:   note   || undefined,
        issues: issues || undefined,
      }),
    });
    const data = (await res.json()) as { id?: string; error?: string };
    if (data.error) { setSaveMsg(`Error: ${data.error}`); }
    else { setSaveMsg("✓ Certification saved"); void fetchCerts(); }
    setSaving(false);
  };

  if (loading) return <Loader2 className="h-4 w-4 animate-spin text-slate-500" />;

  return (
    <>
      {/* Badge */}
      <div className="flex items-center gap-2">
        {latest ? (
          <span
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border cursor-pointer ${RESULT_CFG[latest.result].cls}`}
            title={`${latest.operator} · ${latest.machine_id} · ${new Date(latest.certified_at).toLocaleDateString()}`}
            onClick={() => setModalOpen(true)}
          >
            {RESULT_CFG[latest.result].icon}
            {RESULT_CFG[latest.result].label}
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border border-amber-300 bg-amber-50 text-amber-800 cursor-pointer hover:bg-amber-100"
            onClick={() => setModalOpen(true)}
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            Needs dry-run
          </span>
        )}
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="text-xs text-slate-400 hover:text-slate-200 underline"
        >
          {latest ? "View / update" : "Log certification"}
        </button>
      </div>

      {/* Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setModalOpen(false); }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-gray-900">DNC Dry-Run Certification</h3>
                <p className="text-xs text-gray-500 mt-0.5">Program: <span className="font-mono">{programName}</span></p>
              </div>
              <button type="button" onClick={() => setModalOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>

            {/* Previous certs */}
            {certs.length > 0 && (
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 max-h-36 overflow-y-auto">
                <p className="text-xs font-semibold text-gray-500 mb-2">Previous certifications</p>
                {certs.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 text-xs py-1 border-b border-gray-100 last:border-0">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${RESULT_CFG[c.result].cls}`}>{c.result.toUpperCase()}</span>
                    <span className="text-gray-600">{c.machine_id} · {c.operator}</span>
                    <span className="ml-auto text-gray-400">{new Date(c.certified_at).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            )}

            {/* New cert form */}
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm font-semibold text-gray-700">Log new certification</p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Machine ID *</label>
                  <input value={machineId} onChange={(e) => setMachineId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="VMC-01" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Operator *</label>
                  <input value={operator} onChange={(e) => setOperator(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="Your name" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Result</label>
                  <select value={result} onChange={(e) => setResult(e.target.value as CertResult)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="pass">Pass</option>
                    <option value="conditional_pass">Conditional Pass</option>
                    <option value="fail">Fail</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Dry-run cycles</label>
                  <input type="number" min={1} value={cycles} onChange={(e) => setCycles(parseInt(e.target.value) || 1)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">Note</label>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm resize-none focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="Any notes about the dry-run…" />
              </div>

              {result !== "pass" && (
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Issues found</label>
                  <textarea value={issues} onChange={(e) => setIssues(e.target.value)} rows={2}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm resize-none focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="Describe any collisions, overrides used, corrections made…" />
                </div>
              )}

              {saveMsg && (
                <p className={`text-xs font-medium ${saveMsg.startsWith("Error") ? "text-red-600" : "text-green-700"}`}>{saveMsg}</p>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void saveCert()}
                  className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save Certification"}
                </button>
                <button type="button" onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
