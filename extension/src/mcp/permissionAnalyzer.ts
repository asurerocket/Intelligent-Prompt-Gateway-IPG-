import { DetectionFinding } from "../models/finding";
import { McpToolDefinition } from "./toolAnalyzer";

export interface PermissionAssessment {
  findings: DetectionFinding[];
  score: number;
  recommendations: string[];
}

export class PermissionAnalyzer {
  public analyze(tools: McpToolDefinition[], serverConfig: Record<string, unknown>): PermissionAssessment {
    const findings: DetectionFinding[] = [];
    const recommendations: string[] = [];
    let penalty = 0;

    const authMode = String(serverConfig.authMode ?? "none").toLowerCase();
    if (authMode === "none") {
      penalty += 30;
      recommendations.push("Enable strong authentication for MCP server access.");
    }

    const hasAuthorization = Boolean(serverConfig.authorizationEnabled);
    if (!hasAuthorization) {
      penalty += 20;
      recommendations.push("Enable authorization controls and role scoping for tool usage.");
    }

    tools.forEach((tool, index) => {
      if (!tool.authRequired) {
        penalty += 8;
        findings.push({
          id: `mcp-auth-${index}`,
          kind: "internal",
          type: "MCP Missing Tool Authentication",
          source: "heuristic",
          filePath: "mcp://permissions",
          startLine: 0,
          startChar: 0,
          endLine: 0,
          endChar: tool.name.length,
          valueHash: `${tool.name}-auth`,
          preview: tool.name,
          confidence: 0.78,
          severity: "high",
          tags: ["mcp", "authentication", "tool"]
        });
      }
      if ((tool.permissions ?? []).length > 4) {
        penalty += 6;
        findings.push({
          id: `mcp-priv-${index}`,
          kind: "internal",
          type: "MCP Over Privileged Tool",
          source: "heuristic",
          filePath: "mcp://permissions",
          startLine: 0,
          startChar: 0,
          endLine: 0,
          endChar: tool.name.length,
          valueHash: `${tool.name}-priv`,
          preview: tool.name,
          confidence: 0.73,
          severity: "medium",
          tags: ["mcp", "privilege", "least-privilege"]
        });
      }
    });

    const score = Math.max(0, 100 - penalty);
    if (score < 85) {
      recommendations.push("Reduce permission scopes and enforce least privilege for all MCP tools.");
    }

    return { findings, score, recommendations };
  }
}
