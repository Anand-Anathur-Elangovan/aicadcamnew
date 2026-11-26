/**
 * POST /api/admin/training/batch-eval
 * Runs a set of test questions through the RAG pipeline and AI,
 * returns pass/fail with score for each.
 */
import { createLLMProvider } from "@/lib/providers/llm.provider";
import { runRAGPipeline } from "@/lib/rag/pipeline";

export const runtime = "nodejs";
export const maxDuration = 60;

interface TestCase {
  question: string;
  expectedKeywords?: string[];   // must appear in answer
  expectedPartNumber?: string;   // must be cited
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { tests: TestCase[] };
    if (!Array.isArray(body.tests) || body.tests.length === 0) {
      return Response.json({ error: "tests array is required" }, { status: 400 });
    }
    if (body.tests.length > 30) {
      return Response.json({ error: "Max 30 test cases per batch" }, { status: 400 });
    }

    const llm = createLLMProvider();

    const results = await Promise.all(body.tests.map(async (tc) => {
      const start = Date.now();
      try {
        // 1. Retrieve context
        const rag = await runRAGPipeline(tc.question, {});

        // 2. Generate answer
        const answer = await llm.chat({
          systemPrompt: `You are a Manufacturing AI assistant. Answer using ONLY the context provided. Be concise.
${rag.contextText ? `Context:\n${rag.contextText}` : "No documents found."}`,
          messages: [{ role: "user", content: tc.question }],
        });

        // 3. Auto-score
        const latencyMs = Date.now() - start;
        const answerLower = answer.toLowerCase();

        const keywordHits = (tc.expectedKeywords ?? []).filter((kw) =>
          answerLower.includes(kw.toLowerCase())
        );
        const keywordScore = tc.expectedKeywords?.length
          ? keywordHits.length / tc.expectedKeywords.length
          : 1;

        const citedPartNumber = !tc.expectedPartNumber || rag.citations.some(
          (c) => c.partNumber?.toLowerCase().includes(tc.expectedPartNumber!.toLowerCase()) ||
                 c.documentName.toLowerCase().includes(tc.expectedPartNumber!.toLowerCase())
        );

        const hasAnswer = answer.trim().length > 20;
        const noRefusal = !/not in the records|no information|cannot find/i.test(answer);

        const score = Math.round(
          (keywordScore * 40 + (citedPartNumber ? 20 : 0) + (hasAnswer ? 20 : 0) + (noRefusal ? 20 : 0))
        );

        const pass = score >= 60;

        return {
          question: tc.question,
          answer: answer.slice(0, 500),
          score,
          pass,
          latencyMs,
          details: {
            keywordsFound: keywordHits,
            keywordsMissed: (tc.expectedKeywords ?? []).filter((kw) => !answerLower.includes(kw.toLowerCase())),
            citedExpectedPart: citedPartNumber,
            hasSubstantiveAnswer: hasAnswer,
            noRefusal,
            topRagScore: rag.topScore,
            citationsCount: rag.citations.length,
          },
        };
      } catch (err) {
        return {
          question: tc.question,
          answer: "",
          score: 0,
          pass: false,
          latencyMs: Date.now() - start,
          error: String(err),
          details: {},
        };
      }
    }));

    const passed = results.filter((r) => r.pass).length;
    const avgScore = Math.round(results.reduce((s, r) => s + r.score, 0) / results.length);
    const avgLatency = Math.round(results.reduce((s, r) => s + r.latencyMs, 0) / results.length);

    return Response.json({ results, summary: { total: results.length, passed, failed: results.length - passed, avgScore, avgLatency } });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
