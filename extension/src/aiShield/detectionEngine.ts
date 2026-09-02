import * as crypto from "crypto";
import { Scanner } from "../scanner";
import { DetectionFinding } from "../models/finding";

export class DetectionEngine {
  public constructor(private readonly scanner: Scanner) {}

  public detect(text: string, sourcePath: string, lineOffset = 0): DetectionFinding[] {
    const base = this.scanner.scanTextBlock(text, sourcePath, lineOffset).findings;
    const findings: DetectionFinding[] = base.map((f) => ({
      id: f.id,
      kind: this.kindFromCategory(f.category),
      type: f.ruleName ?? f.contextHint ?? f.category ?? "unknown",
      source: f.sources[0] === "context" ? "context" : f.sources[0] === "entropy" ? "entropy" : "regex",
      filePath: f.filePath,
      startLine: f.startLine,
      startChar: f.startChar,
      endLine: f.endLine,
      endChar: f.endChar,
      valueHash: f.valueHash,
      preview: f.preview,
      confidence: f.score,
      severity: f.score > 0.85 ? "critical" : f.score > 0.7 ? "high" : f.score > 0.55 ? "medium" : "low",
      tags: [f.category ?? "unknown", ...(f.sources ?? [])]
    }));

    findings.push(...this.heuristicDetect(text, sourcePath));
    return this.dedupe(findings);
  }

  private heuristicDetect(text: string, sourcePath: string): DetectionFinding[] {
    const hits: DetectionFinding[] = [];

    const internalUrlPattern = /https?:\/\/(?:[a-z0-9-]+\.)*(?:corp|internal|local)\.[a-z]{2,}(?:\/[^\s]*)?/gi;
    for (const match of text.matchAll(internalUrlPattern)) {
      hits.push(this.makeHeuristicFinding(match[0], match.index ?? 0, "internal", "Internal URL", sourcePath, 0.72));
    }

    const internalIpPattern = /\b(?:10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.(?:\d{1,3})\.(?:\d{1,3})|172\.(?:1[6-9]|2\d|3[0-1])\.(?:\d{1,3})\.(?:\d{1,3}))\b/g;
    for (const match of text.matchAll(internalIpPattern)) {
      hits.push(this.makeHeuristicFinding(match[0], match.index ?? 0, "internal", "Internal IP", sourcePath, 0.7));
    }

    const sqlDumpPattern = /\bselect\s+\*\s+from\s+(customers|users|employees|patients)\b/gi;
    for (const match of text.matchAll(sqlDumpPattern)) {
      hits.push(this.makeHeuristicFinding(match[0], match.index ?? 0, "data_dump", "Sensitive SQL dump", sourcePath, 0.9));
    }

    const dangerousCommandPattern = /\b(rm\s+-rf\s+\/|drop\s+database\s+\w+|truncate\s+table\s+\w+)\b/gi;
    for (const match of text.matchAll(dangerousCommandPattern)) {
      hits.push(this.makeHeuristicFinding(match[0], match.index ?? 0, "dangerous_command", "Dangerous command", sourcePath, 0.92));
    }

    const promptInjectionPattern =
      /(ignore\s+(?:(?:all\s+)?(?:previous|prior)\s+)?instructions|instruction\s+override|bypass\s+(safety|policy))/gi;
    for (const match of text.matchAll(promptInjectionPattern)) {
      hits.push(this.makeHeuristicFinding(match[0], match.index ?? 0, "internal", "Prompt Injection Attempt", sourcePath, 0.9));
    }

    const systemPromptTheftPattern = /(reveal|print|show).{0,40}(system\s+prompt|hidden\s+prompt|hidden\s+instructions)/gi;
    for (const match of text.matchAll(systemPromptTheftPattern)) {
      hits.push(this.makeHeuristicFinding(match[0], match.index ?? 0, "internal", "System Prompt Extraction Attempt", sourcePath, 0.92));
    }

    return hits;
  }

  private makeHeuristicFinding(value: string, start: number, kind: DetectionFinding["kind"], type: string, filePath: string, confidence: number): DetectionFinding {
    const hash = crypto.createHash("sha256").update(value).digest("hex");
    return {
      id: `heuristic:${hash.slice(0, 12)}:${start}`,
      kind,
      type,
      source: "heuristic",
      filePath,
      startLine: 0,
      startChar: start,
      endLine: 0,
      endChar: start + value.length,
      valueHash: hash,
      preview: value,
      confidence,
      severity: confidence > 0.9 ? "critical" : confidence > 0.75 ? "high" : "medium",
      tags: ["heuristic", kind]
    };
  }

  private kindFromCategory(category?: string): DetectionFinding["kind"] {
    if (!category) {
      return "unknown";
    }

    if (["credentials", "auth"].includes(category)) {
      return "credential";
    }
    if (["keys", "cloud", "provider", "generic", "saas", "llm", "package", "container"].includes(category)) {
      return "secret";
    }
    if (category === "pii") {
      return "pii";
    }
    if (category === "financial") {
      return "pci";
    }
    if (category === "database" || category === "internal" || category === "trace") {
      return "internal";
    }

    return "unknown";
  }

  private dedupe(findings: DetectionFinding[]): DetectionFinding[] {
    const map = new Map<string, DetectionFinding>();
    for (const finding of findings) {
      const key = `${finding.valueHash}:${finding.startLine}:${finding.startChar}:${finding.type}`;
      if (!map.has(key) || (map.get(key)?.confidence ?? 0) < finding.confidence) {
        map.set(key, finding);
      }
    }
    return [...map.values()];
  }
}
