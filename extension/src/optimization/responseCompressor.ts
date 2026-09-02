export interface ResponseCompressionResult {
  originalText: string;
  optimizedText: string;
  reductionPercent: number;
}

export class ResponseCompressor {
  public compress(response: string): ResponseCompressionResult {
    const blocks = this.splitByCodeBlocks(response);
    const optimized = blocks
      .map((block) => (block.isCode ? block.text : this.compressNarrative(block.text)))
      .join("")
      .trim();

    const reductionPercent = this.percentReduction(response, optimized);

    return {
      originalText: response,
      optimizedText: optimized,
      reductionPercent
    };
  }

  private splitByCodeBlocks(text: string): Array<{ isCode: boolean; text: string }> {
    const parts: Array<{ isCode: boolean; text: string }> = [];
    const regex = /```[\s\S]*?```/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ isCode: false, text: text.slice(lastIndex, match.index) });
      }
      parts.push({ isCode: true, text: match[0] });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      parts.push({ isCode: false, text: text.slice(lastIndex) });
    }

    return parts;
  }

  private compressNarrative(input: string): string {
    const lines = input
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => !this.isFiller(line));

    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const line of lines) {
      const normalized = line.toLowerCase();
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      deduped.push(line);
    }

    return `${deduped.join("\n")}\n`;
  }

  private isFiller(line: string): boolean {
    const normalized = line.toLowerCase();
    return (
      normalized.startsWith("in conclusion") ||
      normalized.startsWith("to summarize") ||
      normalized.startsWith("as an ai") ||
      normalized === "thanks" ||
      normalized === "thank you"
    );
  }

  private percentReduction(original: string, optimized: string): number {
    if (!original.trim()) {
      return 0;
    }
    const delta = Math.max(0, original.length - optimized.length);
    return Math.round((delta / Math.max(1, original.length)) * 1000) / 10;
  }
}
