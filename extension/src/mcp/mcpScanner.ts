import * as path from "path";
import { AuditEngine } from "../aiShield/auditEngine";
import { DetectionEngine } from "../aiShield/detectionEngine";
import { PolicyManager } from "../aiShield/policyManager";
import { RiskEngine } from "../aiShield/riskEngine";
import { UserRole } from "../models/policy";
import { AssessmentFinding, AssessmentRecommendation, SecurityAssessmentResult } from "../models/securityAssessment";
import { PermissionAnalyzer } from "./permissionAnalyzer";
import { ToolAnalyzer, McpToolDefinition } from "./toolAnalyzer";
import { TrustAnalyzer } from "./trustAnalyzer";

export interface McpScanInput {
  serverName: string;
  config: Record<string, unknown>;
  tools: McpToolDefinition[];
}

export class McpScanner {
  private readonly toolAnalyzer = new ToolAnalyzer();
  private readonly permissionAnalyzer = new PermissionAnalyzer();
  private readonly trustAnalyzer = new TrustAnalyzer();

  public constructor(
    private readonly detectionEngine: DetectionEngine,
    private readonly riskEngine: RiskEngine,
    private readonly policyManager: PolicyManager,
    private readonly auditEngine: AuditEngine,
    private readonly userName: string,
    private readonly workspacePath?: string
  ) {}

