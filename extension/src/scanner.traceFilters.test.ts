import * as assert from "assert";
import { PolicyEngine } from "./policyEngine";
import { Scanner } from "./scanner";

suite("Scanner Trace False Positive Filters", () => {
  test("does not flag label-only invalid userid/password as sensitive", () => {
    const scanner = new Scanner(new PolicyEngine());
    const text = "(977) - Invalid Userid/Password:";

    const result = scanner.scanTextBlock(text, "trace.txt");

    assert.ok(!result.findings.some((f) => f.contextHint === "invalid-credentials"));
  });

  test("ignores UNKNOWN userid placeholder but keeps real userid", () => {
    const scanner = new Scanner(new PolicyEngine());
    const text = [
      "SDA0068T LOGON of USERID **UNKNOWN** failed.",
      "FIND  - URL(/HFS/PA6200BS.zws) Effective-Userid(SDBA) Authreq(NO) SSL(NO)"
    ].join("\n");

    const result = scanner.scanTextBlock(text, "trace.txt");
    const userIdHits = result.findings.filter((f) => f.contextHint === "userid");

    assert.strictEqual(userIdHits.length, 1);
  });

  test("does not duplicate LS-TOKEN as generic TOKEN context", () => {
    const scanner = new Scanner(new PolicyEngine());
    const text = "LS-TOKEN=X'7F3A09A0'";

    const result = scanner.scanTextBlock(text, "trace.txt");
    const tokenContextHits = result.findings.filter((f) => (f.contextHint ?? "").toLowerCase() === "token");
    const sessionTokenHits = result.findings.filter((f) => (f.contextHint ?? "") === "session-token");

    assert.strictEqual(tokenContextHits.length, 0);
    assert.strictEqual(sessionTokenHits.length, 1);
  });

  test("does not double-count manager ip as host-name and internal-host", () => {
    const scanner = new Scanner(new PolicyEngine());
    const text =
      "14.40.56.169673 INPUT_PARMS(MANAGER=127.0.0.1:4135 PROCESS=Bulk_RDRS2507_TMSTMP_TZ_TC001:Processing GROUP=QA_test PROCESS_DATA_FROM=ZOS-Agent-PBR PROCESS_STARTTIME=2026-08-26-14.40.48.493038 PM_I.INPUT_COMM_TOKEN=PID008984A0,)";

    const result = scanner.scanTextBlock(text, "trace.txt");
    const internalHostHits = result.findings.filter((f) => (f.contextHint ?? "") === "internal-host");
    const hostNameHits = result.findings.filter((f) => (f.contextHint ?? "") === "host-name");
    const inputTokenHits = result.findings.filter((f) => (f.contextHint ?? "").toLowerCase().includes("input_comm_token"));

    assert.strictEqual(internalHostHits.length, 1);
    assert.strictEqual(hostNameHits.length, 0);
    assert.strictEqual(inputTokenHits.length, 1);
    assert.strictEqual(result.findings.length, 2);
  });

  test("does not flag env reference as password value", () => {
    const scanner = new Scanner(new PolicyEngine());
    const text = "const PASSWORD = process.env.ROCKET_PASSWORD;";

    const result = scanner.scanTextBlock(text, "kb-export.js");
    const passwordRuleHits = result.findings.filter((f) => (f.ruleName ?? "") === "Password Label");
    const passwordContextHits = result.findings.filter((f) => (f.contextHint ?? "").toLowerCase() === "password");

    assert.strictEqual(passwordRuleHits.length, 0);
    assert.strictEqual(passwordContextHits.length, 0);
  });

  test("does not flag heap metrics as SSN or phone numbers in trace files", () => {
    const scanner = new Scanner(new PolicyEngine());
    const text = [
      "JDBC: Heap init:        532676608",
      "JDBC: Heap max.:        8501854208",
      "00000219B9539C4C   4BF1F2F3 F4F5F6F1 F2F360F0 F77AF0F0 *.123456123-07:00*"
    ].join("\n");

    const result = scanner.scanTextBlock(text, "sample-trace.txt");
    const ssnHits = result.findings.filter((f) => (f.ruleName ?? "") === "US Social Security Number");
    const usPhoneHits = result.findings.filter((f) => (f.ruleName ?? "") === "US Phone Number");
    const indiaPhoneHits = result.findings.filter((f) => (f.ruleName ?? "") === "India Phone Number");

    assert.strictEqual(ssnHits.length, 0);
    assert.strictEqual(usPhoneHits.length, 0);
    assert.strictEqual(indiaPhoneHits.length, 0);
  });
});
