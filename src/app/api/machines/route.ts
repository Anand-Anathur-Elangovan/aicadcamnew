import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function sb() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/** Clean display_name — strip non-ASCII garbage from bad Unicode inserts */
function cleanText(s: string | null | undefined): string {
  if (!s) return "";
  // Replace common garbled sequences (e.g. A?12 → Ø12, A?? → –, A?° → °)
  return s
    .replace(/A\?\?/g, "–")
    .replace(/A\?12/g, "Ø12")
    .replace(/A\?6/g, "Ø6")
    .replace(/A\?20/g, "Ø20")
    .replace(/A\?10/g, "Ø10")
    .replace(/A\?8/g, "Ø8")
    .replace(/A\?28/g, "Ø28")
    .replace(/A\?25/g, "Ø25")
    .replace(/A\?°/g, "°")
    .replace(/A\?/g, "Ø");
}

/** Map DNC machines row (name = shop code) to the Studio/Playground shape. */
function mapMachine(row: Record<string, unknown>) {
  const displayName = cleanText((row.display_name as string) || (row.name as string));
  return {
    ...row,
    machine_id: row.name,                 // shop code e.g. "VMC-01"
    name: displayName,                    // human label
    display_name: displayName,
    active: row.is_active,
  };
}

export async function GET() {
  const client = sb();
  const { data, error } = await client
    .from("machines")
    .select("*, machine_tools(tool_id, pocket, tools(*))")
    .eq("is_active", true)
    .order("name");
  if (error) {
    // machine_tools join may fail if that table is not created yet
    const fallback = await client.from("machines").select("*").eq("is_active", true).order("name");
    if (fallback.error) return NextResponse.json({ error: fallback.error.message }, { status: 500 });
    return NextResponse.json((fallback.data ?? []).map(mapMachine));
  }
  return NextResponse.json((data ?? []).map(mapMachine));
}

export async function POST(req: NextRequest) {
  const client = sb();
  const body = await req.json() as Record<string, unknown>;
  const payload = {
    name: body.machine_id ?? body.name,
    display_name: body.name ?? body.display_name,
    kind: body.kind ?? "other",
    controller: body.controller ?? "fanuc",
    x_travel: body.x_travel ?? null,
    y_travel: body.y_travel ?? null,
    z_travel: body.z_travel ?? null,
    max_rpm: body.max_rpm ?? null,
    tool_capacity: body.tool_capacity ?? 24,
    notes: body.notes ?? null,
    host: body.host ?? "unassigned",
    is_active: true,
  };
  const { data, error } = await client.from("machines").insert(payload).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(mapMachine(data as Record<string, unknown>), { status: 201 });
}
