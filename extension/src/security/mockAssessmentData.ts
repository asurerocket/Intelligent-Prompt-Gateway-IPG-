import { AuditRecord } from "../models/auditRecord";

export function mockAssessmentRecords(user = "demo-user", repository = "demo-repo"): AuditRecord[] {
  const now = new Date();
  const at = (daysAgo: number): string => {
    const date = new Date(now);
    date.setDate(date.getDate() - daysAgo);
    return date.toISOString();
  };

  return [
    {
      id: "mock-red-team",
      time: at(1),
      user,
      repository,
      file: "ai-red-team",
      provider: "copilot",
      direction: "assessment",
      auditType: "AI_RED_TEAM",
      riskScore: 8,
      riskLabel: "low",
      findings: [],
      action: "allowed",
      score: 92,
      recommendations: ["Maintain prompt isolation boundaries."]
    },
    {
      id: "mock-mcp",
      time: at(2),
      user,
      repository,
      file: "mcp-scan",
      provider: "mcp",
      direction: "assessment",
      auditType: "MCP_SCAN",
      riskScore: 12,
      riskLabel: "low",
      findings: [],
      action: "warned",
      score: 88,
      recommendations: ["Remove unnecessary tool permissions.", "Enable response filtering."]
    },
    {
      id: "mock-llm",
      time: at(3),
      user,
      repository,
      file: "llm-security",
      provider: "gpt-5.3-codex",
      direction: "assessment",
      auditType: "LLM_SECURITY_SCAN",
      riskScore: 10,
      riskLabel: "low",
      findings: [],
      action: "allowed",
      score: 90,
      recommendations: ["Add benchmark regression checks to CI."]
    },
    {
      id: "mock-prompt",
      time: at(4),
      user,
      repository,
      file: "prompt.txt",
      provider: "copilot",
      direction: "input",
      auditType: "PROMPT_FIREWALL",
      riskScore: 35,
      riskLabel: "medium",
      findings: [],
      action: "tokenized",
      score: 80,
      recommendations: ["Continue tokenization for sensitive entities."]
    },
    {
      id: "mock-response",
      time: at(5),
      user,
      repository,
      file: "response.txt",
      provider: "copilot",
      direction: "output",
      auditType: "RESPONSE_FIREWALL",
      riskScore: 20,
      riskLabel: "low",
      findings: [],
      action: "warned",
      score: 84,
      recommendations: ["Tighten output filtering policy for internal data."]
    },
    {
      id: "mock-repo",
      time: at(6),
      user,
      repository,
      file: "repository-scan",
      provider: "git",
      direction: "repo",
      auditType: "REPOSITORY_SCAN",
      riskScore: 18,
      riskLabel: "low",
      findings: [],
      action: "allowed",
      score: 86,
      recommendations: ["Keep pre-commit secure scan enabled."]
    }
  ];
}
