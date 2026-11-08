"use client";

import { useEffect, useRef } from "react";
import type { CncSheet as Sheet } from "@/lib/studio/stageSheets";

export default function CncSheet({ sheet }: { sheet: Sheet }) {
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
      ctx.fillText("CNC", 36, 52);
      ctx.font = "14px sans-serif";
      ctx.fillText(`${sheet.partNumber}  ·  Rev ${sheet.revision}  ·  ${sheet.material}`, 36, 76);
      ctx.fillStyle = "#334155";
      ctx.font = "13px sans-serif";
      ctx.fillText(`${sheet.machine}. ${sheet.note}`, 36, 98);

      const x = 90;
      const y = 180;
      const drawScale = Math.min(460 / sheet.length, 160 / Math.max(sheet.height, sheet.diameter || sheet.height));
      const barW = sheet.length * drawScale;
      const barH = sheet.height * drawScale;

      ctx.fillStyle = "#64748b";
      ctx.font = "12px sans-serif";
      ctx.fillText(sheet.kind === "turn" ? "Front, after turning" : "Front, after facing", x, y - 12);
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = 1.5;

      if (sheet.kind === "turn") {
        const turnedW = Math.max(sheet.length - sheet.grip, 1) * drawScale;
        const gripW = sheet.grip * drawScale;
        const diaH = sheet.diameter * drawScale;
        const diaY = y + (barH - diaH) / 2;
        ctx.fillStyle = "#e2e8f0";
        ctx.fillRect(x, y, gripW, barH);
        ctx.fillRect(x + gripW, diaY, turnedW, diaH);
        ctx.strokeRect(x, y, gripW, barH);
        ctx.strokeRect(x + gripW, diaY, turnedW, diaH);
        ctx.fillStyle = "#0369a1";
        ctx.font = "12px sans-serif";
        ctx.fillText(`Ø${sheet.diameter} mm`, x + gripW, diaY - 8);
        ctx.fillText(`${sheet.length} mm`, x, y + barH + 20);
        ctx.fillText(`grip ${sheet.grip} mm`, x, y + barH + 36);
      } else {
        const cut = (sheet.height - sheet.facedHeight) * drawScale;
        ctx.fillStyle = "#fecaca";
        ctx.fillRect(x, y, barW, cut);
        ctx.fillStyle = "#e2e8f0";
        ctx.fillRect(x, y + cut, barW, barH - cut);
        ctx.strokeRect(x, y + cut, barW, barH - cut);
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = "#b91c1c";
        ctx.strokeRect(x, y, barW, cut);
        ctx.setLineDash([]);
        ctx.fillStyle = "#0369a1";
        ctx.font = "12px sans-serif";
        ctx.fillText(`${sheet.facedHeight} mm`, x - 64, y + cut + (barH - cut) / 2);
        ctx.fillStyle = "#b91c1c";
        ctx.fillText(`${sheet.height - sheet.facedHeight} mm faced off`, x, y - 16);
        ctx.fillStyle = "#0369a1";
        ctx.fillText(`${sheet.length} mm`, x, y + barH + 20);
      }

      const blockX = 36;
      const blockY = height - 92;
      ctx.strokeStyle = "#0f172a";
      ctx.strokeRect(blockX, blockY, width - 72, 60);
      ctx.fillStyle = "#0f172a";
      ctx.font = "13px sans-serif";
      ctx.fillText(`Sheet 3  ·  CNC  ·  ${sheet.partName}`, blockX + 12, blockY + 24);
      const result = sheet.kind === "turn"
        ? `Blank ${sheet.width} × ${sheet.height} mm square  →  Ø${sheet.diameter} mm`
        : `Blank ${sheet.height} mm thick  →  ${sheet.facedHeight} mm after the face cut`;
      ctx.fillText(result, blockX + 12, blockY + 44);
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
