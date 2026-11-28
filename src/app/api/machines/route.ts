import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function sb() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/** Fix double-encoded UTF-8 bytes stored as latin-1 chars in Supabase.
 *  Ø  = U+00D8 → UTF-8 0xC3 0x98 → latin-1 read as Ã (195) + \x98 (152)
 *  –  = U+2013 → UTF-8 0xE2 0x80 0x93 → latin-1 â€"
 *  °  = U+00B0 → UTF-8 0xC2 0xB0 → latin-1 Â°
 *  ×  = U+00D7 → UTF-8 0xC3 0x97 → latin-1 Ã\x97
 */
function cleanText(s: string | null | undefined): string {
  if (!s) return "";
  // Re-encode latin-1 string back to UTF-8 bytes, then decode as UTF-8
  try {
    const bytes = Uint8Array.from(s, c => c.charCodeAt(0) & 0xff);
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return s;
  }
}

/** Map DNC machines row (name = shop code) to the Studio/Playground shape. */
function mapMachine(row: Record<string, unknown>) {
  // machine_id = shop code (e.g. "VMC-01"), stored in `name` column
  const machineId = row.name as string;
  const rawDisplay = (row.display_name as string | null) || machineId;
  const displayName = cleanText(rawDisplay);
  return {
    ...row,
    machine_id: machineId,
    name: displayName,
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
