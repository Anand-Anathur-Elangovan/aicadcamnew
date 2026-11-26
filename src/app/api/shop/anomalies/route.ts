import { NextRequest } from "next/server";
import { fetchAnomalies } from "@/lib/shop/anomaly";
import type { AnomalyKind } from "@/lib/shop/anomaly";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const anomalies = await fetchAnomalies({
      status:  sp.get("status")  ?? undefined,
      kind:    (sp.get("kind")   ?? undefined) as AnomalyKind | undefined,
      minDays: sp.has("minDays") ? parseInt(sp.get("minDays")!) : undefined,
      search:  sp.get("search")  ?? undefined,
    });
    return Response.json({ anomalies });
  } catch (err) {
    console.error("[/api/shop/anomalies]", err);
    const msg = err instanceof Error ? err.message : "Internal server error";
    return Response.json({ error: msg }, { status: 500 });
  }
}
