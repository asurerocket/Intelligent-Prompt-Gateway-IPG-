export interface DuplicateRemovalResult {
  content: string;
  removedLines: number;
}

export class DuplicateRemover {
  public remove(text: string): DuplicateRemovalResult {
    const lines = text.split(/\r?\n/);
    const seen = new Set<string>();
    const output: string[] = [];
    let removedLines = 0;

    for (const line of lines) {
      const normalized = this.normalize(line);
      const dedupeCandidate = this.isDedupeCandidate(normalized);

      if (dedupeCandidate && normalized.length > 0) {
        if (seen.has(normalized)) {
          removedLines += 1;
          continue;
        }
        seen.add(normalized);
      }

      output.push(line);
    }

    return {
      content: output.join("\n"),
      removedLines
    };
  }

  private isDedupeCandidate(normalized: string): boolean {
    const looksOperationalTrace =
      /^<n>\s+<n>:<n>:<n>\s+<n>\s+/.test(normalized) ||
      /(raw\s+(read|write)\s+(started|executed|completed|failed)|setsocketoption\s+executed|accept\s+(started|executed)|close\s+(started|executed)|sql\s+describe\s+parameter|sql\s+reset\s+parameter|oarq\s+-\s+<id>\s+otma\s+)/.test(
        normalized
      );

    return (
      normalized.startsWith("import ") ||
      normalized.startsWith("//") ||
      normalized.startsWith("#") ||
      /^(debug|trace|info|warn|warning|error)\s*[:|-]/.test(normalized) ||
      looksOperationalTrace ||
      normalized.includes("authentication flow step") ||
      normalized.includes("return message") ||
      normalized.includes("return code")
    );
  }

  private normalize(line: string): string {
    return line
      .trim()
      .toLowerCase()
      .replace(/\b\d+\b/g, "<n>")
      .replace(/0x[0-9a-f]+/g, "<hex>")
      .replace(/[a-f0-9]{16,}/g, "<id>")
      .replace(/\s+/g, " ");
  }
}
