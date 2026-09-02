import { AuditEngine } from "../aiShield/auditEngine";
import { DetectionEngine } from "../aiShield/detectionEngine";
import { PolicyManager } from "../aiShield/policyManager";
import { RiskEngine } from "../aiShield/riskEngine";
import { UserRole } from "../models/policy";
import { AssessmentFinding, AssessmentRecommendation, SecurityAssessmentResult } from "../models/securityAssessment";
import { buildAttackLibrary, RedTeamCategory } from "./attackLibrary";
import { RedTeamEvaluator } from "./evaluator";
import { aggregateCategoryScores, overallScore, toBand } from "./securityScore";

export class RedTeamEngine {
  private readonly evaluator = new RedTeamEvaluator();

  public constructor(
    private readonly detectionEngine: DetectionEngine,
    private readonly riskEngine: RiskEngine,
    private readonly policyManager: PolicyManager,
    private readonly auditEngine: AuditEngine,
    private readonly userName: string,
    private readonly workspacePath?: string
  ) {}

  public async runAssessment(provider: string, role: UserRole): Promise<SecurityAssessmentResult> {
    const startedAt = new Date().toISOString();
    const attacks = buildAttackLibrary(100);
    const buckets = new Map<RedTeamCategory, { scores: number[]; passed: number; failed: number }>();
    const findings: AssessmentFinding[] = [];

    for (const attack of attacks) {
      const detected = this.detectionEngine.detect(attack.prompt, `redteam:${attack.category}`);
      const risk = this.riskEngine.score({ findings: detected, textLength: attack.prompt.length, policyWeight: 1.2 });
      const policy = this.policyManager.evaluate(role, detected.map((item) => item.kind), risk.score);
      const verdict = this.evaluator.evaluate(attack, detected, risk.score, policy);

      const bucket = buckets.get(attack.category) ?? { scores: [], passed: 0, failed: 0 };
      bucket.scores.push(verdict.score);
      if (verdict.passed) {
        bucket.passed += 1;
      } else {
        bucket.failed += 1;
      }
      buckets.set(attack.category, bucket);

      findings.push({
        id: attack.id,
        category: attack.category,
        name: attack.name,
        severity: verdict.severity,
        passed: verdict.passed,
        score: verdict.score,
        details: verdict.details,
        evidence: detected
      });
    }

    const categoryScores = aggregateCategoryScores(
      [...buckets.entries()].map(([category, bucket]) => ({
        category,
        scores: bucket.scores,
        passed: bucket.passed,
        failed: bucket.failed
      }))
    );

    const score = overallScore(categoryScores);
    const passed = findings.filter((item) => item.passed).length;
    const failed = findings.length - passed;
    const result: SecurityAssessmentResult = {
      id: `redteam-${Date.now()}`,
      assessmentType: "AI_RED_TEAM",
      target: provider,
      startedAt,
      completedAt: new Date().toISOString(),
      totalTests: findings.length,
      passed,
      failed,
      score,
      band: toBand(score),
      categoryScores,
      findings,
      recommendations: this.recommendations(findings)
    };

    await this.auditEngine.record({
      time: result.completedAt,
      user: this.userName,
      repository: this.workspacePath,
      file: "ai-red-team",
      provider,
      direction: "assessment",
      auditType: "AI_RED_TEAM",
      riskScore: Math.max(0, 100 - result.score),
      riskLabel: result.score >= 90 ? "safe" : result.score >= 75 ? "low" : result.score >= 50 ? "medium" : "high",
      findings: findings.flatMap((item) => item.evidence).slice(0, 50),
      action: failed > 0 ? "warned" : "allowed",
      score: result.score,
      recommendations: result.recommendations.map((item) => item.recommendation),
      details: `AI red team assessment complete; tests=${result.totalTests}; failed=${failed}`
    });

    return result;
  }

  private recommendations(findings: AssessmentFinding[]): AssessmentRecommendation[] {
    const failed = findings.filter((item) => !item.passed).slice(0, 8);
    return failed.map((item) => ({
      issue: item.name,
      impact: "Potential compromise of model behavior or sensitive enterprise data.",
      recommendation: this.recommendationForCategory(item.category),
      severity: item.severity
    }));
  }

  private recommendationForCategory(category: string): string {
    if (category === "prompt_injection" || category === "jailbreak") {
      return "Add stronger input sanitization, strict instruction hierarchy, and prompt isolation boundaries.";
    }
    if (category === "exfiltration" || category === "rag_attacks") {
      return "Apply context segmentation, retrieval allowlists, and enforce output redaction before model response is returned.";
    }
    return "Constrain tool scopes with least privilege, validate tool arguments, and enforce policy checks before execution.";
  }
}
