import * as assert from "assert";
import { TokenOptimizer } from "./tokenOptimizer";
import { TokenAnalyzer } from "./tokenAnalyzer";

suite("Optimization Pipeline Integration", () => {
  test("removes duplicates and reduces token estimate", () => {
    const input = [
      "import { A } from './a';",
      "import { A } from './a';",
      "// comment",
      "// comment",
      "function auth() { return true; }",
      "function auth() { return true; }"
    ].join("\n");

    const optimizer = new TokenOptimizer();
    const analyzer = new TokenAnalyzer();

    const optimized = optimizer.optimize(input);
    const stats = analyzer.summarize(input, optimized.optimizedText, 1);

    assert.ok(optimized.duplicateLinesRemoved >= 2);
    assert.ok(stats.originalTokens >= stats.optimizedTokens);
  });
});
