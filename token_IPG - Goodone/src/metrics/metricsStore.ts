import * as vscode from "vscode";
import { MetricRecord } from "../pipeline/types";

const STORAGE_KEY = "rocketToken.metrics";
const MAX_RECORDS = 500;

export class MetricsStore {
  private records: MetricRecord[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {
    this.records = this.context.globalState.get<MetricRecord[]>(STORAGE_KEY, []);
  }

  add(record: MetricRecord): void {
    this.records.unshift(record);
    if (this.records.length > MAX_RECORDS) this.records.length = MAX_RECORDS;
    this.context.globalState.update(STORAGE_KEY, this.records);
  }

  getAll(): MetricRecord[] {
    return this.records;
  }

  getSessionSummary() {
    const all = this.records;
    if (all.length === 0) return null;

    const totalBefore = all.reduce((s, r) => s + r.beforeTokens, 0);
    const totalAfter = all.reduce((s, r) => s + r.afterTokens, 0);
    const avgReduction =
      all.reduce((s, r) => s + r.reductionPercent, 0) / all.length;
    const avgLatency =
      all.reduce((s, r) => s + r.preprocessLatencyMs, 0) / all.length;
    const totalSaved = totalBefore - totalAfter;

    return {
      totalRequests: all.length,
      totalTokensBefore: totalBefore,
      totalTokensAfter: totalAfter,
      totalTokensSaved: totalSaved,
      avgReductionPercent: Math.round(avgReduction),
      avgPreprocessLatencyMs: Math.round(avgLatency),
      // Rough cost estimate based on ~$0.002 / 1000 tokens
      estimatedCostSavedUSD: (totalSaved / 1000) * 0.002,
    };
  }

  clear(): void {
    this.records = [];
    this.context.globalState.update(STORAGE_KEY, []);
  }
}
