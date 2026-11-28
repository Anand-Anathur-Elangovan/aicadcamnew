"use client";

import { useEffect, useState } from "react";
import { Plus, Wrench, Cpu, Trash2, ChevronDown, ChevronUp } from "lucide-react";

interface Tool {
  id: string;
  tool_no: string;
  description: string;
  kind: string;
  diameter_mm: number | null;
  length_mm: number | null;
  flutes: number | null;
  material: string;
  coating: string | null;
  max_rpm: number | null;
  feed_per_tooth: number | null;
  notes: string | null;
}

interface Machine {
  id: string;
  machine_id: string;
  name: string;
  kind: string;
  controller: string;
  x_travel: number | null;
  y_travel: number | null;
  z_travel: number | null;
  max_rpm: number | null;
  tool_capacity: number | null;
  notes: string | null;
  machine_tools?: { tool_id: string; pocket: number | null; tools: Tool }[];
}

const KIND_LABELS: Record<string, string> = {
  vmc: "VMC", lathe: "Lathe", vmc5: "5-Axis VMC", lathe5: "5-Axis Lathe",
  grinder: "Grinder", edm: "EDM", other: "Other",
};

const TOOL_KIND_COLORS: Record<string, string> = {
  endmill: "bg-blue-900/40 text-blue-300",
  drill: "bg-green-900/40 text-green-300",
  boring: "bg-amber-900/40 text-amber-300",
  reamer: "bg-purple-900/40 text-purple-300",
  tap: "bg-red-900/40 text-red-300",
  insert: "bg-cyan-900/40 text-cyan-300",
  ball: "bg-indigo-900/40 text-indigo-300",
  chamfer: "bg-pink-900/40 text-pink-300",
  other: "bg-zinc-700 text-zinc-300",
};

const BLANK_MACHINE = { machine_id: "", name: "", kind: "vmc", controller: "fanuc", x_travel: "", y_travel: "", z_travel: "", max_rpm: "", tool_capacity: "24", notes: "" };
const BLANK_TOOL = { tool_no: "", description: "", kind: "endmill", diameter_mm: "", length_mm: "", flutes: "", material: "carbide", coating: "", max_rpm: "", feed_per_tooth: "", notes: "" };

