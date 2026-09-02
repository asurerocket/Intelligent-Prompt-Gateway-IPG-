export interface TokenBreakdown {
  filesProcessed: number;
  originalTokens: number;
  optimizedTokens: number;
  savedTokens: number;
  reductionPercent: number;
}

export class TokenAnalyzer {
  // Practical approximation that works across providers without model-specific tokenizers.
  public estimateTokens(input: string): number {
    const normalized = input.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return 0;
    }
    return Math.max(1, Math.ceil(normalized.length / 4));
  }

  public summarize(original: string, optimized: string, filesProcessed: number): TokenBreakdown {
    const originalTokens = this.estimateTokens(original);
    const optimizedTokens = this.estimateTokens(optimized);
    const savedTokens = Math.max(0, originalTokens - optimizedTokens);
    const reductionPercent = originalTokens === 0 ? 0 : Math.round((savedTokens / originalTokens) * 1000) / 10;

    return {
      filesProcessed,
      originalTokens,
      optimizedTokens,
      savedTokens,
      reductionPercent
    };
  }
}
