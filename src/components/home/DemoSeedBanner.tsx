"use client";

/**
 * Shown when the document library is empty.
 * Lets any new user seed the demo data with one click so the app is never blank.
 * Once seeded, a small badge replaces the banner.
 */
import { useEffect, useState } from "react";
import { Sparkles, CheckCircle, Loader2 } from "lucide-react";

type SeedState = "idle" | "loading" | "done" | "error";

const STORAGE_KEY = "demo_seeded";

export function DemoSeedBanner() {
  const [docCount, setDocCount] = useState<number | null>(null);
  const [state, setState]       = useState<SeedState>("idle");
  const [message, setMessage]   = useState("");

  // Check if already seeded this session
  const alreadySeeded =
    typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEY) === "1";

  useEffect(() => {
    // Quick doc count check
    fetch("/api/ingest")
      .then((r) => r.json())
      .then((d: { documents?: unknown[] }) => setDocCount((d.documents ?? []).length))
      .catch(() => setDocCount(0));
  }, []);

  const seed = async () => {
    setState("loading");
    try {
      const res = await fetch("/api/seed", { method: "POST" });
      const data = (await res.json()) as { success: boolean; message?: string; error?: string };
      if (data.success) {
        setState("done");
        setMessage(data.message ?? "Demo data loaded.");
        window.localStorage.setItem(STORAGE_KEY, "1");
        // Reload the page so LiveStats and RecentDocuments pick up the new docs
        setTimeout(() => window.location.reload(), 1200);
      } else {
        setState("error");
        setMessage(data.error ?? "Seed failed.");
      }
    } catch (e) {
      setState("error");
      setMessage(e instanceof Error ? e.message : "Network error");
    }
  };

  // If we already know there are docs, or we seeded this browser session, show nothing (or a small badge)
  if (alreadySeeded || docCount === null) return null;

  if (docCount > 0) {
    // Quiet demo badge — only if this browser seeded before
    return null;
  }

  return (
    <div className="rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50 p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
      <div className="h-12 w-12 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
        <Sparkles className="h-6 w-6 text-blue-600" />
      </div>

      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-gray-900 text-sm">Your document library is empty</h3>
        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
          Load 8 sample manufacturing documents (drawings, inspection reports, POs, tooling, inventory, QMS) to explore
          Ask AI, the KPI dashboard, and all features right now. No upload needed.
        </p>
        {state === "error" && (
          <p className="text-xs text-red-600 mt-1 font-medium">{message}</p>
        )}
        {state === "done" && (
          <p className="text-xs text-green-700 mt-1 font-medium flex items-center gap-1">
            <CheckCircle className="h-3.5 w-3.5" /> {message} Reloading…
          </p>
        )}
      </div>

      <button
        type="button"
        disabled={state === "loading" || state === "done"}
        onClick={() => void seed()}
        className="shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-60"
      >
        {state === "loading" ? (
          <><Loader2 className="h-4 w-4 animate-spin" /> Loading demo…</>
        ) : state === "done" ? (
          <><CheckCircle className="h-4 w-4" /> Done!</>
        ) : (
          <><Sparkles className="h-4 w-4" /> Load demo data</>
        )}
      </button>
    </div>
  );
}
