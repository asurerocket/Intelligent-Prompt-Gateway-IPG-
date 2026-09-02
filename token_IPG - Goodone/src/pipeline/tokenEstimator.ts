// Approximates GPT-family tokenization: ~4 chars per token on average.
// Replace with a proper tiktoken WASM binding for production accuracy.
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function formatTokenCount(n: number): string {
  return n.toLocaleString();
}
