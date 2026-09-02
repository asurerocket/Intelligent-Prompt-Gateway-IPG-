import * as path from "path";

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

export interface IndexedFile {
  filePath: string;
  relativePath: string;
  content: string;
  imports: string[];
}

export interface RankedContextFile extends IndexedFile {
  score: number;
  reasons: string[];
}

export interface RankOptions {
  preferredPath?: string;
}

export class ContextRanker {
  public rank(query: string, files: IndexedFile[], limit = 8, options?: RankOptions): RankedContextFile[] {
    const keywords = this.keywords(query);
    const fileMap = new Map(files.map((f) => [f.relativePath.toLowerCase(), f]));
    const preferred = options?.preferredPath?.toLowerCase().replace(/\\/g, "/");

    const scored = files.map((file) => {
      const reasons: string[] = [];
      let score = 0;

      const lowerName = file.relativePath.toLowerCase();
      const lowerContent = file.content.toLowerCase();
      const contentLen = Math.max(1, file.content.length);

      const keywordHits = keywords.reduce((sum, kw) => sum + Math.min(18, this.occurrences(lowerContent, kw)), 0);
      const coverage = keywords.length
        ? keywords.reduce((sum, kw) => sum + (lowerContent.includes(kw) ? 1 : 0), 0) / keywords.length
        : 0;
      const density = Math.min(1, (keywordHits / contentLen) * 4200);
      score += Math.min(48, keywordHits * 2.6);
      score += Math.round(coverage * 24);
      score += Math.round(density * 22);
      if (keywordHits > 0) {
        reasons.push(`keyword_hits:${keywordHits}`);
        reasons.push(`keyword_coverage:${Math.round(coverage * 100)}%`);
      }

      const nameHits = keywords.reduce((sum, kw) => sum + (lowerName.includes(kw) ? 1 : 0), 0);
      score += nameHits * 10;
      if (nameHits > 0) {
        reasons.push(`name_match:${nameHits}`);
      }

      const symbolBoost = this.symbolBoost(lowerContent);
      score += symbolBoost;
      if (symbolBoost > 0) {
        reasons.push(`symbol_density:${symbolBoost}`);
      }

      const dependencyBoost = file.imports.reduce((sum, imp) => {
        const normalized = this.normalizeImport(imp, path.dirname(file.relativePath));
        if (!normalized) {
          return sum;
        }
        return sum + (fileMap.has(normalized.toLowerCase()) ? 2 : 0);
      }, 0);

      score += Math.min(15, dependencyBoost);
      if (dependencyBoost > 0) {
        reasons.push(`dependency_graph:${Math.min(15, dependencyBoost)}`);
      }

      const sizePenalty = this.sizePenalty(lowerName, contentLen);
      score += sizePenalty;
      if (sizePenalty < 0) {
        reasons.push(`size_penalty:${sizePenalty}`);
      }

      const focusBoost = this.focusBoost(lowerName, preferred);
      score += focusBoost;
      if (focusBoost > 0) {
        reasons.push(`focus_boost:${focusBoost}`);
      }

      return { ...file, score, reasons };
    });

    return scored
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private keywords(query: string): string[] {
    return query
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter((part) => part.length >= 3 && !QUERY_STOPWORDS.has(part))
      .slice(0, 12);
  }

  private occurrences(content: string, keyword: string): number {
    if (!keyword) {
      return 0;
    }
    const parts = content.split(keyword);
    return Math.max(0, parts.length - 1);
  }

  private symbolBoost(content: string): number {
    let score = 0;
    score += (content.match(/\bclass\s+[A-Za-z0-9_]+/g) ?? []).length * 2;
    score += (content.match(/\binterface\s+[A-Za-z0-9_]+/g) ?? []).length * 2;
    score += (content.match(/\bfunction\s+[A-Za-z0-9_]+/g) ?? []).length * 2;
    score += (content.match(/\bconst\s+[A-Za-z0-9_]+\s*=\s*\(/g) ?? []).length;
    score += (content.match(/\b(export\s+)?default\b/g) ?? []).length;
    return Math.min(20, score);
  }

  private normalizeImport(specifier: string, relativeDir: string): string | undefined {
    if (!specifier.startsWith(".")) {
      return undefined;
    }

    const resolved = path
      .normalize(path.join(relativeDir, specifier))
      .replace(/\\/g, "/")
      .replace(/^(\.\/)+/, "");

    if (resolved.endsWith(".ts") || resolved.endsWith(".tsx") || resolved.endsWith(".js")) {
      return resolved;
    }

    return `${resolved}.ts`;
  }

  private sizePenalty(fileName: string, contentLen: number): number {
    const isGenericJs = /(^|\/)kb-|export|bundle|vendor/.test(fileName) && fileName.endsWith(".js");
    if (contentLen > 240_000) {
      return isGenericJs ? -26 : -16;
    }
    if (contentLen > 140_000) {
      return isGenericJs ? -16 : -9;
    }
    if (contentLen > 80_000) {
      return isGenericJs ? -10 : -5;
    }
    return 0;
  }

  private focusBoost(fileName: string, preferred?: string): number {
    if (!preferred) {
      return 0;
    }
    if (fileName === preferred) {
      return 28;
    }

    const fileDir = fileName.includes("/") ? fileName.slice(0, fileName.lastIndexOf("/")) : "";
    const preferredDir = preferred.includes("/") ? preferred.slice(0, preferred.lastIndexOf("/")) : "";
    if (fileDir && preferredDir && fileDir === preferredDir) {
      return 10;
    }

    return 0;
  }
}
