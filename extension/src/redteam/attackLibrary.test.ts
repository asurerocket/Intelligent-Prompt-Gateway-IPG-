import * as assert from "assert";
import { buildAttackLibrary } from "./attackLibrary";

suite("Red Team Attack Library", () => {
  test("builds at least 100 templates", () => {
    const templates = buildAttackLibrary(100);
    assert.ok(templates.length >= 100);
  });

  test("includes required categories", () => {
    const templates = buildAttackLibrary(100);
    const categories = new Set(templates.map((item) => item.category));
    ["prompt_injection", "jailbreak", "exfiltration", "impersonation", "tool_abuse", "rag_attacks"].forEach((category) => {
      assert.ok(categories.has(category as never));
    });
  });
});
