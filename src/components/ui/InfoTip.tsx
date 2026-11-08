"use client";

import { useRef, useState, type MouseEvent } from "react";

interface Props {
  title: string;
  lines: string[];
  /** Amber icon for a limit that applies to what the user is looking at right now. */
  attention?: boolean;
}

const WIDTH = 288;

/** A small "i" that opens a note on hover, focus or click. The note is placed against the window so a narrow panel cannot clip it. */
export default function InfoTip({ title, lines, attention = false }: Props) {
  const [spot, setSpot] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);

  const show = () => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.min(Math.max(8, rect.left - 8), window.innerWidth - WIDTH - 8);
    setSpot({ top: rect.bottom + 6, left });
  };
  const toggle = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (spot) setSpot(null);
    else show();
  };

  return (
    <span className="relative inline-flex align-middle" onMouseEnter={show} onMouseLeave={() => setSpot(null)}>
      <button
        ref={button}
        type="button"
        aria-label={title}
        aria-expanded={spot !== null}
        onClick={toggle}
        onFocus={show}
        onBlur={() => setSpot(null)}
        className={`flex h-4 w-4 items-center justify-center rounded-full border text-[10px] font-bold italic leading-none ${
          attention ? "border-amber-400 bg-amber-500/20 text-amber-300" : "border-slate-500 text-slate-300 hover:border-cyan-400 hover:text-cyan-300"
        }`}
        data-testid="info-tip"
      >
        i
      </button>
      {spot && (
        <span
          role="tooltip"
          style={{ position: "fixed", top: spot.top, left: spot.left, width: WIDTH }}
          className="z-50 rounded border border-slate-600 bg-slate-900 p-2 text-left text-[11px] font-normal not-italic leading-snug text-slate-200 shadow-lg"
        >
          <strong className="mb-1 block text-slate-100">{title}</strong>
          {lines.map((line) => (
            <span key={line} className="mb-1 block last:mb-0">{line}</span>
          ))}
        </span>
      )}
    </span>
  );
}
