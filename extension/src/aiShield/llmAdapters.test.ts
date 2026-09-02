import * as assert from "assert";
import { GenericLLMAdapter } from "./llmAdapters";

suite("LLM Adapter", () => {
  test("returns provider name", async () => {
    const adapter = new GenericLLMAdapter("copilot");
    assert.strictEqual(adapter.getProviderName(), "copilot");
    const prompt = await adapter.interceptPrompt("hello");
    assert.strictEqual(prompt.allowed, true);
  });
});
