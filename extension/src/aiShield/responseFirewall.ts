import { AuditEngine } from "./auditEngine";
import { DetectionEngine } from "./detectionEngine";
import { PolicyManager } from "./policyManager";
import { RiskEngine } from "./riskEngine";
import { Detokenizer } from "./detokenizer";
import { Tokenizer } from "./tokenizer";
import { UserRole } from "../models/policy";

export interface ResponseInspectionResult {
  provider: string;
  originalResponse: string;
  safeResponse: string;
  action: "allow" | "warn" | "block";
  riskScore: number;
  riskLabel: "safe" | "low" | "medium" | "high" | "critical";
  findingsCount: number;
  details: string;
}

export class ResponseFirewall {
  private readonly detokenizer = new Detokenizer();

  public constructor(
    private readonly detectionEngine: DetectionEngine,
    private readonly riskEngine: RiskEngine,
    private readonly policyManager: PolicyManager,
    private readonly tokenizer: Tokenizer,
    private readonly auditEngine: AuditEngine,
    private readonly userName: string
  ) {}

  public async inspectResponse(response: string, provider: string, role: UserRole, sourceFile: string): Promise<ResponseInspectionResult> {
    const findings = this.detectionEngine.detect(response, sourceFile);
    const risk = this.riskEngine.score({ findings, textLength: response.length, policyWeight: 1.1 });
    const decision = this.policyManager.evaluate(role, findings.map((f) => f.kind), risk.score);

    let safeResponse = response;
    if (decision.action !== "block") {
      const restored = this.detokenizer.restore(response, this.tokenizer.getStoreSnapshot());
      safeResponse = restored.restoredText;
    }

    await this.auditEngine.record({
      time: new Date().toISOString(),
      user: this.userName,
      file: sourceFile,
      provider,
      direction: "output",
      auditType: "RESPONSE_FIREWALL",
      riskScore: risk.score,
      riskLabel: risk.label,
      findings,
      action: decision.action === "allow" ? "allowed" : decision.action === "warn" ? "warned" : "blocked",
      details: decision.reason
    });

    return {
      provider,
      originalResponse: response,
      safeResponse,
      action: decision.action,
      riskScore: risk.score,
      riskLabel: risk.label,
      findingsCount: findings.length,
      details: decision.reason
    };
  }
}
