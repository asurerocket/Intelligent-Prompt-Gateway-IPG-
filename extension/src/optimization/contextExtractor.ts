import { RankedContextFile } from "./contextRanker";

const QUERY_STOPWORDS = new Set([
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "how",
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "show",
  "find",
  "please",
  "need",
  "file"
]);

export interface ExtractedContextChunk {
  file: string;
  snippet: string;
  score: number;
}

export class ContextExtractor {
  public extract(query: string, ranked: RankedContextFile[]): ExtractedContextChunk[] {
    const keywords = this.keywords(query);
    const forensicQuery = this.isForensicQuery(query);
    const maxLinesPerFile = forensicQuery ? 140 : 260;

    return ranked.map((item) => {
      const lines = item.content.split(/\r?\n/);
      const include = new Set<number>();

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const lower = line.toLowerCase();
        const structural = /\b(class|interface|function|export\s+(const|function|class)|async\s+function)\b/.test(lower);
        const keywordMatch = keywords.some((kw) => lower.includes(kw));
        const forensicSignal = this.looksForensicSignal(lower);
        const structuralNearKeyword = structural && this.hasKeywordNearby(lines, index, keywords);

        if (keywordMatch || forensicSignal || structuralNearKeyword) {
          const windowStart = forensicSignal ? -2 : -1;
          const windowEnd = forensicSignal ? 3 : 2;
          for (let offset = windowStart; offset <= windowEnd; offset += 1) {
            const candidate = index + offset;
            if (candidate >= 0 && candidate < lines.length) {
              include.add(candidate);
            }
          }
        }
      }

      let selected = [...include]
        .sort((a, b) => a - b)
        .map((lineNumber) => lines[lineNumber])
        .filter((line) => !this.isExcluded(line));

      // Fallback: preserve a small structural snippet for ranked files with no direct keyword match.
      if (selected.length === 0) {
        const structural = lines.filter((line) => /\b(export|class|interface|function|const|async\s+function)\b/i.test(line)).slice(0, 20);
        if (structural.length > 0) {
          selected = structural.filter((line) => !this.isExcluded(line));
        } else {
          selected = lines.filter((line) => line.trim().length > 0 && !this.isExcluded(line)).slice(0, 8);
        }
      }

      if (selected.length > maxLinesPerFile) {
        selected = selected.slice(0, maxLinesPerFile);
      }

      return {
        file: item.relativePath,
        snippet: selected.join("\n").trim(),
        score: item.score
      };
    });
  }

  private keywords(query: string): string[] {
    return query
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter((part) => part.length >= 3 && !QUERY_STOPWORDS.has(part));
  }

  private isForensicQuery(query: string): boolean {
    const normalized = query.toLowerCase();
    return /(error|exception|return\s+code|return\s+message|payload|trace|stack|failed|failure|root\s+cause)/.test(normalized);
  }

  private looksForensicSignal(line: string): boolean {
    return /(error|exception|fail|failed|stack|trace|payload|return\s+code|return\s+message|rc\s*[=:]|status\s*[=:])/i.test(line);
  }

  private hasKeywordNearby(lines: string[], index: number, keywords: string[]): boolean {
    if (!keywords.length) {
      return false;
    }

    const start = Math.max(0, index - 8);
    const end = Math.min(lines.length - 1, index + 8);
    for (let candidate = start; candidate <= end; candidate += 1) {
      const lower = lines[candidate].toLowerCase();
      if (keywords.some((kw) => lower.includes(kw))) {
        return true;
      }
    }

    return false;
  }

  private isExcluded(line: string): boolean {
    const lower = line.toLowerCase();
    if (!lower.trim()) {
      return false;
    }
    if (lower.includes("node_modules") || lower.includes("vendor") || lower.includes("generated")) {
      return true;
    }
    if (lower.length > 400 && /[A-Za-z0-9+/=]{120,}/.test(lower)) {
      return true;
    }
    return false;
  }
}
