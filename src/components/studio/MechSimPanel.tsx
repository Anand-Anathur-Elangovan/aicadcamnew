"use client";

import { useState } from "react";
import { MECHSIM_PAGE, externalEmbedUrl, mechsimShareUrl } from "@/lib/gcode/mechsim";

interface Props {
  gcode: string;
  lathe: boolean;
  fileName: string;
}

export default function MechSimPanel({ gcode, lathe, fileName }: Props) {
  const [message, setMessage] = useState("");
  const embed = externalEmbedUrl();
  const hasProgram = gcode.trim().length > 0;

  const save = () => {
    const url = URL.createObjectURL(new Blob([gcode], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const copy = async (): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(gcode);
      return true;
    } catch {
      return false;
    }
  };

  const open = async () => {
    const link = await mechsimShareUrl(gcode);
    if (link) {
      window.open(link, "_blank", "noopener");
      setMessage("Opened with your program loaded. Pick the matching machine at the top of the tool.");
      return;
    }
    const copied = await copy();
    save();
    window.open(MECHSIM_PAGE, "_blank", "noopener");
    setMessage(
      `This program is too long for a link. ${copied ? "It is copied to the clipboard and " : "It is "}saved as ${fileName}. Paste it into the editor, or use Program, then Import file.`
    );
  };

  return (
    <div className="absolute inset-0 overflow-auto bg-slate-950 px-6 pb-6 pt-20" data-testid="mechsim-panel">
      <div className="mx-auto max-w-2xl space-y-4">
        <h2 className="text-lg font-semibold text-slate-100">Run this program in MechSimulator</h2>
        <p className="text-sm text-slate-300">
          MechSimulator&apos;s CNC G-code tool is a good second opinion for a program. Its server does not allow other sites to frame it, so it opens in its own tab with the
          program from the editor already loaded.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!hasProgram}
            onClick={open}
            className="rounded bg-cyan-600 px-3 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-40"
          >
            Open in MechSimulator
          </button>
          <button
            type="button"
            disabled={!hasProgram}
            onClick={async () => setMessage((await copy()) ? "Program copied." : "Copy was blocked by the browser.")}
            className="rounded border border-slate-500 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-40"
          >
            Copy program
          </button>
          <button
            type="button"
            disabled={!hasProgram}
            onClick={save}
            className="rounded border border-slate-500 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-40"
          >
            Download .nc
          </button>
        </div>
        {!hasProgram && <p className="text-sm text-amber-300">Generate or save a program first.</p>}
        {message && <p className="rounded border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200">{message}</p>}
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-400">
          <li>In MechSimulator choose <strong className="text-slate-200">{lathe ? "Turning" : "Milling"}</strong> to match this program.</li>
          <li>It opens the saved program. Press Save in the editor first if you changed it.</li>
        </ul>
      </div>
      {embed && (
        <iframe
          title="External G-code simulator"
          src={embed}
          className="mt-6 h-[70vh] w-full rounded border border-slate-700 bg-white"
          sandbox="allow-scripts allow-same-origin allow-popups allow-downloads"
        />
      )}
    </div>
  );
}
