export function shannonEntropy(text: string): number {
  if (!text) {
    return 0;
  }

  const frequencies = new Map<string, number>();
  for (const char of text) {
    frequencies.set(char, (frequencies.get(char) ?? 0) + 1);
  }

  let entropy = 0;
  for (const count of frequencies.values()) {
    const probability = count / text.length;
    entropy -= probability * Math.log2(probability);
  }

  return entropy;
}

export interface EntropyHit {
  startChar: number;
  endChar: number;
  token: string;
  entropy: number;
  confidence: number;
}

export function detectHighEntropyTokens(
  lineText: string,
  threshold: number,
  minLength = 20
): EntropyHit[] {
  const hits: EntropyHit[] = [];
  const tokenPattern = /[A-Za-z0-9+/=_-]{20,}/g;

  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(lineText)) !== null) {
    const token = match[0];
    if (token.length < minLength) {
      continue;
    }

    const entropy = shannonEntropy(token);
    if (entropy < threshold) {
      continue;
    }

    const normalized = Math.min(1, entropy / 6.5);
    hits.push({
      startChar: match.index,
      endChar: match.index + token.length,
      token,
      entropy,
      confidence: Math.max(0.55, normalized)
    });
  }

  return hits;
}
