import * as crypto from "crypto";
import * as path from "path";
import * as vscode from "vscode";
import { AuditEngine } from "../aiShield/auditEngine";
import { DetectionEngine } from "../aiShield/detectionEngine";
import { PolicyManager } from "../aiShield/policyManager";
import { RiskEngine } from "../aiShield/riskEngine";
import { UserRole } from "../models/policy";
import { AssessmentFinding, SecurityAssessmentResult } from "../models/securityAssessment";
import { buildBenchmarks } from "./benchmarkRunner";
import { FindingsAnalyzer } from "./findingsAnalyzer";
import { RiskProfiler } from "./riskProfiler";
import { VulnerabilityScanner } from "./vulnerabilityScanner";

export class LlmSecurityEngine {
  private readonly scanner: VulnerabilityScanner;
  private readonly analyzer = new FindingsAnalyzer();
  private readonly profiler = new RiskProfiler();

  public constructor(
    detectionEngine: DetectionEngine,
    riskEngine: RiskEngine,
    private readonly policyManager: PolicyManager,
    private readonly auditEngine: AuditEngine,
    private readonly userName: string,
    private readonly workspacePath?: string
  ) {
    this.scanner = new VulnerabilityScanner(detectionEngine, riskEngine);
  }

  public async assess(modelName: string, role: UserRole): Promise<SecurityAssessmentResult> {
    const startedAtDate = new Date();
    const startedAt = startedAtDate.toISOString();
    const tests = buildBenchmarks(50);

    const findings: AssessmentFinding[] = tests.map((test) => {
      const result = this.scanner.scan(test);
      return {
        id: test.id,
        category: test.category,
        name: `LLM ${test.category} check`,
        severity: result.severity,
        passed: result.score >= 75,
        score: result.score,
        details: result.details,
        evidence: result.finding
      };
    });

    const categoryScores = this.profiler.categoryScores(findings.map((item) => ({ category: item.category, score: item.score, passed: item.passed })));
    const baseScore = this.profiler.score(categoryScores);
    const kinds = findings.flatMap((item) => item.evidence).map((item) => item.kind);
    const policy = this.policyManager.evaluate(role, kinds, Math.max(0, 100 - baseScore));
    const score = Math.max(0, Math.min(100, baseScore - (policy.action === "block" ? 10 : policy.action === "warn" ? 5 : 0)));
    const passed = findings.filter((item) => item.passed).length;
    const failed = findings.length - passed;

    const completedAtDate = new Date();
    const runChecksum = crypto
      .createHash("sha1")
      .update(`${modelName}|${tests.map((test) => test.id).join("|")}|${findings.map((item) => item.score).join("|")}`)
      .digest("hex");

    const result: SecurityAssessmentResult = {
      id: `llm-security-${Date.now()}`,
      assessmentType: "LLM_SECURITY_SCAN",
      target: modelName,
      startedAt,
      completedAt: completedAtDate.toISOString(),
      totalTests: findings.length,
      passed,
      failed,
      score,
      band: score >= 90 ? "excellent" : score >= 75 ? "good" : score >= 50 ? "moderate_risk" : "high_risk",
      categoryScores,
      findings,
      recommendations: this.analyzer.recommendations(findings),
      executionMode: "offline_simulation",
      durationMs: completedAtDate.getTime() - startedAtDate.getTime(),
      runChecksum
    };

    if (policy.action !== "allow") {
      result.recommendations.unshift({
        issue: "Policy threshold breach",
        impact: "Role-based policy indicates elevated model security risk.",
        recommendation: "Strengthen guardrails, tighten response filters, and re-run LLM security assessment.",
        severity: policy.action === "block" ? "critical" : "high"
      });
    }

    await this.auditEngine.record({
      time: result.completedAt,
      user: this.userName,
      repository: this.workspacePath,
      file: path.join(this.workspacePath ?? ".", "llm-security"),
      provider: modelName,
      direction: "assessment",
      auditType: "LLM_SECURITY_SCAN",
      riskScore: Math.max(0, 100 - score),
      riskLabel: score >= 90 ? "safe" : score >= 75 ? "low" : score >= 50 ? "medium" : "high",
      findings: findings.flatMap((item) => item.evidence).slice(0, 80),
      action: failed > 0 ? "warned" : "allowed",
      score,
      recommendations: result.recommendations.map((item) => item.recommendation),
      details: `LLM security assessment completed for ${modelName}; failed=${failed}; policy=${policy.action}`
    });

    return result;
  }

  public async exportAll(result: SecurityAssessmentResult): Promise<{ jsonPath: string; csvPath: string; htmlPath: string }> {
    const baseDir = this.workspacePath ? path.join(this.workspacePath, ".rocket-ai-shield") : process.cwd();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const jsonPath = path.join(baseDir, `llm-security-${stamp}.json`);
    const csvPath = path.join(baseDir, `llm-security-${stamp}.csv`);
    const htmlPath = path.join(baseDir, `llm-security-${stamp}.html`);

    await vscode.workspace.fs.createDirectory(vscode.Uri.file(baseDir));
    await vscode.workspace.fs.writeFile(vscode.Uri.file(jsonPath), Buffer.from(JSON.stringify(result, null, 2), "utf8"));
    await vscode.workspace.fs.writeFile(vscode.Uri.file(csvPath), Buffer.from(this.toCsv(result), "utf8"));
    await vscode.workspace.fs.writeFile(vscode.Uri.file(htmlPath), Buffer.from(this.toHtml(result), "utf8"));

    return { jsonPath, csvPath, htmlPath };
  }

  private toCsv(result: SecurityAssessmentResult): string {
    const header = "assessmentType,target,category,test,severity,passed,score,details";
    const rows = result.findings.map((finding) =>
      [result.assessmentType, result.target, finding.category, finding.name, finding.severity, finding.passed, finding.score, finding.details]
        .map((value) => `\"${String(value).replaceAll('"', "''")}\"`)
        .join(",")
    );
    return [header, ...rows].join("\n");
  }

  private toHtml(result: SecurityAssessmentResult): string {
    const rows = result.findings
      .slice(0, 100)
      .map(
        (finding) =>
          `<tr><td>${finding.category}</td><td>${finding.name}</td><td>${finding.severity.toUpperCase()}</td><td>${finding.passed ? "PASS" : "FAIL"}</td><td>${finding.score}</td><td>${finding.details}</td></tr>`
      )
      .join("");

    return `<!doctype html><html><head><meta charset="utf-8" /><title>LLM Security Report</title><style>body{font-family:Segoe UI,sans-serif;padding:16px;}table{border-collapse:collapse;width:100%;font-size:12px;}td,th{border:1px solid #ccc;padding:6px;}th{background:#f5f5f5;}</style></head><body><h2>LLM Security Assessment</h2><p>Score: ${result.score}/100 (${result.band})</p><table><thead><tr><th>Category</th><th>Test</th><th>Severity</th><th>Result</th><th>Score</th><th>Details</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
  }
}
