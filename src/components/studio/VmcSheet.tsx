"use client";

import { useEffect, useRef } from "react";
import type { VmcSheet as Sheet } from "@/lib/studio/stageSheets";

export default function VmcSheet({ sheet }: { sheet: Sheet }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;

    const draw = () => {
      const width = Math.max(parent.clientWidth, 640);
      const height = Math.max(parent.clientHeight, 480);
      const scale = window.devicePixelRatio || 1;
      canvas.width = Math.floor(width * scale);
      canvas.height = Math.floor(height * scale);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = "#0f172a";
      ctx.strokeRect(16, 16, width - 32, height - 32);
      ctx.fillStyle = "#0f172a";
      ctx.font = "700 22px sans-serif";
      ctx.fillText("VMC", 36, 52);
      ctx.font = "14px sans-serif";
      ctx.fillText(`${sheet.partNumber}  ·  Rev ${sheet.revision}  ·  ${sheet.material}`, 36, 76);
      ctx.fillStyle = "#334155";
      ctx.font = "13px sans-serif";
      ctx.fillText(sheet.note, 36, 98);

      const x = 90;
      const y = 170;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#0f172a";
      ctx.fillStyle = "#e2e8f0";

      if (sheet.kind === "bore") {
        const drawScale = Math.min(460 / sheet.length, 150 / Math.max(sheet.height, sheet.diameter));
        const barH = sheet.height * drawScale;
        const diaH = sheet.diameter * drawScale;
        const gripW = sheet.grip * drawScale;
        const turnedW = Math.max(sheet.length - sheet.grip, 1) * drawScale;
        const diaY = y + (barH - diaH) / 2;
        const boreH = sheet.bore * drawScale;
        const boreY = diaY + (diaH - boreH) / 2;
        ctx.fillRect(x, y, gripW, barH);
        ctx.fillRect(x + gripW, diaY, turnedW, diaH);
        ctx.strokeRect(x, y, gripW, barH);
        ctx.strokeRect(x + gripW, diaY, turnedW, diaH);
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = "#0369a1";
        ctx.strokeRect(x + gripW, boreY, turnedW, boreH);
        ctx.beginPath();
        ctx.moveTo(x + gripW, diaY + diaH / 2);
        ctx.lineTo(x + gripW + turnedW, diaY + diaH / 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#0369a1";
        ctx.font = "12px sans-serif";
        ctx.fillText(`Ø${sheet.bore} mm bore`, x + gripW, boreY - 8);
        ctx.fillText(`inside Ø${sheet.diameter} mm`, x + gripW, y + barH + 22);
      } else {
        const drawScale = Math.min(480 / sheet.length, 220 / sheet.width);
        const viewW = sheet.length * drawScale;
        const viewH = sheet.width * drawScale;
        ctx.fillRect(x, y, viewW, viewH);
        ctx.strokeRect(x, y, viewW, viewH);
        ctx.fillStyle = "#64748b";
        ctx.font = "12px sans-serif";
        ctx.fillText("Top view", x, y - 12);
        let holeIndex = 0;
        let caption = 0;
        for (const mark of sheet.marks) {
          if (mark.kind === "pocket" || mark.kind === "slot") {
            const long = Math.max(mark.length, 4) * drawScale;
            const short = Math.max(mark.width, 4) * drawScale;
            const horizontal = mark.run !== "width";
            const boxW = horizontal ? long : short;
            const boxH = horizontal ? short : long;
            const placed = mark.along != null && mark.across != null;
            const cx = placed ? x + (mark.along ?? 0.5) * viewW : x + viewW / 2;
            const cy = placed ? y + (mark.across ?? 0.5) * viewH : y + viewH / 2;
            ctx.beginPath();
            ctx.strokeStyle = "#b45309";
            if (mark.kind === "slot" && typeof ctx.roundRect === "function") {
              ctx.roundRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH, Math.min(boxW, boxH) / 2);
            } else {
              ctx.rect(cx - boxW / 2, cy - boxH / 2, boxW, boxH);
            }
            ctx.stroke();
            ctx.fillStyle = "#b45309";
            const label = mark.kind === "slot"
              ? `slot ${mark.width} × ${mark.length} mm`
              : `pocket ${mark.depth} mm deep`;
            ctx.fillText(label, x, y + viewH + 18 + caption);
            caption += 16;
          } else {
            const shown = Math.min(mark.count, 8);
            const placed = mark.along != null && mark.across != null && shown === 1;
            const cols = shown <= 2 ? shown : 2;
            for (let index = 0; index < shown; index += 1) {
              const col = holeIndex % cols;
              const row = Math.floor(holeIndex / cols);
              const cx = placed ? x + (mark.along ?? 0.5) * viewW : x + viewW * (0.22 + col * 0.56);
              const cy = placed ? y + (mark.across ?? 0.5) * viewH : y + viewH * (0.28 + row * 0.44);
              const radius = Math.max(placed ? 3 : 4, (mark.diameter / 2) * drawScale);
              ctx.beginPath();
              ctx.strokeStyle = "#0369a1";
              ctx.arc(cx, cy, radius, 0, Math.PI * 2);
              ctx.stroke();
              holeIndex += 1;
            }
            ctx.fillStyle = "#0369a1";
            ctx.fillText(`${mark.count} × Ø${mark.diameter} mm`, x, y + viewH + 18 + caption);
            caption += 16;
          }
        }
        if (!sheet.marks.length) {
          ctx.fillStyle = "#64748b";
          ctx.fillText("No pocket or hole", x, y + viewH + 22);
        }
      }

      const blockX = 36;
      const blockY = height - 92;
      ctx.strokeStyle = "#0f172a";
      ctx.strokeRect(blockX, blockY, width - 72, 60);
      ctx.fillStyle = "#0f172a";
      ctx.font = "13px sans-serif";
      ctx.fillText(`Sheet 4  ·  VMC  ·  ${sheet.partName}`, blockX + 12, blockY + 24);
      const summary = sheet.kind === "bore"
        ? `Ø${sheet.diameter} mm cylinder  →  Ø${sheet.bore} mm bore`
        : sheet.marks.map((mark) => mark.kind === "hole" ? `${mark.count} × Ø${mark.diameter} hole` : mark.kind === "slot" ? `${mark.count} slot` : `${mark.count} pocket`).join(", ") || "No VMC cut";
      ctx.fillText(summary, blockX + 12, blockY + 44);
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [sheet]);

  return (
    <div className="absolute inset-0 bg-slate-200">
      <canvas ref={canvasRef} className="block" />
    </div>
  );
}
