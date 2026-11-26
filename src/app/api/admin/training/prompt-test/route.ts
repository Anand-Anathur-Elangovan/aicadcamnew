/**
 * POST /api/admin/training/prompt-test
 * Tests a custom system prompt against a question, returns the AI answer.
 * Used by the Prompt Template Editor in the playground.
 */
import { createLLMProvider } from "@/lib/providers/llm.provider";
import { runRAGPipeline } from "@/lib/rag/pipeline";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      systemPrompt: string;
      question: string;
      useRag?: boolean;
    };

    if (!body.systemPrompt || !body.question) {
      return Response.json({ error: "systemPrompt and question are required" }, { status: 400 });
    }

    const llm = createLLMProvider();
    let contextBlock = "";
    let citations: unknown[] = [];

    if (body.useRag !== false) {
      const rag = await runRAGPipeline(body.question);
      contextBlock = rag.contextText
        ? `\n\n--- CONTEXT ---\n${rag.contextText}\n--- END CONTEXT ---`
        : "";
      citations = rag.citations;
    }

    const answer = await llm.chat({
      systemPrompt: body.systemPrompt + contextBlock,
      messages: [{ role: "user", content: body.question }],
    });

    return Response.json({ answer, citations });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
