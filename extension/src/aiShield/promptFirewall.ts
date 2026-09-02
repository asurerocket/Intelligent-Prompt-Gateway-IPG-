import { AuditEngine } from "./auditEngine";
import { RuleBasedLocalClassifier } from "./classifier";
import { DetectionEngine } from "./detectionEngine";
import { PolicyManager } from "./policyManager";
import { RiskEngine } from "./riskEngine";
import { Tokenizer } from "./tokenizer";
import { UserRole } from "../models/policy";

export interface PromptInspectionResult {
  provider: string;
  originalPrompt: string;
  safePrompt: string;
  action: "allow" | "warn" | "block";
  riskScore: number;
  riskLabel: "safe" | "low" | "medium" | "high" | "critical";
  findingsCount: number;
  details: string;
}

export class PromptFirewall {
  private readonly classifier = new RuleBasedLocalClassifier();

  public constructor(
    private readonly detectionEngine: DetectionEngine,
    private readonly riskEngine: RiskEngine,
    private readonly policyManager: PolicyManager,
    private readonly tokenizer: Tokenizer,
    private readonly auditEngine: AuditEngine,
    private readonly userName: string
  ) {}

  public async inspectPrompt(prompt: string, provider: string, role: UserRole, sourceFile: string): Promise<PromptInspectionResult> {
    const findings = this.detectionEngine.detect(prompt, sourceFile);
    const classification = this.classifier.classify(prompt, findings);

    const risk = this.riskEngine.score({
      findings,
      textLength: prompt.length,
      policyWeight: classification.kind === "credentials" ? 1.35 : 1
    });

    const decision = this.policyManager.evaluate(role, findings.map((f) => f.kind), risk.score);

    let safePrompt = prompt;
    let action: "allow" | "warn" | "block" = decision.action;

    if (decision.action !== "allow" && findings.length) {
      const tokenized = this.tokenizer.tokenize(prompt, findings);
      safePrompt = tokenized.transformedText;
      action = decision.action;
    }

    await this.auditEngine.record({
      time: new Date().toISOString(),
      user: this.userName,
      file: sourceFile,
      provider,
      direction: "input",
      auditType: "PROMPT_FIREWALL",
      riskScore: risk.score,
      riskLabel: risk.label,
      findings,
      action:
        decision.action === "allow"
          ? "allowed"
          : safePrompt !== prompt
            ? "tokenized"
            : decision.action === "warn"
              ? "warned"
              : "blocked",
      details: `${decision.reason}; classification=${classification.kind}:${classification.confidence.toFixed(2)}`
    });

    return {
      provider,
      originalPrompt: prompt,
      safePrompt,
      action,
      riskScore: risk.score,
      riskLabel: risk.label,
      findingsCount: findings.length,
      details: decision.reason
    };
  }
}
