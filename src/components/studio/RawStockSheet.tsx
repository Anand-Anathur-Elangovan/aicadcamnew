"use client";

import { useEffect, useRef } from "react";
import type { RawStockSheet as Sheet } from "@/lib/studio/stageSheets";

function fit(size: number, max: number): number {
  return size <= 0 ? 1 : max / size;
}

export default function RawStockSheet({ sheet }: { sheet: Sheet }) {
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
      ctx.fillText("RAW STOCK", 36, 52);
      ctx.font = "14px sans-serif";
      ctx.fillText(`${sheet.partNumber}  ·  Rev ${sheet.revision}  ·  ${sheet.material}`, 36, 76);
      ctx.fillStyle = "#334155";
      ctx.font = "13px sans-serif";
      ctx.fillText(sheet.note, 36, 98);

      const viewMaxW = Math.min(420, width * 0.42);
      const viewMaxH = Math.min(220, height * 0.36);
      const front = Math.min(fit(sheet.length, viewMaxW), fit(sheet.height, viewMaxH));
      const end = Math.min(fit(sheet.width, viewMaxW * 0.55), fit(sheet.height, viewMaxH));
      const frontW = sheet.length * front;
      const frontH = sheet.height * front;
      const endW = sheet.width * end;
      const endH = sheet.height * end;
      const frontX = 72;
      const frontY = 150;
      const endX = frontX + frontW + 90;
      const endY = frontY;

      const box = (x: number, y: number, w: number, h: number) => {
        ctx.strokeStyle = "#0f172a";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, w, h);
      };
      const dim = (x1: number, y1: number, x2: number, y2: number, label: string) => {
        ctx.strokeStyle = "#0369a1";
        ctx.fillStyle = "#0369a1";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.font = "12px sans-serif";
        ctx.fillText(label, (x1 + x2) / 2 + 4, (y1 + y2) / 2 - 4);
      };

      ctx.fillStyle = "#64748b";
      ctx.font = "12px sans-serif";
      ctx.fillText("Front", frontX, frontY - 10);
      box(frontX, frontY, frontW, frontH);
      dim(frontX, frontY + frontH + 18, frontX + frontW, frontY + frontH + 18, `${sheet.length} mm`);
      dim(frontX - 8, frontY, frontX - 8, frontY + frontH, `${sheet.height} mm`);

      ctx.fillStyle = "#64748b";
      ctx.fillText("End", endX, endY - 10);
      box(endX, endY, endW, endH);
      dim(endX, endY + endH + 18, endX + endW, endY + endH + 18, `${sheet.width} mm`);

      const blockX = 36;
      const blockY = height - 92;
      ctx.strokeStyle = "#0f172a";
      ctx.strokeRect(blockX, blockY, width - 72, 60);
      ctx.fillStyle = "#0f172a";
      ctx.font = "13px sans-serif";
      ctx.fillText(`Sheet 1  ·  Raw  ·  ${sheet.partName}`, blockX + 12, blockY + 24);
      ctx.fillText(`${sheet.length} × ${sheet.width} × ${sheet.height} mm`, blockX + 12, blockY + 44);
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
