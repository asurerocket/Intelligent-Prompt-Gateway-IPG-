import { DetectionFinding } from "../models/finding";
import { RiskScoreResult } from "../models/riskScore";

export interface RiskInput {
  findings: DetectionFinding[];
  textLength: number;
  policyWeight?: number;
}

export class RiskEngine {
  public score(input: RiskInput): RiskScoreResult {
    if (!input.findings.length) {
      return { score: 0, label: "safe", factors: [] };
    }

    const avgConfidence = input.findings.reduce((sum, f) => sum + f.confidence, 0) / input.findings.length;
    const sensitivity = input.findings.filter((f) => f.kind === "secret" || f.kind === "credential" || f.kind === "pci").length;
    const pii = input.findings.filter((f) => f.kind === "pii" || f.kind === "hipaa").length;
    const agreement = this.uniqueSources(input.findings);
    const volumeScore = Math.min(1, input.textLength / 2500);
    const policyWeight = Math.max(0.5, Math.min(1.5, input.policyWeight ?? 1));

    const raw =
      avgConfidence * 38 +
      Math.min(1, sensitivity / 4) * 24 +
      Math.min(1, pii / 4) * 14 +
      agreement * 12 +
      volumeScore * 12;

    const score = Math.round(Math.min(100, raw * policyWeight));

    return {
      score,
      label: this.label(score),
      factors: [
        { name: "Detection confidence", contribution: Math.round(avgConfidence * 38) },
        { name: "Sensitive data count", contribution: Math.round(Math.min(1, sensitivity / 4) * 24) },
        { name: "PII or regulated data", contribution: Math.round(Math.min(1, pii / 4) * 14) },
        { name: "Detector agreement", contribution: Math.round(agreement * 12) },
        { name: "Data volume", contribution: Math.round(volumeScore * 12) }
      ]
    };
  }

  private uniqueSources(findings: DetectionFinding[]): number {
    const sources = new Set(findings.map((f) => f.source));
    return Math.min(1, sources.size / 5);
  }

  private label(score: number): "safe" | "low" | "medium" | "high" | "critical" {
    if (score <= 20) {
      return "safe";
    }
    if (score <= 40) {
      return "low";
    }
    if (score <= 60) {
      return "medium";
    }
    if (score <= 80) {
      return "high";
    }
    return "critical";
  }
}
