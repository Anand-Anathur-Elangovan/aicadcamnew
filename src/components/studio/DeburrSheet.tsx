"use client";

import { useEffect, useRef } from "react";
import type { DeburrSheet as Sheet } from "@/lib/studio/stageSheets";

export default function DeburrSheet({ sheet }: { sheet: Sheet }) {
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
      ctx.fillText("DEBURR", 36, 52);
      ctx.font = "14px sans-serif";
      ctx.fillText(`${sheet.partNumber}  ·  Rev ${sheet.revision}  ·  ${sheet.material}`, 36, 76);
      ctx.fillStyle = "#334155";
      ctx.font = "13px sans-serif";
      ctx.fillText(sheet.note, 36, 98);

      const x = 80;
      const y = 150;
      ctx.fillStyle = "#e2e8f0";
      ctx.fillRect(x, y, 220, 120);
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#ea580c";
      ctx.strokeRect(x, y, 220, 120);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#0f172a";
      ctx.strokeRect(x + 70, y + 36, 80, 48);
      ctx.beginPath();
      ctx.arc(x + 160, y + 36, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "#ea580c";
      ctx.strokeRect(x + 70, y + 36, 80, 48);
      ctx.beginPath();
      ctx.arc(x + 160, y + 36, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#9a3412";
      ctx.font = "12px sans-serif";
      ctx.fillText("Orange edges are broken", x, y + 150);

      ctx.fillStyle = "#0f172a";
      ctx.font = "14px sans-serif";
      let line = y;
      const listX = x + 280;
      sheet.edges.forEach((edge, index) => {
        ctx.fillStyle = "#ea580c";
        ctx.fillRect(listX, line + 4, 10, 10);
        ctx.fillStyle = "#0f172a";
        ctx.fillText(`${index + 1}. ${edge}`, listX + 18, line + 14);
        line += 28;
      });

      const blockX = 36;
      const blockY = height - 92;
      ctx.strokeStyle = "#0f172a";
      ctx.strokeRect(blockX, blockY, width - 72, 60);
      ctx.fillStyle = "#0f172a";
      ctx.font = "13px sans-serif";
      ctx.fillText(`Sheet 5  ·  Deburr  ·  ${sheet.partName}`, blockX + 12, blockY + 24);
      ctx.fillText(`${sheet.edges.length} edges`, blockX + 12, blockY + 44);
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
