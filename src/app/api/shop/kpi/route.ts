import { fetchKPI } from "@/lib/shop/kpi";

export const runtime = "nodejs";
// Revalidate every 5 minutes on Vercel edge cache (keeps costs low)
export const revalidate = 300;

export async function GET() {
  try {
    const kpi = await fetchKPI();
    return Response.json(kpi);
  } catch (err) {
    console.error("[/api/shop/kpi]", err);
    const msg = err instanceof Error ? err.message : "Internal server error";
    return Response.json({ error: msg }, { status: 500 });
  }
}
