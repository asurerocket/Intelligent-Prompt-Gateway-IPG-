import * as assert from "assert";
import { PolicyEngine } from "../policyEngine";
import { Scanner } from "../scanner";
import { DetectionEngine } from "./detectionEngine";

suite("Detection Coverage", () => {
  test("detects tokenized placeholders and India-specific sensitive formats", () => {
    const sample = [
      "Email: [PII_004]",
      "Phone: +91-[PII_003]",
      "National ID: 5225-86632-821",
      "Passport Number: P1234567",
      "Driver License: DL-09-2020-123456",
      "Bank Account Number: 1234567890123456",
      "IFSC Code: ABCD0001234",
      "Credit Card Number: 4111-1111-1111-1111",
      "[CREDENTIAL_001]",
      "[SECRET_001]",
      "IP Address: [INTERNAL_001]"
    ].join("\n");

    const engine = new DetectionEngine(new Scanner(new PolicyEngine()));
    const findings = engine.detect(sample, "sample.txt");

    assert.ok(findings.some((f) => f.type === "Tokenized PII Placeholder"));
    assert.ok(findings.some((f) => f.type === "Tokenized Credential Placeholder"));
    assert.ok(findings.some((f) => f.type === "Tokenized Secret Placeholder"));
    assert.ok(findings.some((f) => f.type === "Tokenized Internal Placeholder"));

    assert.ok(findings.some((f) => f.type === "India IFSC Code"));
    assert.ok(findings.some((f) => f.type === "India Passport Number"));
    assert.ok(findings.some((f) => f.type === "India Driver License"));
    assert.ok(findings.some((f) => f.type === "Labeled Bank Account Number"));
    assert.ok(findings.some((f) => f.type === "Credit Card Number With Separators"));

    const internalFindings = findings.filter((f) => f.type === "Tokenized Internal Placeholder");
    assert.ok(internalFindings.some((f) => f.kind === "internal"));
  });

  test("maps trace userid signal to internal kind for policy enforcement", () => {
    const sample = "0000016605 11:30:32 00186022 FIND  - URL(/HFS/PA6200BS.zws) Effective-Userid(SDBA) Authreq(NO) SSL(NO)";

    const engine = new DetectionEngine(new Scanner(new PolicyEngine()));
    const findings = engine.detect(sample, "sample-trace.txt");

    assert.ok(findings.some((f) => f.type === "userid" && f.kind === "internal"));
  });
});
