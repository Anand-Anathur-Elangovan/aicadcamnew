/**
 * POST /api/gcode/certify  — log a DNC dry-run certification
 * GET  /api/gcode/certify?program=...  — fetch certifications for a program
 */
import { certifyRevision, listCertifications } from "@/lib/gcode/dnc";
import type { CertInput } from "@/lib/gcode/dnc";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const program = searchParams.get("program") ?? "";
  if (!program) return Response.json({ error: "Missing ?program=" }, { status: 400 });
  try {
    return Response.json(await listCertifications(program));
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CertInput;
    if (!body.program_name || !body.machine_id || !body.operator) {
      return Response.json({ error: "program_name, machine_id and operator are required" }, { status: 400 });
    }
    const cert = await certifyRevision(body);
    return Response.json(cert, { status: 201 });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
