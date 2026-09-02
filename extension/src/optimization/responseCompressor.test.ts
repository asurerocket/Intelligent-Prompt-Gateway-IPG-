import * as assert from "assert";
import { ResponseCompressor } from "./responseCompressor";

suite("ResponseCompressor", () => {
  test("preserves code blocks while reducing filler", () => {
    const input = [
      "As an AI assistant, I can help.",
      "To summarize, here is the answer.",
      "Real explanation line.",
      "Real explanation line.",
      "```ts",
      "const value = 1;",
      "```"
    ].join("\n");

    const compressor = new ResponseCompressor();
    const result = compressor.compress(input);

    assert.ok(result.optimizedText.includes("```ts"));
    assert.ok(result.optimizedText.includes("const value = 1;"));
    assert.ok(!result.optimizedText.toLowerCase().includes("as an ai assistant"));
    assert.ok(result.reductionPercent > 0);
  });
});
