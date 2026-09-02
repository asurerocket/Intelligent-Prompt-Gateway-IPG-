export interface TrustInput {
  toolRiskScore: number;
  permissionScore: number;
  promptInjectionRisk: number;
  dataLeakageRisk: number;
  remoteExecutionRisk: number;
  filesystemRisk: number;
}

export interface TrustOutput {
  score: number;
  promptInjectionRiskLabel: "Low" | "Medium" | "High";
  dataLeakRiskLabel: "Low" | "Medium" | "High";
  privilegeRiskLabel: "Low" | "Medium" | "High";
}

export class TrustAnalyzer {
  public analyze(input: TrustInput): TrustOutput {
    const score = Math.round(
      input.toolRiskScore * 0.25 +
        input.permissionScore * 0.3 +
        (100 - input.promptInjectionRisk) * 0.15 +
        (100 - input.dataLeakageRisk) * 0.15 +
        (100 - input.remoteExecutionRisk) * 0.1 +
        (100 - input.filesystemRisk) * 0.05
    );

    return {
      score: Math.max(0, Math.min(100, score)),
      promptInjectionRiskLabel: this.label(input.promptInjectionRisk),
      dataLeakRiskLabel: this.label(input.dataLeakageRisk),
      privilegeRiskLabel: this.label(100 - input.permissionScore)
    };
  }

  private label(risk: number): "Low" | "Medium" | "High" {
    if (risk >= 60) {
      return "High";
    }
    if (risk >= 30) {
      return "Medium";
    }
    return "Low";
  }
}
