import { AuditRecord } from "../models/auditRecord";
import { UnifiedSecurityScore } from "../models/securityAssessment";

export interface AnalyticsSnapshot {
  totalScans: number;
  totalBlocked: number;
  totalWarned: number;
  tokenizedEvents: number;
  topLeakTypes: Array<{ key: string; count: number }>;
  topProviders: Array<{ provider: string; count: number }>;
  redTeamScore: number;
  mcpSecurityScore: number;
  llmSecurityScore: number;
  promptFirewallScore: number;
  responseFirewallScore: number;
  repositorySecurityScore: number;
  efficiencyScore: number;
  tokensBeforeTotal: number;
  tokensAfterTotal: number;
  tokensSavedTotal: number;
  estimatedCostSavingsUsd: number;
  unifiedSecurityScore: UnifiedSecurityScore;
  findingsTrend7: number[];
  findingsTrend30: number[];
  findingsTrend90: number[];
}

export class AnalyticsEngine {
  private static readonly DEFAULT_COST_PER_1K = 0.002;

  public build(records: AuditRecord[]): AnalyticsSnapshot {
    const leakTypeMap = new Map<string, number>();
    const providerMap = new Map<string, number>();

    let totalBlocked = 0;
    let totalWarned = 0;
    let tokenizedEvents = 0;

    const byDate = new Map<string, number>();

    for (const record of records) {
      if (record.action === "blocked") {
        totalBlocked += 1;
      }
      if (record.action === "warned") {
        totalWarned += 1;
      }
      if (record.action === "tokenized") {
        tokenizedEvents += 1;
      }

      providerMap.set(record.provider, (providerMap.get(record.provider) ?? 0) + 1);
      for (const finding of record.findings) {
        leakTypeMap.set(finding.type, (leakTypeMap.get(finding.type) ?? 0) + 1);
      }

      const date = record.time.slice(0, 10);
      byDate.set(date, (byDate.get(date) ?? 0) + Math.max(1, record.findings.length));
    }

    const redTeamScore = this.recentAssessmentScore(records, "AI_RED_TEAM");
    const mcpSecurityScore = this.recentAssessmentScore(records, "MCP_SCAN");
    const llmSecurityScore = this.recentAssessmentScore(records, "LLM_SECURITY_SCAN");
    const promptFirewallScore = this.baselineSafety(records, "PROMPT_FIREWALL", "input");
    const responseFirewallScore = this.baselineSafety(records, "RESPONSE_FIREWALL", "output");
    const repositorySecurityScore = this.baselineSafety(records, "REPOSITORY_SCAN", "repo");
    const optimization = this.optimizationSummary(records);

    const unifiedSecurityScore = this.unifiedScore({
      promptFirewallScore,
      responseFirewallScore,
      repositorySecurityScore,
      mcpSecurityScore,
      llmSecurityScore,
      redTeamScore,
      efficiencyScore: optimization.efficiencyScore
    });

    return {
      totalScans: records.length,
      totalBlocked,
      totalWarned,
      tokenizedEvents,
      topLeakTypes: [...leakTypeMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([key, count]) => ({ key, count })),
      topProviders: [...providerMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([provider, count]) => ({ provider, count })),
      redTeamScore,
      mcpSecurityScore,
      llmSecurityScore,
      promptFirewallScore,
      responseFirewallScore,
      repositorySecurityScore,
      efficiencyScore: optimization.efficiencyScore,
      tokensBeforeTotal: optimization.tokensBefore,
      tokensAfterTotal: optimization.tokensAfter,
      tokensSavedTotal: optimization.tokensSaved,
      estimatedCostSavingsUsd: optimization.estimatedCostSavingsUsd,
      unifiedSecurityScore,
      findingsTrend7: this.buildTrendArray(7, byDate),
      findingsTrend30: this.buildTrendArray(30, byDate),
      findingsTrend90: this.buildTrendArray(90, byDate)
    };
  }

  private recentAssessmentScore(records: AuditRecord[], type: "AI_RED_TEAM" | "MCP_SCAN" | "LLM_SECURITY_SCAN"): number {
    const match = records.find((record) => record.auditType === type && typeof record.score === "number");
    return match?.score ?? 100;
  }

  private baselineSafety(records: AuditRecord[], type: "PROMPT_FIREWALL" | "RESPONSE_FIREWALL" | "REPOSITORY_SCAN", direction: "input" | "output" | "repo"): number {
    const scoped = records.filter((record) => (record.auditType === type || record.direction === direction));
    if (!scoped.length) {
      return 100;
    }

    const penalty = scoped.reduce((sum, record) => {
      if (record.action === "blocked") {
        return sum + 10;
      }
      if (record.action === "warned") {
        return sum + 5;
      }
      return sum + Math.min(3, record.findings.length);
    }, 0);

    return Math.max(0, 100 - Math.round(penalty / Math.max(1, scoped.length / 2)));
  }

  private unifiedScore(input: Omit<UnifiedSecurityScore, "score" | "label">): UnifiedSecurityScore {
    const efficiencyScore = input.efficiencyScore ?? 100;
    const score = Math.round(
      (input.promptFirewallScore +
        input.responseFirewallScore +
        input.repositorySecurityScore +
        input.mcpSecurityScore +
        input.llmSecurityScore +
        input.redTeamScore +
        efficiencyScore) /
        7
    );

    return {
      ...input,
      efficiencyScore,
      score,
      label: score >= 90 ? "enterprise_ready" : score >= 70 ? "improving" : "high_risk"
    };
  }

  private optimizationSummary(records: AuditRecord[]): {
    tokensBefore: number;
    tokensAfter: number;
    tokensSaved: number;
    estimatedCostSavingsUsd: number;
    efficiencyScore: number;
  } {
    const optimizationRecords = records.filter(
      (record) => record.auditType === "CONTEXT_OPTIMIZED" || record.auditType === "TOKEN_ANALYSIS" || record.auditType === "RESPONSE_COMPRESSED"
    );

    let tokensBefore = 0;
    let tokensAfter = 0;
    let reductionSum = 0;
    let reductionCount = 0;

    for (const record of optimizationRecords) {
      const details = record.details ?? "";
      const before = this.extractMetric(details, "before");
      const after = this.extractMetric(details, "after");
      const reduction = this.extractMetric(details, "reduction");

      if (typeof before === "number" && typeof after === "number") {
        tokensBefore += before;
        tokensAfter += after;
      }

      if (typeof reduction === "number") {
        reductionSum += reduction;
        reductionCount += 1;
      }
    }

    const tokensSaved = Math.max(0, tokensBefore - tokensAfter);
    const averageReduction = reductionCount === 0 ? 0 : reductionSum / reductionCount;

    return {
      tokensBefore,
      tokensAfter,
      tokensSaved,
      estimatedCostSavingsUsd: Math.round(((tokensSaved / 1000) * AnalyticsEngine.DEFAULT_COST_PER_1K) * 100) / 100,
      efficiencyScore: Math.max(0, Math.min(100, Math.round(averageReduction)))
    };
  }

  private extractMetric(details: string, key: string): number | undefined {
    const match = details.match(new RegExp(`${key}=([0-9]+(?:\\.[0-9]+)?)`, "i"));
    if (!match) {
      return undefined;
    }

    const value = Number(match[1]);
    return Number.isFinite(value) ? value : undefined;
  }

  private buildTrendArray(days: number, byDate: Map<string, number>): number[] {
    const values: number[] = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const key = date.toISOString().slice(0, 10);
      values.push(byDate.get(key) ?? 0);
    }
    return values;
  }
}
