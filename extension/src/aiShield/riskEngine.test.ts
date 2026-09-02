import * as assert from "assert";
import { RiskEngine } from "./riskEngine";

suite("Risk Engine", () => {
  test("scores medium or higher for credential-heavy input", () => {
    const engine = new RiskEngine();
    const result = engine.score({
      textLength: 140,
      findings: [
        {
          id: "1",
          kind: "secret",
          type: "AWS",
          source: "regex",
          filePath: "x",
          startLine: 0,
          startChar: 0,
          endLine: 0,
          endChar: 10,
          valueHash: "h",
          preview: "AKIAxxxx",
          confidence: 0.95,
          severity: "critical",
          tags: []
        }
      ]
    });
    assert.ok(result.score >= 41);
  });
});
