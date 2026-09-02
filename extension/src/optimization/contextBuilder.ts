import { ContextExtractor } from "./contextExtractor";
import { ContextRanker, RankedContextFile } from "./contextRanker";
import { RepositoryIndexer } from "./repositoryIndexer";
import { TokenAnalyzer, TokenBreakdown } from "./tokenAnalyzer";
import { TokenOptimizer } from "./tokenOptimizer";

export interface SmartContextPack {
  query: string;
  filesConsidered: number;
  selectedFiles: string[];
  rawContext: string;
  optimizedContext: string;
  breakdown: TokenBreakdown;
  duplicateLinesRemoved: number;
}

export class ContextBuilder {
  private readonly repositoryIndexer = new RepositoryIndexer();
  private readonly contextRanker = new ContextRanker();
  private readonly contextExtractor = new ContextExtractor();
  private readonly tokenOptimizer = new TokenOptimizer();
  private readonly tokenAnalyzer = new TokenAnalyzer();

  public async build(
    workspacePath: string,
    query: string,
    preferredRelativePath?: string,
    scope: "workspace" | "activeFile" = "workspace"
  ): Promise<SmartContextPack> {
    const indexed = await this.repositoryIndexer.index(workspacePath);
    const ranked = this.contextRanker.rank(query, indexed, 12, { preferredPath: preferredRelativePath });
    const scopedRanked = this.applyScope(ranked, indexed, preferredRelativePath, scope);
    const extracted = this.contextExtractor.extract(query, scopedRanked).filter((chunk) => chunk.snippet.length > 0);
    const selectedSet = new Set(extracted.map((chunk) => chunk.file));

    const rawContext = extracted
      .map((chunk) => `### File: ${chunk.file} (relevance=${chunk.score})\n${chunk.snippet}`)
      .join("\n\n");

    const selectedBaselineContext = scopedRanked
      .filter((item) => selectedSet.has(item.relativePath))
      .map((item) => `### File: ${item.relativePath} (full_context_baseline)\n${item.content}`)
      .join("\n\n");

    const optimized = this.tokenOptimizer.optimize(rawContext);
    const baseline = selectedBaselineContext || rawContext;
    const breakdown = this.tokenAnalyzer.summarize(baseline, optimized.optimizedText, extracted.length);

    return {
      query,
      filesConsidered: indexed.length,
      selectedFiles: extracted.map((item) => item.file),
      rawContext,
      optimizedContext: optimized.optimizedText,
      breakdown,
      duplicateLinesRemoved: optimized.duplicateLinesRemoved
    };
  }

  private applyScope(
    ranked: RankedContextFile[],
    indexed: Array<{ relativePath: string; filePath: string; content: string; imports: string[] }>,
    preferredRelativePath: string | undefined,
    scope: "workspace" | "activeFile"
  ): RankedContextFile[] {
    if (scope !== "activeFile" || !preferredRelativePath) {
      return ranked;
    }

    const normalizedPreferred = preferredRelativePath.toLowerCase().replace(/\\/g, "/");
    const exactRanked = ranked.find((item) => item.relativePath.toLowerCase() === normalizedPreferred);
    if (exactRanked) {
      return [exactRanked];
    }

    const indexedMatch = indexed.find((item) => item.relativePath.toLowerCase() === normalizedPreferred);
    if (indexedMatch) {
      return [
        {
          ...indexedMatch,
          score: 100,
          reasons: ["active_file_scope"]
        }
      ];
    }

    return ranked;
  }
}
