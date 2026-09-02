import * as assert from "assert";
import * as crypto from "crypto";
import { Tokenizer } from "./tokenizer";
import { DetectionFinding } from "../models/finding";

suite("Tokenizer", () => {
  test("tokenizes direct secret pattern", () => {
    const tokenizer = new Tokenizer();
    const text = "Use key AKIAIOSFODNN7EXAMPLE for integration";
    const result = tokenizer.tokenize(text, []);
    assert.ok(result.transformedText.includes("[SECRET_001]"));
    assert.strictEqual(result.entries.length, 1);
  });

  test("reuses same token for identical value within one tokenize call", () => {
    const tokenizer = new Tokenizer();
    const text = "Effective-Userid(SDBA) then Effective-Userid(SDBA)";

    const hash = crypto.createHash("sha256").update("SDBA").digest("hex");
    const findings: DetectionFinding[] = [
      {
        id: "f1",
        kind: "internal",
        type: "userid",
        source: "context",
        filePath: "sample.txt",
        startLine: 0,
        startChar: 17,
        endLine: 0,
        endChar: 21,
        valueHash: hash,
        preview: "SD***BA",
        confidence: 0.68,
        severity: "medium",
        tags: ["trace"]
      },
      {
        id: "f2",
        kind: "internal",
        type: "userid",
        source: "context",
        filePath: "sample.txt",
        startLine: 0,
        startChar: 45,
        endLine: 0,
        endChar: 49,
        valueHash: hash,
        preview: "SD***BA",
        confidence: 0.68,
        severity: "medium",
        tags: ["trace"]
      }
    ];

    const result = tokenizer.tokenize(text, findings);
    const tokenMatches = result.transformedText.match(/\[INTERNAL_\d{3}\]/g) ?? [];
    assert.strictEqual(tokenMatches.length, 2);
    assert.strictEqual(tokenMatches[0], tokenMatches[1]);
    assert.strictEqual(result.entries.length, 1);
  });
});
