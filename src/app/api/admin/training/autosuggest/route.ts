/**
 * POST /api/admin/training/autosuggest
 * Uses the LLM to suggest a better answer for a bad/incomplete AI response.
 * Also returns a self-evaluation score (1-10) with reasoning.
 */
import { createLLMProvider } from "@/lib/providers/llm.provider";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      question: string;
      originalAnswer: string;
      context?: string;      // optional: document excerpts or shop rows
    };

    if (!body.question || !body.originalAnswer) {
      return Response.json({ error: "question and originalAnswer are required" }, { status: 400 });
    }

    const llm = createLLMProvider();

    // Run self-eval and suggestion in parallel
    const [evalRaw, suggestionRaw] = await Promise.all([
      // AI self-evaluation: score 1-10 with reasoning
      llm.chat({
        systemPrompt: `You are an expert evaluator of manufacturing AI assistant responses.
Score the AI answer on a scale of 1-10 for each dimension, then give an overall score.
Return ONLY valid JSON in this exact format:
{
  "overall": 7,
  "dimensions": {
    "accuracy": 8,
    "completeness": 6,
    "clarity": 7,
    "citations_used": 5,
    "hallucination_risk": 3
  },
  "issues": ["Missing tolerance value", "Did not cite the drawing"],
  "label": "incomplete",
  "reasoning": "The answer is mostly correct but misses the actual tolerance value from the drawing."
}
Label must be one of: perfect | good | incomplete | wrong_citation | hallucination | off_topic`,
        messages: [{
          role: "user",
          content: `Question: ${body.question}\n\nAI Answer: ${body.originalAnswer}${body.context ? `\n\nAvailable context:\n${body.context}` : ""}`,
        }],
      }),

      // Auto-suggest a better answer
      llm.chat({
        systemPrompt: `You are an expert Manufacturing AI assistant. Rewrite the given AI answer to be better: more accurate, complete, and properly citing sources as [1], [2] etc.
Be concise. Use technical language appropriate for a manufacturing engineer.
Return ONLY the improved answer text — no preamble, no "Here is a better answer:", just the answer itself.`,
        messages: [{
          role: "user",
          content: `Question: ${body.question}\n\nOriginal AI Answer (needs improvement):\n${body.originalAnswer}${body.context ? `\n\nAvailable context to use:\n${body.context}` : ""}`,
        }],
      }),
    ]);

    // Parse the eval JSON safely
    let evaluation: {
      overall: number;
      dimensions: Record<string, number>;
      issues: string[];
      label: string;
      reasoning: string;
    } | null = null;

    try {
      const jsonMatch = evalRaw.match(/\{[\s\S]*\}/);
      if (jsonMatch) evaluation = JSON.parse(jsonMatch[0]) as typeof evaluation;
    } catch {
      evaluation = null;
    }

    return Response.json({
      evaluation,
      suggestion: suggestionRaw.trim(),
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
