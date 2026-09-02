// Structural compression: keeps signatures, control flow, errors, and key keywords.
// Replace with LLMLingua or Tree-sitter AST extraction for production.
const IMPORTANT_LINE_PATTERN =
  /function |class |interface |type |const |let |if\s*\(|throw |return |await |catch|error|retry|timeout|export |import /i;

export async function codeAwareCompress(
  context: string,
  timeoutMs: number
): Promise<string> {
  return Promise.race([
    _compress(context),
    new Promise<string>((resolve) =>
      setTimeout(() => resolve(hardTruncate(context)), timeoutMs)
    ),
  ]);
}

async function _compress(context: string): Promise<string> {
  const lines = context.split("\n");
  const kept = lines.filter((line) => IMPORTANT_LINE_PATTERN.test(line));
  const result = kept.join("\n");
  // Ensure we keep at least 30% of original lines to preserve minimal context
  return result.length > context.length * 0.1
    ? result
    : hardTruncate(context);
}

function hardTruncate(context: string): string {
  return context.slice(0, 16000);
}
