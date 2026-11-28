// POST /api/gcode/assist
// Natural-language G-code assistant + one-click Fix with AI.
// Used inside GCodeMonacoEditor in both /studio and /playground.

import { NextRequest, NextResponse } from "next/server";
import { createLLMProvider } from "@/lib/providers/llm.provider";

export const runtime = "nodejs";
export const maxDuration = 60;

interface AssistRequest {
  mode: "fix" | "chat";
  message?: string;
  gcode: string;
  issues?: string[];
  machine?: string;
  tools?: string[];
  drawingContext?: string;
  history?: { role: "user" | "assistant"; content: string }[];
}

interface AssistResponse {
  explanation: string;
  suggestions: string[];
  gcode: string | null;
}

const SYSTEM_PROMPT = `You are a senior CNC / CAM programmer and G-code troubleshooter embedded inside a live 3D CNC simulator.

Your job:
1. Follow the provided drawing/part context, machine type, and tool list strictly.
2. If the machine is a CNC Lathe (or current code uses G18 / turning), write valid Fanuc Lathe G-code (G21 G18, G97/G96, X diameter, Z axis, T0101 style).
3. If the machine is a VMC / Mill (or current code uses G17), write valid Fanuc Mill G-code (G21 G17 G90, G43 H__, T__ M06, X/Y/Z).
4. If there are simulator errors, collisions, rapid-into-stock crashes, missing spindle/feed, or syntax warnings: diagnose the exact root cause and fix the G-code cleanly.
5. Always keep safe retracts (Z clearance or X clearance before rapid moves), spindle on (M03) before cutting, and program end (M05, M30, % wrappers).

Return ONLY a valid JSON object (no markdown fences, no extra text outside JSON) with this exact shape:
{
  "explanation": "Short, clear plain-English summary of what was fixed or generated (2-4 sentences).",
  "suggestions": ["Optional concise shop-floor tip or follow-up check (max 3 items)"],
  "gcode": "Complete updated Fanuc G-code program starting with % and ending with % (or null if user only asked a question and no code change is needed)"
}`;

function parseAssistJson(raw: string): AssistResponse {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    const parsed = JSON.parse(candidate) as Partial<AssistResponse>;
    return {
      explanation: typeof parsed.explanation === "string" ? parsed.explanation : "Updated G-code ready.",
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.map(String).slice(0, 4) : [],
      gcode: typeof parsed.gcode === "string" && parsed.gcode.trim() ? parsed.gcode.trim() : null,
    };
  } catch {
    // Fallback: extract G-code between % markers if model returned plain text
    const start = trimmed.indexOf("%");
    const end = trimmed.lastIndexOf("%");
    if (start !== -1 && end > start) {
      const code = trimmed.slice(start, end + 1).trim();
      const note = trimmed.slice(0, start).trim() || "Generated updated G-code.";
      return { explanation: note, suggestions: [], gcode: code };
    }
    return { explanation: trimmed || "No response from AI.", suggestions: [], gcode: null };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as AssistRequest;
    const mode = body.mode === "fix" ? "fix" : "chat";
    const gcode = body.gcode ?? "";
    const issues = Array.isArray(body.issues) ? body.issues.filter(Boolean) : [];

    const contextLines: string[] = [];
    if (body.machine) contextLines.push(`Machine: ${body.machine}`);
    if (body.tools?.length) contextLines.push(`Selected Tools: ${body.tools.join(", ")}`);
    if (body.drawingContext) contextLines.push(`Drawing / Stock Context:\n${body.drawingContext}`);
    if (issues.length) contextLines.push(`Active Simulator / Post Issues:\n- ${issues.join("\n- ")}`);

    const contextBlock = contextLines.length ? `${contextLines.join("\n\n")}\n\n` : "";

    const userPrompt =
      mode === "fix"
        ? `${contextBlock}Current G-code:\n\`\`\`\n${gcode || "(empty)"}\n\`\`\`\n\nTask: Analyze this G-code and any listed issues/warnings/collisions. Explain what is wrong and return a fixed, simulator-ready G-code program.`
        : `${contextBlock}Current G-code:\n\`\`\`\n${gcode || "(empty)"}\n\`\`\`\n\nUser request: ${body.message?.trim() || "Review and improve this G-code."}`;

    const historyMessages = (body.history ?? []).slice(-6).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const llm = createLLMProvider();
    const raw = await llm.chat({
      systemPrompt: SYSTEM_PROMPT,
      messages: [...historyMessages, { role: "user", content: userPrompt }],
    });

    const result = parseAssistJson(raw);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[/api/gcode/assist] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "AI assist failed" },
      { status: 500 }
    );
  }
}
