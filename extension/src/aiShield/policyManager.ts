import * as path from "path";
import * as vscode from "vscode";
import { PolicyBundle, UserRole } from "../models/policy";

const DEFAULT_POLICY: PolicyBundle = {
  version: "1.0.0",
  activePolicyId: "developer-default",
  rules: [
    {
      id: "developer-default",
      name: "Developer",
      appliesToRoles: ["developer", "admin"],
      blockKinds: ["secret", "credential", "pci"],
      warnKinds: ["pii", "internal"],
      maxRiskScoreAllowed: 70
    },
    {
      id: "support-default",
      name: "Support",
      appliesToRoles: ["support"],
      blockKinds: ["credential", "secret", "pci"],
      warnKinds: ["pii", "internal"],
      maxRiskScoreAllowed: 60
    },
    {
      id: "hr-default",
      name: "HR",
      appliesToRoles: ["hr"],
      blockKinds: ["pii", "hipaa", "credential", "secret"],
      warnKinds: ["internal"],
      maxRiskScoreAllowed: 45
    },
    {
      id: "finance-default",
      name: "Finance",
      appliesToRoles: ["finance"],
      blockKinds: ["pci", "credential", "secret"],
      warnKinds: ["internal", "pii"],
      maxRiskScoreAllowed: 50
    }
  ]
};

export interface PolicyDecision {
  action: "allow" | "warn" | "block";
  reason: string;
  maxAllowedScore: number;
}

export class PolicyManager {
  private bundle: PolicyBundle = DEFAULT_POLICY;

  public async load(workspacePath?: string): Promise<void> {
    if (!workspacePath) {
      this.bundle = DEFAULT_POLICY;
      return;
    }

    const policyPath = path.join(workspacePath, "rocket-policy.json");
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(policyPath));
      const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as PolicyBundle;
      if (parsed?.rules?.length) {
        this.bundle = parsed;
      }
    } catch {
      this.bundle = DEFAULT_POLICY;
    }
  }

  public getBundle(): PolicyBundle {
    return this.bundle;
  }

  public evaluate(role: UserRole, kinds: string[], riskScore: number): PolicyDecision {
    const rule =
      this.bundle.rules.find((r) => r.id === this.bundle.activePolicyId && r.appliesToRoles.includes(role)) ??
      this.bundle.rules.find((r) => r.appliesToRoles.includes(role));

    if (!rule) {
      return { action: riskScore > 80 ? "block" : riskScore > 55 ? "warn" : "allow", reason: "Fallback policy", maxAllowedScore: 60 };
    }

    const hasBlockedKind = kinds.some((kind) => rule.blockKinds.includes(kind as never));
    if (hasBlockedKind || riskScore > Math.max(rule.maxRiskScoreAllowed, 80)) {
      return { action: "block", reason: `Policy ${rule.name} blocked data type`, maxAllowedScore: rule.maxRiskScoreAllowed };
    }

    const hasWarnKind = kinds.some((kind) => rule.warnKinds.includes(kind as never));
    if (hasWarnKind || riskScore > rule.maxRiskScoreAllowed) {
      return { action: "warn", reason: `Policy ${rule.name} warning threshold reached`, maxAllowedScore: rule.maxRiskScoreAllowed };
    }

    return { action: "allow", reason: `Policy ${rule.name} allows content`, maxAllowedScore: rule.maxRiskScoreAllowed };
  }

  public async exportPolicy(targetPath: string): Promise<void> {
    await vscode.workspace.fs.writeFile(vscode.Uri.file(targetPath), Buffer.from(JSON.stringify(this.bundle, null, 2), "utf8"));
  }

  public async importPolicy(sourcePath: string): Promise<void> {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(sourcePath));
    const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as PolicyBundle;
    if (!parsed.rules?.length) {
      throw new Error("Invalid policy file");
    }
    this.bundle = parsed;
  }
}
