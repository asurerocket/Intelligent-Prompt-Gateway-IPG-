import { cleanupContext } from "./cleanupContext";
import { codeAwareCompress } from "./compressor";
import { selectRelevantContext } from "./contextRanker";
import { estimateTokens } from "./tokenEstimator";
import { OptimizeResult, OptimizerConfig, StageSaving } from "./types";

type QueryIntent = "code-bug" | "rc-correlation" | "broad" | "general";

function detectQueryIntent(query: string): QueryIntent {
  const q = query.toLowerCase();
  if (/bug\s*risk|minimal\s*patch|patch\s*diff|how\s+to\s+fix|fix\s+this|quick\s+fix|root\s*cause.*code|what.*wrong.*code|parse.*error.*code|test\s*case/i.test(q)) return "code-bug";
  if (/rc.*12|return\s*code.*fail|rc.*fail|sql.*succeed.*fail|process.*fail.*rc|why.*rc|correlat/i.test(q)) return "rc-correlation";
  if (/^(what does|explain|describe|how does|summarize|tell me about|what is the purpose|what are)/i.test(query.trim())) return "broad";
  return "general";
}

function buildHandoffPrompt(query: string, context: string, intent: QueryIntent): string {
  switch (intent) {
    case "code-bug":
      return (
        `Question:\n${query}\n\n` +
        `Respond with exactly three sections:\n` +
        `ROOT CAUSE: one sentence explaining the bug risk.\n` +
        `PATCH DIFF: minimal unified diff to fix it.\n` +
        `TEST CASE: one test case that would catch the bug.\n\n` +
        `Code context:\n${context}`
      );
    case "rc-correlation":
      return (
        `Question:\n${query}\n\n` +
        `Respond with exactly three sections:\n` +
        `PROBABLE CAUSE TREE: list each step that could lead to RC=12 while SQL succeeds.\n` +
        `CODE PATH: reference the relevant code block or function that triggers the failure.\n` +
        `VERIFICATION: two concrete steps to confirm the root cause.\n\n` +
        `Context:\n${context}`
      );
    default:
      return `Question:\n${query}\n\nContext:\n${context}`;
  }
}

export async function optimizeAndSend(
  query: string,
  rawContext: string,
  config: OptimizerConfig
): Promise<OptimizeResult> {
  const t0 = Date.now();
  const stagesUsed: string[] = [];
  const stageSavings: StageSaving[] = [];
  const intent = detectQueryIntent(query);

  // Raw token count before any processing
  const rawFileTokens = estimateTokens(query + "\n" + rawContext);
  let previousTokens = rawFileTokens;

  // Stage 1: Cleanup (always runs, very cheap)
  let working = cleanupContext(rawContext);
  stagesUsed.push("Cleanup");

  const afterCleanupTokens = estimateTokens(query + "\n" + working);
  stageSavings.push({
    key: "cleanup",
    label: "Cleanup",
    savedTokens: Math.max(0, previousTokens - afterCleanupTokens),
  });
  previousTokens = afterCleanupTokens;

  const beforeTokens = afterCleanupTokens;
  const budget = config.maxInputTokens;
  const focusThreshold = budget * (config.contextFocusThresholdPercent / 100);

  // Skip context focusing for broad or code-bug queries — stripping chunks hurts understanding.
  const isBroadQuery = intent === "broad" || intent === "code-bug";

  // Stage 2: Headroom gate — skip expensive stages if already under threshold
  stageSavings.push({
    key: "headroom",
    label: "Budget Gate",
    savedTokens: 0,
  });

  if (!isBroadQuery && beforeTokens > focusThreshold) {
    const preFocusTokens = estimateTokens(query + "\n" + working);
    working = await selectRelevantContext(query, working, config.contextFocusTimeoutMs);
    const postFocusTokens = estimateTokens(query + "\n" + working);
    stagesUsed.push("Context Focus");
    stageSavings.push({
      key: "focus",
      label: "Context Focus",
      savedTokens: Math.max(0, preFocusTokens - postFocusTokens),
    });
    previousTokens = postFocusTokens;
  } else {
    stageSavings.push({
      key: "focus",
      label: "Context Focus",
      savedTokens: 0,
    });
  }

  let midTokens = estimateTokens(query + "\n" + working);

  // Stage 3: Deep compression only when still over budget
  if (midTokens > budget && config.enableCompression) {
    const preCompressionTokens = estimateTokens(query + "\n" + working);
    working = await codeAwareCompress(working, config.compressionTimeoutMs);
    stagesUsed.push("Deep Compression");
    midTokens = estimateTokens(query + "\n" + working);
    stageSavings.push({
      key: "compression",
      label: "Deep Compression",
      savedTokens: Math.max(0, preCompressionTokens - midTokens),
    });
  } else {
    stageSavings.push({
      key: "compression",
      label: "Deep Compression",
      savedTokens: 0,
    });
  }

  const optimizedPrompt = buildHandoffPrompt(query, working, intent);

  // afterTokens is measured against the cleaned working context, not the full structured prompt,
  // so the reduction metric reflects content saved, not prompt-template overhead added.
  const afterTokens = estimateTokens(query + "\n" + working);
  const reductionPercent =
    beforeTokens > 0
      ? Math.round(((beforeTokens - afterTokens) / beforeTokens) * 100)
      : 0;

  return {
    optimizedPrompt,
    rawFileTokens,
    beforeTokens,
    afterTokens,
    reductionPercent,
    stagesUsed,
    preprocessLatencyMs: Date.now() - t0,
    stageSavings,
  };
}
