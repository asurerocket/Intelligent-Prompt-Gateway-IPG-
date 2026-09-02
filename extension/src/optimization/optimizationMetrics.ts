import { TokenBreakdown } from "./tokenAnalyzer";

export interface OptimizationRunMetric extends TokenBreakdown {
  query: string;
  timestamp: string;
  largestFile?: string;
  baselineTokens?: number;
  copilotPayloadTokens?: number;
  copilotPayloadMode?: "full" | "compact";
  estimatedSavingsUsd?: number;
}

export interface OptimizationSummary {
  totalRuns: number;
  totalTokensProcessed: number;
  totalOptimizedTokens: number;
  totalSavedTokens: number;
  averageReduction: number;
  largestReduction: number;
  estimatedCostSavingsUsd: number;
  mostExpensivePromptTokens: number;
  efficiencyScore: number;
}

export class OptimizationMetricsStore {
  private readonly runs: OptimizationRunMetric[] = [];

  public add(metric: OptimizationRunMetric): void {
    this.runs.push(metric);
  }

  public clear(): void {
    this.runs.length = 0;
  }

  public recent(limit = 60): OptimizationRunMetric[] {
    return this.runs.slice(-limit).reverse();
  }

  public summary(costPer1kTokensUsd: number): OptimizationSummary {
    const totalRuns = this.runs.length;
    const totalTokensProcessed = this.runs.reduce((sum, run) => sum + run.originalTokens, 0);
    const totalOptimizedTokens = this.runs.reduce((sum, run) => sum + run.optimizedTokens, 0);
    const totalSavedTokens = Math.max(0, totalTokensProcessed - totalOptimizedTokens);
    const averageReduction = totalRuns === 0 ? 0 : this.round1(this.runs.reduce((sum, run) => sum + run.reductionPercent, 0) / totalRuns);
    const largestReduction = this.round1(this.runs.reduce((max, run) => Math.max(max, run.reductionPercent), 0));
    const estimatedCostSavingsUsd = this.round2((totalSavedTokens / 1000) * costPer1kTokensUsd);
    const mostExpensivePromptTokens = this.runs.reduce((max, run) => Math.max(max, run.originalTokens), 0);

    return {
      totalRuns,
      totalTokensProcessed,
      totalOptimizedTokens,
      totalSavedTokens,
      averageReduction,
      largestReduction,
      estimatedCostSavingsUsd,
      mostExpensivePromptTokens,
      efficiencyScore: this.calculateEfficiencyScore(averageReduction, largestReduction)
    };
  }

  private calculateEfficiencyScore(avgReduction: number, largestReduction: number): number {
    const base = Math.min(100, avgReduction);
    const burstBonus = Math.min(15, largestReduction / 8);
    return Math.min(100, Math.round(base * 0.85 + burstBonus * 0.15));
  }

  private round1(input: number): number {
    return Math.round(input * 10) / 10;
  }

  private round2(input: number): number {
    return Math.round(input * 100) / 100;
  }
}
