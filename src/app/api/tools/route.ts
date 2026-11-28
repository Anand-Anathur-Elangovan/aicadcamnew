import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function sb() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

function cleanToolText(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/A\?°/g, "°")
    .replace(/A\?×/g, "×")
    .replace(/A\?\?/g, "–")
    .replace(/A\?/g, "Ø");
}

export async function GET() {
  const client = sb();
  const { data, error } = await client
    .from("tools")
    .select("*")
    .eq("active", true)
    .order("tool_no");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const cleaned = (data ?? []).map(t => ({
    ...t,
    description: cleanToolText(t.description),
  }));
  return NextResponse.json(cleaned);
}

export async function POST(req: NextRequest) {
  const client = sb();
  const body = await req.json();
  const { data, error } = await client.from("tools").insert(body).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}
