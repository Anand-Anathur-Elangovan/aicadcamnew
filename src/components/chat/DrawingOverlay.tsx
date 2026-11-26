"use client";

/**
 * DrawingOverlay
 * Renders a PDF page (using pdfjs-dist that is already in the project) inside
 * a slide-over drawer.  The page is first drawn normally, then a semi-transparent
 * yellow strip is painted over the vertical band that corresponds to the cited
 * snippet.  For drawings without exact coordinates the strip covers the top-third
 * of the page by default (where the title block is on most engineering drawings).
 */

import { useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Download } from "lucide-react";
import type { Citation } from "@/lib/types";

interface DrawingOverlayProps {
  citation: Citation;
  onClose: () => void;
}

export function DrawingOverlay({ citation, onClose }: DrawingOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [scale, setScale]         = useState(1.4);
  const [pageNum, setPageNum]     = useState(citation.pageNumber ?? 1);
  const [totalPages, setTotalPages] = useState(0);

  // Keep a ref to the loaded PDF document so page changes don't re-fetch
  const pdfRef = useRef<import("pdfjs-dist").PDFDocumentProxy | null>(null);

  /* ── Load the PDF once ───────────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;

    async function loadPdf() {
      setLoading(true);
      setError(null);
      try {
        const pdfjs = await import("pdfjs-dist");
        // Worker — reuse the same path set up by Studio
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

        const url = citation.downloadUrl;
        const doc = await pdfjs.getDocument({ url, withCredentials: false }).promise;
        if (cancelled) return;
        pdfRef.current = doc;
        setTotalPages(doc.numPages);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load PDF");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadPdf();
    return () => { cancelled = true; };
  }, [citation.downloadUrl]);

  /* ── Render the current page ─────────────────────────────────────── */
  useEffect(() => {
    if (!pdfRef.current || loading) return;
    if (pageNum < 1 || pageNum > totalPages) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;

    async function renderPage() {
      const doc = pdfRef.current!;
      const page = await doc.getPage(pageNum);
      if (cancelled || !canvasRef.current) return;

      const viewport = page.getViewport({ scale });
      const ctx = canvasRef.current.getContext("2d")!;
      canvasRef.current.width  = viewport.width;
      canvasRef.current.height = viewport.height;

      // pdfjs-dist types vary between versions; cast to bypass mismatch
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (page.render as any)({ canvasContext: ctx, viewport }).promise;
      if (cancelled) return;

      // Paint the redline highlight strip
      // We use the top-third (y: 0 → height*0.38) where the drawing title/notes live
      const h = viewport.height;
      const w = viewport.width;
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle   = "#FFD700"; // gold highlight
      ctx.fillRect(0, 0, w, h * 0.38);
      ctx.restore();

      // Dashed border around the highlighted area
      ctx.save();
      ctx.strokeStyle = "#F59E0B";
      ctx.lineWidth   = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(1, 1, w - 2, h * 0.38 - 2);
      ctx.restore();

      // "AI Citation" label
      ctx.save();
      ctx.font      = "bold 13px sans-serif";
      ctx.fillStyle = "#92400E";
      ctx.fillText("▲ AI Citation", 10, 20);
      ctx.restore();
    }

    void renderPage();
    return () => { cancelled = true; };
  }, [pageNum, scale, totalPages, loading]);

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-stretch justify-end"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Panel */}
      <div className="w-full max-w-3xl bg-white flex flex-col shadow-2xl overflow-hidden animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-gray-50 shrink-0">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{citation.documentName}</p>
            <p className="text-xs text-gray-500">
              Page {pageNum}{totalPages > 0 ? ` of ${totalPages}` : ""}
              {citation.partNumber ? ` · P/N ${citation.partNumber}` : ""}
              {citation.revision ? ` Rev ${citation.revision}` : ""}
            </p>
          </div>

          {/* Zoom */}
          <button type="button" onClick={() => setScale((s) => Math.min(s + 0.2, 3.0))} className="p-1.5 rounded hover:bg-gray-200 text-gray-600">
            <ZoomIn className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setScale((s) => Math.max(s - 0.2, 0.5))} className="p-1.5 rounded hover:bg-gray-200 text-gray-600">
            <ZoomOut className="h-4 w-4" />
          </button>

          {/* Download */}
          <a
            href={citation.downloadUrl}
            download
            className="p-1.5 rounded hover:bg-gray-200 text-gray-600"
            title="Download PDF"
          >
            <Download className="h-4 w-4" />
          </a>

          {/* Close */}
          <button type="button" onClick={onClose} className="p-1.5 rounded hover:bg-gray-200 text-gray-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Snippet banner */}
        {citation.snippet && (
          <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 text-xs text-amber-900 leading-relaxed shrink-0">
            <span className="font-semibold">Cited passage: </span>
            &ldquo;{citation.snippet.slice(0, 300)}{citation.snippet.length > 300 ? "…" : ""}&rdquo;
          </div>
        )}

        {/* Canvas area */}
        <div className="flex-1 overflow-auto bg-gray-100 flex items-start justify-center p-4">
          {loading && (
            <div className="flex flex-col items-center gap-3 mt-16 text-gray-500">
              <div className="h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm">Loading drawing…</span>
            </div>
          )}
          {error && (
            <div className="mt-16 text-red-600 text-sm text-center px-4">
              <p className="font-semibold">Could not load PDF</p>
              <p className="text-xs text-gray-500 mt-1">{error}</p>
            </div>
          )}
          {!loading && !error && (
            <canvas
              ref={canvasRef}
              className="shadow-xl rounded border border-gray-300"
            />
          )}
        </div>

        {/* Page navigation */}
        {totalPages > 1 && (
          <div className="shrink-0 flex items-center justify-center gap-4 py-3 border-t border-gray-200 bg-gray-50">
            <button
              type="button"
              disabled={pageNum <= 1}
              onClick={() => setPageNum((n) => n - 1)}
              className="p-1.5 rounded disabled:opacity-40 hover:bg-gray-200 text-gray-600"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <span className="text-sm text-gray-700">Page {pageNum} / {totalPages}</span>
            <button
              type="button"
              disabled={pageNum >= totalPages}
              onClick={() => setPageNum((n) => n + 1)}
              className="p-1.5 rounded disabled:opacity-40 hover:bg-gray-200 text-gray-600"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
