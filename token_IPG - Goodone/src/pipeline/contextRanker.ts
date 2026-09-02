const MAX_CHUNKS_TO_KEEP = 8;
const CHUNK_SEPARATOR = "\n\n";
const FORENSIC_CHUNKS_TO_KEEP = 14;

// Common log/trace terms that appear on nearly every line — excluded from relevance scoring
const LOG_NOISE_WORDS = new Set([
  "rc", "sql", "postgresql", "sqlprepare", "sqlexecute", "manager", "mngr",
  "storage", "dump", "length", "codepoint", "response", "received", "send",
  "readfrommanager", "field", "type", "data", "from", "where", "select",
  "and", "the", "for", "with", "at", "in", "of", "to", "is", "are",
]);

// Keyword frequency score with phrase-match boosting
function scoreChunk(queryWords: string[], chunk: string, queryPhrase: string): number {
  const lower = chunk.toLowerCase();
  // Boost chunks with exact phrase match 3x
  const hasPhrase = queryPhrase && queryPhrase.length > 0 && lower.includes(queryPhrase) ? 3 : 1;
  const wordMatches = queryWords.reduce((s, w) => s + (lower.includes(w) ? 1 : 0), 0);
  return wordMatches * hasPhrase;
}

function isForensicQuery(queryLower: string): boolean {
  if (/\b(fail|failed|failing|error|exception|abend|root cause|return code|rc)\b/i.test(queryLower)) {
    return true;
  }
  return [
    "which point", "where fail", "where failed", "process failing",
    "failure point", "why failed", "error cause", "failing from",
  ].some((p) => queryLower.includes(p));
}

function scoreForensicEvidence(chunkLower: string): number {
  let score = 0;
  if (/return\s*code|\bRC\b|return\s*message/i.test(chunkLower)) score += 4;
  if (/error|exception|abend|fail|rollback|sqlstate|datetime|timestamp/i.test(chunkLower)) score += 5;
  if (chunkLower.includes("dump_ascii:")) score += 6;
  if (/\d{4}-\d{2}-\d{2}[ t]\d{2}:\d{1,2}(?::\d{1,2})?/i.test(chunkLower)) score += 2;
  return score;
}

export async function selectRelevantContext(
  query: string,
  context: string,
  timeoutMs: number
): Promise<string> {
  return Promise.race([
    _rank(query, context),
    new Promise<string>((resolve) =>
      setTimeout(() => resolve(truncateFallback(context)), timeoutMs)
    ),
  ]);
}

async function _rank(query: string, context: string): Promise<string> {
  const queryLower = query.toLowerCase();
  const forensicMode = isForensicQuery(queryLower);
  const queryWords = queryLower
    .split(/\s+/)
    .filter(Boolean)
    .filter(w => !LOG_NOISE_WORDS.has(w) && w.length > 2);

  // Extract longest phrase for boosting (e.g., "return message" from "what is the return message")
  const phrases = ["return message", "return code", "error message", "time out", "failed", "duration", "processing"];
  const queryPhrase = phrases.find(p => queryLower.includes(p)) ?? "";

  // Support both \n\n chunks and single-line chunks
  const raw = context.split(CHUNK_SEPARATOR).filter((c) => c.trim());
  const chunks = raw.length < 3
    ? context.split("\n").filter((c) => c.trim())
    : raw;

  const scored = chunks
    .map((c, idx) => {
      const lower = c.toLowerCase();
      const base = scoreChunk(queryWords, c, queryPhrase);
      const forensicBoost = forensicMode ? scoreForensicEvidence(lower) : 0;
      return { c, idx, s: base + forensicBoost };
    })
    .sort((a, b) => b.s - a.s)
    .slice(0, forensicMode ? FORENSIC_CHUNKS_TO_KEEP : MAX_CHUNKS_TO_KEEP)
    .sort((a, b) => a.idx - b.idx)
    .map((x) => x.c);

  return scored.join(CHUNK_SEPARATOR);
}

function truncateFallback(context: string): string {
  // Keep the first half when context focusing times out.
  return context.slice(0, Math.floor(context.length / 2));
}
