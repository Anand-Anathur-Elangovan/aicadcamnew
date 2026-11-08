"use client";

import { useEffect, useRef } from "react";
import type { PackSheet as Sheet } from "@/lib/studio/stageSheets";

export default function PackSheet({ sheet }: { sheet: Sheet }) {
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
      ctx.fillText("PACK", 36, 52);
      ctx.font = "14px sans-serif";
      ctx.fillText(`${sheet.partNumber}  ·  Rev ${sheet.revision}  ·  ${sheet.material}`, 36, 76);
      ctx.fillStyle = "#334155";
      ctx.font = "13px sans-serif";
      ctx.fillText(sheet.note, 36, 98);

      const boxX = 80;
      const boxY = 150;
      const boxW = 280;
      const boxH = 160;
      ctx.fillStyle = "#e2e8f0";
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(boxX, boxY, boxW, boxH);
      ctx.beginPath();
      ctx.moveTo(boxX, boxY);
      ctx.lineTo(boxX + 36, boxY - 22);
      ctx.lineTo(boxX + boxW + 36, boxY - 22);
      ctx.lineTo(boxX + boxW, boxY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(boxX + boxW, boxY);
      ctx.lineTo(boxX + boxW + 36, boxY - 22);
      ctx.lineTo(boxX + boxW + 36, boxY + boxH - 22);
      ctx.lineTo(boxX + boxW, boxY + boxH);
      ctx.stroke();

      ctx.fillStyle = "#fef9c3";
      ctx.fillRect(boxX + 24, boxY + 28, 180, 90);
      ctx.strokeRect(boxX + 24, boxY + 28, 180, 90);
      ctx.fillStyle = "#0f172a";
      ctx.font = "13px sans-serif";
      ctx.fillText(sheet.partNumber, boxX + 36, boxY + 52);
      ctx.fillText(`Rev ${sheet.revision}`, boxX + 36, boxY + 72);
      ctx.fillText(`Qty ${sheet.quantity}`, boxX + 36, boxY + 92);
      ctx.font = "12px sans-serif";
      ctx.fillText(sheet.finished, boxX + 36, boxY + 110);

      ctx.font = "14px sans-serif";
      let line = boxY;
      const listX = boxX + boxW + 70;
      sheet.checks.forEach((check, index) => {
        ctx.fillStyle = "#0f172a";
        ctx.fillText(`${index + 1}. ${check}`, listX, line + 16);
        line += 36;
      });

      const blockX = 36;
      const blockY = height - 92;
      ctx.strokeStyle = "#0f172a";
      ctx.strokeRect(blockX, blockY, width - 72, 60);
      ctx.fillStyle = "#0f172a";
      ctx.font = "13px sans-serif";
      ctx.fillText(`Sheet 6  ·  Pack  ·  ${sheet.partName}`, blockX + 12, blockY + 24);
      ctx.fillText(`${sheet.finished}  ·  qty ${sheet.quantity}`, blockX + 12, blockY + 44);
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
