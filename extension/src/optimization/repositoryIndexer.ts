import * as fs from "fs/promises";
import * as path from "path";
import { IndexedFile } from "./contextRanker";

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "out", ".next", "vendor", "coverage"]);
const ALLOWED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".yml", ".yaml", ".env", ".txt", ".log"]);

export class RepositoryIndexer {
  public async index(workspacePath: string, maxFiles = 220): Promise<IndexedFile[]> {
    const files = await this.walk(workspacePath, workspacePath);
    const selected = files.slice(0, maxFiles);

    const indexed: IndexedFile[] = [];
    for (const filePath of selected) {
      try {
        const raw = await fs.readFile(filePath, "utf8");
        const content = this.prepareContent(raw, filePath);
        if (content === undefined) {
          continue;
        }

        indexed.push({
          filePath,
          relativePath: path.relative(workspacePath, filePath).replace(/\\/g, "/"),
          content,
          imports: this.extractImports(content)
        });
      } catch {
        // Skip unreadable files.
      }
    }

    return indexed;
  }

  private async walk(root: string, current: string): Promise<string[]> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name.toLowerCase())) {
          continue;
        }
        files.push(...(await this.walk(root, absolute)));
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(extension)) {
        continue;
      }

      if (entry.name.endsWith(".min.js") || entry.name.endsWith(".min.css")) {
        continue;
      }

      files.push(absolute);
    }

    return files;
  }

  private isIgnoredContent(content: string, filePath: string): boolean {
    if (/[A-Za-z0-9+/=]{500,}/.test(content) && !this.isTraceLikeText(content, filePath) && !this.isPlainTextContextFile(filePath)) {
      return true;
    }

    if (filePath.toLowerCase().includes("generated")) {
      return true;
    }

    return false;
  }

  private prepareContent(content: string, filePath: string): string | undefined {
    if (this.isIgnoredContent(content, filePath)) {
      return undefined;
    }

    const lower = filePath.toLowerCase();
    if (content.length <= 250_000) {
      return content;
    }

    // Keep recent sections for large traces/logs since errors are usually near the end.
    if (this.isTraceLikeText(content, filePath)) {
      return content.slice(-180_000);
    }

    // For large source files, retain a bounded prefix to avoid skipping entirely.
    return content.slice(0, 180_000);
  }

  private isTraceLikeText(content: string, filePath: string): boolean {
    const lower = filePath.toLowerCase();
    const looksLikeTraceFile = lower.endsWith(".log") || lower.endsWith(".txt") || /trace|error|debug|stack/.test(lower);
    if (!looksLikeTraceFile) {
      return false;
    }

    const sample = content.slice(0, 10_000);
    const newlineCount = (sample.match(/\r?\n/g) ?? []).length;
    const jsonLike = /\{\s*"[^"]+"\s*:/.test(sample);
    return newlineCount >= 6 || jsonLike;
  }

  private isPlainTextContextFile(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return lower.endsWith(".txt") || lower.endsWith(".log") || lower.endsWith(".md");
  }

  private extractImports(content: string): string[] {
    const matches = content.match(/from\s+["']([^"']+)["']/g) ?? [];
    return matches
      .map((line) => {
        const match = line.match(/from\s+["']([^"']+)["']/);
        return match?.[1];
      })
      .filter((value): value is string => Boolean(value));
  }
}
