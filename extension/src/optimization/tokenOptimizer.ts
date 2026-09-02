import { CompressionEngine } from "./compressionEngine";
import { DuplicateRemover } from "./duplicateRemover";

export interface TokenOptimizationResult {
  originalText: string;
  optimizedText: string;
  duplicateLinesRemoved: number;
}

export class TokenOptimizer {
  private readonly duplicateRemover = new DuplicateRemover();
  private readonly compressionEngine = new CompressionEngine();

  public optimize(text: string): TokenOptimizationResult {
    const deduped = this.duplicateRemover.remove(text);
    const compressed = this.compressionEngine.compress(deduped.content);

    return {
      originalText: text,
      optimizedText: compressed,
      duplicateLinesRemoved: deduped.removedLines
    };
  }
}