export default function MachinesPage() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"machines" | "tools">("machines");
  const [expanded, setExpanded] = useState<string | null>(null);

  // Add forms
  const [addingMachine, setAddingMachine] = useState(false);
  const [addingTool, setAddingTool] = useState(false);
  const [machineForm, setMachineForm] = useState<Record<string, string>>(BLANK_MACHINE);
  const [toolForm, setToolForm] = useState<Record<string, string>>(BLANK_TOOL);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [mr, tr] = await Promise.all([fetch("/api/machines"), fetch("/api/tools")]);
    setMachines(await mr.json());
    setTools(await tr.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function saveMachine() {
    setSaving(true); setError(null);
    const payload = {
      machine_id: machineForm.machine_id,
      name: machineForm.name,
      kind: machineForm.kind,
      controller: machineForm.controller,
      x_travel: machineForm.x_travel ? +machineForm.x_travel : null,
      y_travel: machineForm.y_travel ? +machineForm.y_travel : null,
      z_travel: machineForm.z_travel ? +machineForm.z_travel : null,
      max_rpm: machineForm.max_rpm ? +machineForm.max_rpm : null,
      tool_capacity: machineForm.tool_capacity ? +machineForm.tool_capacity : 24,
      notes: machineForm.notes || null,
    };
    const r = await fetch("/api/machines", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (r.ok) { setAddingMachine(false); setMachineForm(BLANK_MACHINE); await load(); }
    else setError(await r.text());
    setSaving(false);
  }

  async function saveTool() {
    setSaving(true); setError(null);
    const payload = {
      tool_no: toolForm.tool_no,
      description: toolForm.description,
      kind: toolForm.kind,
      diameter_mm: toolForm.diameter_mm ? +toolForm.diameter_mm : null,
      length_mm: toolForm.length_mm ? +toolForm.length_mm : null,
      flutes: toolForm.flutes ? +toolForm.flutes : null,
      material: toolForm.material,
      coating: toolForm.coating || null,
      max_rpm: toolForm.max_rpm ? +toolForm.max_rpm : null,
      feed_per_tooth: toolForm.feed_per_tooth ? +toolForm.feed_per_tooth : null,
      notes: toolForm.notes || null,
    };
    const r = await fetch("/api/tools", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (r.ok) { setAddingTool(false); setToolForm(BLANK_TOOL); await load(); }
    else setError(await r.text());
    setSaving(false);
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Cpu className="text-blue-400" size={24} /> Machine &amp; Tool Library
            </h1>
            <p className="text-zinc-400 text-sm mt-1">
              Configure machines and tools — used by the AI when generating G-code
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-zinc-800">
          {(["machines", "tools"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-2 text-sm font-medium capitalize border-b-2 transition ${tab === t ? "border-blue-500 text-white" : "border-transparent text-zinc-400 hover:text-zinc-200"}`}
            >
              {t === "machines" ? `Machines (${machines.length})` : `Tools (${tools.length})`}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-zinc-500 text-center py-16">Loading…</div>
        ) : tab === "machines" ? (
          <>
            {/* Machine list */}
            <div className="space-y-3">
              {machines.map(m => (
                <div key={m.id} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between px-5 py-4 hover:bg-zinc-800/50 transition"
                    onClick={() => setExpanded(expanded === m.id ? null : m.id)}
                  >
                    <div className="flex items-center gap-4 text-left">
                      <span className="font-mono font-bold text-blue-400 text-lg w-20">{m.machine_id}</span>
                      <span className="font-medium">{m.name}</span>
                      <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">{KIND_LABELS[m.kind] ?? m.kind}</span>
                      <span className="text-xs text-zinc-500 capitalize">{m.controller}</span>
                    </div>
                    <div className="flex items-center gap-4 text-zinc-500 text-sm">
                      {m.x_travel && <span>X{m.x_travel}×Y{m.y_travel}×Z{m.z_travel} mm</span>}
                      {m.max_rpm && <span>{m.max_rpm.toLocaleString()} RPM</span>}
                      <span>{m.machine_tools?.length ?? 0} tools</span>
                      {expanded === m.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                  </button>
                  {expanded === m.id && (
                    <div className="border-t border-zinc-800 px-5 py-4">
                      {m.notes && <p className="text-zinc-400 text-sm mb-3">{m.notes}</p>}
                      <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2 font-semibold">Assigned Tools</p>
                      {(m.machine_tools?.length ?? 0) === 0 ? (
                        <p className="text-zinc-600 text-sm">No tools assigned. Assign tools from the Tools tab.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {m.machine_tools!.map(mt => (
                            <span key={mt.tool_id} className={`text-xs px-2 py-1 rounded font-mono ${TOOL_KIND_COLORS[mt.tools.kind] ?? "bg-zinc-700 text-zinc-300"}`}>
                              {mt.tools.tool_no} — {mt.tools.description}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Add machine */}
            {addingMachine ? (
              <div className="mt-4 bg-zinc-900 border border-zinc-700 rounded-xl p-5 space-y-3">
                <p className="font-semibold text-sm">Add Machine</p>
                {error && <p className="text-red-400 text-sm">{error}</p>}
                <div className="grid grid-cols-2 gap-3">
                  {[["machine_id","Machine ID (e.g. VMC-03)"],["name","Full name"],["controller","Controller (fanuc/siemens/haas)"],
                    ["x_travel","X Travel (mm)"],["y_travel","Y Travel (mm)"],["z_travel","Z Travel (mm)"],
                    ["max_rpm","Max RPM"],["tool_capacity","Tool capacity"]].map(([k,pl]) => (
                    <input key={k} placeholder={pl} value={machineForm[k]} onChange={e => setMachineForm(p => ({...p,[k]:e.target.value}))}
                      className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500" />
                  ))}
                  <select value={machineForm.kind} onChange={e => setMachineForm(p=>({...p,kind:e.target.value}))}
                    className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 col-span-2 focus:outline-none focus:border-blue-500">
                    {Object.entries(KIND_LABELS).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <textarea placeholder="Notes (optional)" value={machineForm.notes} onChange={e => setMachineForm(p=>({...p,notes:e.target.value}))}
                    className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 col-span-2 h-16 resize-none focus:outline-none focus:border-blue-500" />
                </div>
                <div className="flex gap-2">
                  <button onClick={saveMachine} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm disabled:opacity-50">{saving?"Saving…":"Save"}</button>
                  <button onClick={()=>setAddingMachine(false)} className="text-zinc-400 hover:text-zinc-200 px-4 py-2 rounded text-sm">Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={()=>setAddingMachine(true)} className="mt-4 flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300">
                <Plus size={16}/> Add Machine
              </button>
            )}
          </>
        ) : (
          <>
            {/* Tools grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {tools.map(t => (
                <div key={t.id} className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-4 flex gap-4">
                  <div className="flex-shrink-0">
                    <Wrench size={20} className="text-zinc-500 mt-1" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-blue-400">{t.tool_no}</span>
                      <span className={`text-xs px-2 py-0.5 rounded capitalize ${TOOL_KIND_COLORS[t.kind]}`}>{t.kind}</span>
                      <span className="text-xs text-zinc-500">{t.material}</span>
                      {t.coating && <span className="text-xs text-zinc-600">{t.coating}</span>}
                    </div>
                    <p className="text-sm text-zinc-200 mt-1">{t.description}</p>
                    <div className="flex gap-3 mt-2 text-xs text-zinc-500 flex-wrap">
                      {t.diameter_mm && <span>Ø{t.diameter_mm}mm</span>}
                      {t.length_mm && <span>L{t.length_mm}mm</span>}
                      {t.flutes && <span>{t.flutes}fl</span>}
                      {t.max_rpm && <span>{t.max_rpm.toLocaleString()} RPM</span>}
                      {t.feed_per_tooth && <span>{t.feed_per_tooth}mm/tooth</span>}
                    </div>
                    {t.notes && <p className="text-xs text-zinc-600 mt-1">{t.notes}</p>}
                  </div>
                </div>
              ))}
            </div>

            {/* Add tool */}
            {addingTool ? (
              <div className="mt-4 bg-zinc-900 border border-zinc-700 rounded-xl p-5 space-y-3">
                <p className="font-semibold text-sm">Add Tool</p>
                {error && <p className="text-red-400 text-sm">{error}</p>}
                <div className="grid grid-cols-2 gap-3">
                  {[["tool_no","Tool No (e.g. T11)"],["description","Description"],
                    ["diameter_mm","Diameter (mm)"],["length_mm","Length (mm)"],
                    ["flutes","Flutes"],["max_rpm","Max RPM"],
                    ["feed_per_tooth","Feed/tooth (mm)"],["material","Material (carbide/hss)"],
                    ["coating","Coating (TiAlN/TiN/uncoated)"]].map(([k,pl]) => (
                    <input key={k} placeholder={pl} value={toolForm[k]} onChange={e => setToolForm(p=>({...p,[k]:e.target.value}))}
                      className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500" />
                  ))}
                  <select value={toolForm.kind} onChange={e=>setToolForm(p=>({...p,kind:e.target.value}))}
                    className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 col-span-2 focus:outline-none focus:border-blue-500">
                    {["endmill","drill","boring","reamer","tap","insert","ball","chamfer","other"].map(k => (
                      <option key={k} value={k} className="capitalize">{k}</option>
                    ))}
                  </select>
                  <textarea placeholder="Notes (optional)" value={toolForm.notes} onChange={e=>setToolForm(p=>({...p,notes:e.target.value}))}
                    className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 col-span-2 h-16 resize-none focus:outline-none focus:border-blue-500" />
                </div>
                <div className="flex gap-2">
                  <button onClick={saveTool} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm disabled:opacity-50">{saving?"Saving…":"Save"}</button>
                  <button onClick={()=>setAddingTool(false)} className="text-zinc-400 hover:text-zinc-200 px-4 py-2 rounded text-sm">Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={()=>setAddingTool(true)} className="mt-4 flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300">
                <Plus size={16}/> Add Tool
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
