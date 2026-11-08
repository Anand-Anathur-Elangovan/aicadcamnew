"use client";

import { useEffect, useRef } from "react";
import type { BandsawSheet as Sheet } from "@/lib/studio/stageSheets";

export default function BandsawSheet({ sheet }: { sheet: Sheet }) {
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
      ctx.fillText("BANDSAW", 36, 52);
      ctx.font = "14px sans-serif";
      ctx.fillText(`${sheet.partNumber}  ·  Rev ${sheet.revision}  ·  ${sheet.material}`, 36, 76);
      ctx.fillStyle = "#334155";
      ctx.font = "13px sans-serif";
      ctx.fillText(sheet.note, 36, 98);

      const viewMaxW = Math.min(520, width * 0.62);
      const viewMaxH = Math.min(180, height * 0.28);
      const drawScale = Math.min(viewMaxW / sheet.incomingLength, viewMaxH / sheet.height);
      const barW = sheet.incomingLength * drawScale;
      const barH = sheet.height * drawScale;
      const blankW = sheet.blankLength * drawScale;
      const x = 80;
      const y = 170;

      ctx.fillStyle = "#64748b";
      ctx.font = "12px sans-serif";
      ctx.fillText("Cut along the length", x, y - 12);
      ctx.fillStyle = "#e2e8f0";
      ctx.fillRect(x, y, blankW, barH);
      ctx.fillStyle = "#fecaca";
      ctx.fillRect(x + blankW, y, barW - blankW, barH);
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, barW, barH);
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = "#b91c1c";
      ctx.beginPath();
      ctx.moveTo(x + blankW, y - 8);
      ctx.lineTo(x + blankW, y + barH + 8);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = "#0369a1";
      ctx.font = "12px sans-serif";
      ctx.fillText(`${sheet.blankLength} mm blank`, x, y + barH + 22);
      ctx.fillStyle = "#b91c1c";
      ctx.fillText(`${sheet.allowance} mm`, x + blankW - 8, y - 18);
      ctx.fillStyle = "#0369a1";
      ctx.fillText(`${sheet.height} mm`, x - 56, y + barH / 2);

      const end = Math.min(140 / sheet.width, viewMaxH / sheet.height);
      const endX = x + barW + 70;
      ctx.fillStyle = "#64748b";
      ctx.fillText("End, unchanged", endX, y - 12);
      ctx.strokeStyle = "#0f172a";
      ctx.strokeRect(endX, y, sheet.width * end, sheet.height * end);
      ctx.fillStyle = "#0369a1";
      ctx.fillText(`${sheet.width} mm`, endX, y + sheet.height * end + 22);

      const blockX = 36;
      const blockY = height - 92;
      ctx.strokeStyle = "#0f172a";
      ctx.strokeRect(blockX, blockY, width - 72, 60);
      ctx.fillStyle = "#0f172a";
      ctx.font = "13px sans-serif";
      ctx.fillText(`Sheet 2  ·  Bandsaw  ·  ${sheet.partName}`, blockX + 12, blockY + 24);
      ctx.fillText(`Incoming ${sheet.incomingLength} mm  →  blank ${sheet.blankLength} × ${sheet.width} × ${sheet.height} mm`, blockX + 12, blockY + 44);
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
