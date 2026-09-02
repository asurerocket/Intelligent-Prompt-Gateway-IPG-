import * as assert from "assert";
import { DetectionEngine } from "../aiShield/detectionEngine";
import { PolicyManager } from "../aiShield/policyManager";
import { RiskEngine } from "../aiShield/riskEngine";
import { AuditEngine } from "../aiShield/auditEngine";
import { PolicyEngine } from "../policyEngine";
import { Scanner } from "../scanner";
import { RedTeamEngine } from "./redTeamEngine";

suite("Red Team Engine Integration", () => {
  test("produces assessment result with score and findings", async () => {
    const scanner = new Scanner(new PolicyEngine());
    const detection = new DetectionEngine(scanner);
    const policy = new PolicyManager();
    const risk = new RiskEngine();
    const audit = new AuditEngine();

    const engine = new RedTeamEngine(detection, risk, policy, audit, "tester");
    const result = await engine.runAssessment("copilot", "developer");

    assert.ok(result.totalTests >= 100);
    assert.ok(result.score >= 0 && result.score <= 100);
    assert.ok(result.findings.length > 0);
  });
});
