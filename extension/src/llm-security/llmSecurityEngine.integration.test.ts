import * as assert from "assert";
import { AuditEngine } from "../aiShield/auditEngine";
import { DetectionEngine } from "../aiShield/detectionEngine";
import { PolicyManager } from "../aiShield/policyManager";
import { RiskEngine } from "../aiShield/riskEngine";
import { PolicyEngine } from "../policyEngine";
import { Scanner } from "../scanner";
import { LlmSecurityEngine } from "./llmSecurityEngine";

suite("LLM Security Engine Integration", () => {
  test("runs benchmark and computes score", async () => {
    const scanner = new Scanner(new PolicyEngine());
    const detection = new DetectionEngine(scanner);
    const risk = new RiskEngine();
    const policy = new PolicyManager();
    const audit = new AuditEngine();

    const engine = new LlmSecurityEngine(detection, risk, policy, audit, "tester");
    const result = await engine.assess("gpt-5.3-codex", "developer");

    assert.ok(result.totalTests >= 50);
    assert.ok(result.score >= 0 && result.score <= 100);
    assert.ok(result.categoryScores.length > 0);
  });
});
