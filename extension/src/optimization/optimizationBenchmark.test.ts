import * as assert from "assert";
import { performance } from "perf_hooks";
import { TokenOptimizer } from "./tokenOptimizer";

suite("Optimization Benchmark", () => {
  test("optimizes large payload under practical latency", () => {
    const optimizer = new TokenOptimizer();
    const payload = Array.from({ length: 5000 }, (_, index) => `line ${index % 200} auth flow duplicate comment`).join("\n");

    const started = performance.now();
    const result = optimizer.optimize(payload);
    const elapsedMs = performance.now() - started;

    assert.ok(result.optimizedText.length > 0);
    assert.ok(elapsedMs < 2000, `Expected optimization under 2000ms, got ${elapsedMs}`);
  });
});
