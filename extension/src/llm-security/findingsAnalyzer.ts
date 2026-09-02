import { AssessmentFinding, AssessmentRecommendation } from "../models/securityAssessment";

export class FindingsAnalyzer {
  public recommendations(findings: AssessmentFinding[]): AssessmentRecommendation[] {
    return findings
      .filter((finding) => !finding.passed)
      .slice(0, 10)
      .map((finding) => ({
        issue: this.issue(finding.category),
        impact: this.impact(finding.category),
        recommendation: this.recommendation(finding.category),
        severity: finding.severity
      }));
  }

  private issue(category: string): string {
    switch (category) {
      case "prompt_injection":
        return "Prompt Injection Vulnerability";
      case "data_leakage_risk":
        return "Data Leakage Vulnerability";
      case "system_prompt_exposure":
        return "System Prompt Exposure";
      default:
        return "LLM Security Control Gap";
    }
  }

  private impact(category: string): string {
    if (["prompt_injection", "system_prompt_exposure", "prompt_revealing"].includes(category)) {
      return "Potential exposure of hidden instructions and policy bypass.";
    }
    if (["data_leakage_risk", "sensitive_info_generation", "compliance_violations"].includes(category)) {
      return "Potential leakage of regulated or proprietary data.";
    }
    return "Potential degradation of model safety and reliability.";
  }

  private recommendation(category: string): string {
    if (["prompt_injection", "jailbreak_resistance", "unsafe_instruction_following"].includes(category)) {
      return "Add input sanitization, instruction hierarchy enforcement, and policy-aware refusal constraints.";
    }
    if (["data_leakage_risk", "sensitive_info_generation", "compliance_violations"].includes(category)) {
      return "Apply output filtering, sensitive entity masking, and policy-bound response controls.";
    }
    if (["system_prompt_exposure", "prompt_revealing"].includes(category)) {
      return "Isolate system prompts, disable prompt reflection paths, and enforce strict disclosure blocks.";
    }
    return "Add domain-specific safety benchmarks and continuous regression validation.";
  }
}
