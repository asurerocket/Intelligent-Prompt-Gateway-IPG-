import * as vscode from "vscode";
import { MetricRecord } from "./types";

const STORAGE_KEY = "rocketToken.metrics";
const MAX_RECORDS = 500;

export class MetricsStore {
  private records: MetricRecord[] = [];

  public constructor(private readonly context: vscode.ExtensionContext) {
    this.records = this.context.globalState.get<MetricRecord[]>(STORAGE_KEY, []);
  }

  public add(record: MetricRecord): void {
    this.records.unshift(record);
    if (this.records.length > MAX_RECORDS) {
      this.records.length = MAX_RECORDS;
    }
    void this.context.globalState.update(STORAGE_KEY, this.records);
  }

  public getAll(): MetricRecord[] {
    return this.records;
  }

  public getSessionSummary(): {
    totalRequests: number;
    totalTokensBefore: number;
    totalTokensAfter: number;
    totalTokensSaved: number;
    avgReductionPercent: number;
    avgPreprocessLatencyMs: number;
    estimatedCostSavedUSD: number;
  } | null {
    const all = this.records;
    if (all.length === 0) {
      return null;
    }

    const totalBefore = all.reduce((sum, item) => sum + item.beforeTokens, 0);
    const totalAfter = all.reduce((sum, item) => sum + item.afterTokens, 0);
    const avgReduction = all.reduce((sum, item) => sum + item.reductionPercent, 0) / all.length;
    const avgLatency = all.reduce((sum, item) => sum + item.preprocessLatencyMs, 0) / all.length;
    const totalSaved = totalBefore - totalAfter;

    return {
      totalRequests: all.length,
      totalTokensBefore: totalBefore,
      totalTokensAfter: totalAfter,
      totalTokensSaved: totalSaved,
      avgReductionPercent: Math.round(avgReduction),
      avgPreprocessLatencyMs: Math.round(avgLatency),
      estimatedCostSavedUSD: (totalSaved / 1000) * 0.002
    };
  }

  public clear(): void {
    this.records = [];
    void this.context.globalState.update(STORAGE_KEY, []);
  }
}