  public async scan(input: McpScanInput, _role: UserRole): Promise<SecurityAssessmentResult> {
    const startedAt = new Date().toISOString();

    const toolRisk = this.toolAnalyzer.analyze(input.tools);
    const permissionRisk = this.permissionAnalyzer.analyze(input.tools, input.config);
    const flattenedConfig = JSON.stringify(input, null, 2);
    const detectionFindings = this.detectionEngine.detect(flattenedConfig, "mcp://server");
    const leakageRisk = this.riskEngine.score({ findings: detectionFindings, textLength: flattenedConfig.length }).score;

    const remoteExecutionRisk = Math.min(100, toolRisk.riskyTools.filter((item) => item.reasons.some((reason) => reason.includes("Remote execution"))).length * 30);
    const filesystemRisk = Math.min(100, toolRisk.riskyTools.filter((item) => item.reasons.some((reason) => reason.includes("Filesystem"))).length * 25);
    const promptInjectionRisk = Math.min(100, toolRisk.riskyTools.filter((item) => /prompt|instruction|override/i.test(item.reasons.join(" "))).length * 20);

    const avgToolPenalty = toolRisk.riskyTools.length
      ? Math.round(toolRisk.riskyTools.reduce((sum, item) => sum + item.risk, 0) / toolRisk.riskyTools.length)
      : 0;

    const trust = this.trustAnalyzer.analyze({
      toolRiskScore: Math.max(0, 100 - avgToolPenalty),
      permissionScore: permissionRisk.score,
      promptInjectionRisk,
      dataLeakageRisk: leakageRisk,
      remoteExecutionRisk,
      filesystemRisk
    });

    const policy = this.policyManager.evaluate(
      _role,
      [...toolRisk.findings, ...permissionRisk.findings, ...detectionFindings].map((item) => item.kind),
      Math.max(0, 100 - trust.score)
    );

    const findings: AssessmentFinding[] = [
      {
        id: "mcp-prompt-injection",
        category: "prompt_injection_risk",
        name: "Prompt Injection Risk",
        severity: trust.promptInjectionRiskLabel === "High" ? "high" : trust.promptInjectionRiskLabel === "Medium" ? "medium" : "low",
        passed: trust.promptInjectionRiskLabel !== "High",
        score: Math.max(0, 100 - promptInjectionRisk),
        details: `Prompt Injection Risk: ${trust.promptInjectionRiskLabel}`,
        evidence: detectionFindings
      },
      {
        id: "mcp-data-leak",
        category: "data_leakage_risk",
        name: "Data Leakage Risk",
        severity: trust.dataLeakRiskLabel === "High" ? "high" : trust.dataLeakRiskLabel === "Medium" ? "medium" : "low",
        passed: trust.dataLeakRiskLabel !== "High",
        score: Math.max(0, 100 - leakageRisk),
        details: `Data Leak Risk: ${trust.dataLeakRiskLabel}`,
        evidence: detectionFindings
      },
      {
        id: "mcp-privilege",
        category: "privilege_risk",
        name: "Least Privilege Compliance",
        severity: trust.privilegeRiskLabel === "High" ? "critical" : trust.privilegeRiskLabel === "Medium" ? "high" : "low",
        passed: trust.privilegeRiskLabel !== "High",
        score: permissionRisk.score,
        details: `Privilege Risk: ${trust.privilegeRiskLabel}`,
        evidence: permissionRisk.findings
      },
      {
        id: "mcp-tool-trust",
        category: "tool_trust",
        name: "Tool Trust Score",
        severity: trust.score < 60 ? "critical" : trust.score < 75 ? "high" : trust.score < 90 ? "medium" : "low",
        passed: trust.score >= 75,
        score: trust.score,
        details: `Most risky tools: ${toolRisk.riskyTools.slice(0, 3).map((item) => item.tool).join(", ") || "none"}`,
        evidence: toolRisk.findings
      }
    ];

    const recommendations: AssessmentRecommendation[] = [
      ...permissionRisk.recommendations.map((item) => ({
        issue: "Permission and access controls",
        impact: "Over-privileged tools can leak data or execute unauthorized operations.",
        recommendation: item,
        severity: "high" as const
      })),
      {
        issue: "Tool input validation",
        impact: "Unsafe parameters can enable prompt injection and command misuse.",
        recommendation: "Enforce strict schema validation, deny dangerous arguments, and sanitize tool output.",
        severity: "high"
      }
    ];

    const categoryScores = [
      { category: "prompt_injection_risk", score: findings[0].score, passed: findings[0].passed ? 1 : 0, failed: findings[0].passed ? 0 : 1 },
      { category: "data_leakage_risk", score: findings[1].score, passed: findings[1].passed ? 1 : 0, failed: findings[1].passed ? 0 : 1 },
      { category: "privilege_risk", score: findings[2].score, passed: findings[2].passed ? 1 : 0, failed: findings[2].passed ? 0 : 1 },
      { category: "tool_trust", score: findings[3].score, passed: findings[3].passed ? 1 : 0, failed: findings[3].passed ? 0 : 1 }
    ];

    const baseScore = Math.round(categoryScores.reduce((sum, item) => sum + item.score, 0) / categoryScores.length);
    const score = Math.max(0, Math.min(100, baseScore - (policy.action === "block" ? 10 : policy.action === "warn" ? 5 : 0)));
    const passed = findings.filter((item) => item.passed).length;
    const failed = findings.length - passed;

    const result: SecurityAssessmentResult = {
      id: `mcp-${Date.now()}`,
      assessmentType: "MCP_SCAN",
      target: input.serverName,
      startedAt,
      completedAt: new Date().toISOString(),
      totalTests: findings.length,
      passed,
      failed,
      score,
      band: score >= 90 ? "excellent" : score >= 75 ? "good" : score >= 50 ? "moderate_risk" : "high_risk",
      categoryScores,
      findings,
      recommendations
    };

    await this.auditEngine.record({
      time: result.completedAt,
      user: this.userName,
      repository: this.workspacePath,
      file: path.join(this.workspacePath ?? ".", "mcp-scan"),
      provider: "mcp",
      direction: "assessment",
      auditType: "MCP_SCAN",
      riskScore: Math.max(0, 100 - score),
      riskLabel: score >= 90 ? "safe" : score >= 75 ? "low" : score >= 50 ? "medium" : "high",
      findings: [...toolRisk.findings, ...permissionRisk.findings, ...detectionFindings].slice(0, 60),
      action: failed > 0 ? "warned" : "allowed",
      score,
      recommendations: recommendations.map((item) => item.recommendation),
      details: `MCP scan completed for ${input.serverName}; riskyTools=${toolRisk.riskyTools.length}; policy=${policy.action}`
    });

    return result;
  }
}
