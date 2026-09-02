import * as assert from "assert";
import { AuditEngine } from "../aiShield/auditEngine";
import { DetectionEngine } from "../aiShield/detectionEngine";
import { PolicyManager } from "../aiShield/policyManager";
import { RiskEngine } from "../aiShield/riskEngine";
import { PolicyEngine } from "../policyEngine";
import { Scanner } from "../scanner";
import { McpScanner } from "./mcpScanner";

suite("MCP Scanner Integration", () => {
  test("scores MCP profile and emits recommendations", async () => {
    const scanner = new Scanner(new PolicyEngine());
    const detection = new DetectionEngine(scanner);
    const risk = new RiskEngine();
    const policy = new PolicyManager();
    const audit = new AuditEngine();

    const mcp = new McpScanner(detection, risk, policy, audit, "tester");
    const result = await mcp.scan(
      {
        serverName: "demo",
        config: { authMode: "none", authorizationEnabled: false },
        tools: [
          {
            name: "shell.exec",
            description: "Execute shell command",
            parameters: { command: "string" },
            permissions: ["all", "admin"],
            authRequired: false
          }
        ]
      },
      "developer"
    );

    assert.ok(result.score >= 0 && result.score <= 100);
    assert.ok(result.recommendations.length > 0);
  });
});
