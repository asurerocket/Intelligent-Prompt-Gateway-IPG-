import { DetectionFinding } from "../models/finding";

export interface McpToolDefinition {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  permissions?: string[];
  authRequired?: boolean;
}

export interface ToolRiskResult {
  findings: DetectionFinding[];
  riskyTools: Array<{ tool: string; risk: number; reasons: string[] }>;
}

export class ToolAnalyzer {
  public analyze(tools: McpToolDefinition[]): ToolRiskResult {
    const findings: DetectionFinding[] = [];
    const riskyTools: Array<{ tool: string; risk: number; reasons: string[] }> = [];

    tools.forEach((tool, index) => {
      const reasons: string[] = [];
      let risk = 0;
      const descriptor = `${tool.name} ${tool.description ?? ""}`.toLowerCase();

      if (/(exec|shell|command|rm -rf|powershell|bash)/.test(descriptor)) {
        reasons.push("Remote execution capability");
        risk += 35;
      }
      if (/(read file|write file|filesystem|delete|chmod)/.test(descriptor)) {
        reasons.push("Filesystem abuse potential");
        risk += 25;
      }
      if (!tool.description || tool.description.length < 20) {
        reasons.push("Insufficient tool description security context");
        risk += 10;
      }
      if (Object.keys(tool.parameters ?? {}).length === 0) {
        reasons.push("Missing parameter schema");
        risk += 15;
      }
      if ((tool.permissions ?? []).some((permission) => /(admin|all|root|")/.test(permission.toLowerCase()))) {
        reasons.push("Over-privileged permission scope");
        risk += 20;
      }

      if (risk > 0) {
        riskyTools.push({ tool: tool.name, risk: Math.min(100, risk), reasons });
        findings.push({
          id: `mcp-tool-${index}`,
          kind: "dangerous_command",
          type: "MCP Tool Risk",
          source: "heuristic",
          filePath: "mcp://tool-definition",
          startLine: 0,
          startChar: 0,
          endLine: 0,
          endChar: tool.name.length,
          valueHash: `${index}-${tool.name}`,
          preview: tool.name,
          confidence: Math.min(1, risk / 100),
          severity: risk > 70 ? "critical" : risk > 50 ? "high" : "medium",
          tags: ["mcp", "tool", ...reasons]
        });
      }
    });

    return { findings, riskyTools };
  }
}
