export const RECENT_TURN_LIMIT = 6;

export interface SessionEntities {
  partNumber: string;
  partName: string;
  routerNo: string;
  operatorName: string;
  machineName: string;
}

export function emptyEntities(): SessionEntities {
  return { partNumber: "", partName: "", routerNo: "", operatorName: "", machineName: "" };
}

export function recentTurns<T>(turns: T[], limit = RECENT_TURN_LIMIT): T[] {
  if (turns.length <= limit) return turns;
  return turns.slice(-limit);
}

export function readEntities(value: unknown): SessionEntities {
  const entities = emptyEntities();
  if (!value || typeof value !== "object") return entities;
  const row = value as Partial<SessionEntities>;
  for (const key of Object.keys(entities) as (keyof SessionEntities)[]) {
    if (typeof row[key] === "string") entities[key] = row[key];
  }
  return entities;
}

export function parseMemory(
  raw: string,
  previous: { summary: string; entities: SessionEntities }
): { summary: string; entities: SessionEntities } {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return previous;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      summary?: unknown;
      entities?: Partial<SessionEntities>;
    };
    const summary = typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : previous.summary;
    const entities = { ...previous.entities };
    for (const key of Object.keys(entities) as (keyof SessionEntities)[]) {
      const next = parsed.entities?.[key];
      if (typeof next === "string" && next.trim()) entities[key] = next.trim();
    }
    return { summary, entities };
  } catch {
    return previous;
  }
}

export function memoryContext(params: {
  summary: string;
  entities: SessionEntities;
  prior: { role: string; content: string }[];
}): string {
  const remembered = (Object.entries(params.entities) as [string, string][])
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ");
  const recent = recentTurns(params.prior)
    .map((turn) => `${turn.role}: ${turn.content}`)
    .join("\n");
  return `Summary of earlier turns:\n${params.summary || "(none)"}\n\nRemembered:\n${remembered || "(none)"}\n\nRecent turns:\n${recent || "(none)"}`;
}
