import { AnalyticsSnapshot } from "../aiShield/analytics";
import { UnifiedSecurityScore } from "../models/securityAssessment";

export class UnifiedSecurityScoreCalculator {
  public fromSnapshot(snapshot: AnalyticsSnapshot): UnifiedSecurityScore {
    const efficiencyScore = snapshot.efficiencyScore ?? 100;
    const score = Math.round(
      (snapshot.promptFirewallScore +
        snapshot.responseFirewallScore +
        snapshot.repositorySecurityScore +
        snapshot.mcpSecurityScore +
        snapshot.llmSecurityScore +
        snapshot.redTeamScore +
        efficiencyScore) /
        7
    );

    return {
      promptFirewallScore: snapshot.promptFirewallScore,
      responseFirewallScore: snapshot.responseFirewallScore,
      repositorySecurityScore: snapshot.repositorySecurityScore,
      mcpSecurityScore: snapshot.mcpSecurityScore,
      llmSecurityScore: snapshot.llmSecurityScore,
      redTeamScore: snapshot.redTeamScore,
      efficiencyScore,
      score,
      label: score >= 90 ? "enterprise_ready" : score >= 70 ? "improving" : "high_risk"
    };
  }
}
