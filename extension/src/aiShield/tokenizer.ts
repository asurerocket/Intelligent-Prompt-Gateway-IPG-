import * as crypto from "crypto";
import { DetectionFinding } from "../models/finding";
import { TokenMapEntry, TokenizationResult } from "../models/tokenMap";

const KIND_TO_LABEL: Record<string, string> = {
  pii: "PII",
  secret: "SECRET",
  credential: "CREDENTIAL",
  pci: "CARD",
  hipaa: "MEDICAL",
  internal: "INTERNAL",
  dangerous_command: "COMMAND",
  data_dump: "EXPORT"
};

export class Tokenizer {
  private readonly store = new Map<string, TokenMapEntry>();
  private readonly kindCounters = new Map<string, number>();

  private readonly directPatterns: Array<{ kind: string; pattern: RegExp }> = [
    { kind: "pii", pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
    { kind: "pii", pattern: /\b(?:\+1[-. ]?)?\(?[2-9][0-9]{2}\)?[-. ]?[0-9]{3}[-. ]?[0-9]{4}\b/g },
    { kind: "pci", pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g },
    { kind: "secret", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
    { kind: "secret", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g },
    { kind: "secret", pattern: /\bsk-[A-Za-z0-9]{20,}\b/g }
  ];

  private readonly labeledValuePatterns: Array<{ kind: string; pattern: RegExp; valueGroupIndex: number }> = [
    {
      kind: "credential",
      pattern: /\b(password|passwd|pwd)\b\s*[:=]\s*(['"]?)([^'"\s]{8,})\2/gi,
      valueGroupIndex: 3
    },
    {
      kind: "secret",
      pattern: /\b(api[_ -]?key|apikey|token|secret|client[_-]?secret)\b\s*[:=]\s*(['"]?)([A-Za-z0-9._\-+/=!]{8,})\2/gi,
      valueGroupIndex: 3
    }
  ];

  public tokenize(text: string, findings: DetectionFinding[]): TokenizationResult {
    let transformedText = text;
    const entries: TokenMapEntry[] = [];

    const findingsResult = this.tokenizeFromFindings(transformedText, findings);
    transformedText = findingsResult.transformedText;
    entries.push(...findingsResult.entries);

    // Fallback path that tokenizes well-known formats directly from text.
    for (const item of this.directPatterns) {
      let match: RegExpExecArray | null;
      item.pattern.lastIndex = 0;
      while ((match = item.pattern.exec(transformedText)) !== null) {
        const raw = match[0];
        const token = this.nextToken(item.kind);
        const entry: TokenMapEntry = {
          token,
          originalHash: crypto.createHash("sha256").update(raw).digest("hex"),
          originalValue: raw,
          label: item.kind,
          createdAt: new Date().toISOString()
        };
        transformedText = transformedText.split(raw).join(token);
        this.store.set(token, entry);
        entries.push(entry);
      }
    }

    for (const item of this.labeledValuePatterns) {
      transformedText = transformedText.replace(item.pattern, (...args: string[]) => {
        const whole = args[0];
        const raw = args[item.valueGroupIndex];
        if (!raw) {
          return whole;
        }

        const token = this.nextToken(item.kind);
        const entry: TokenMapEntry = {
          token,
          originalHash: crypto.createHash("sha256").update(raw).digest("hex"),
          originalValue: raw,
          label: item.kind,
          createdAt: new Date().toISOString()
        };

        this.store.set(token, entry);
        entries.push(entry);
        return whole.replace(raw, token);
      });
    }

    return { transformedText, entries };
  }

  public getStoreSnapshot(): TokenMapEntry[] {
    return [...this.store.values()];
  }

  private nextToken(kind: string): string {
    const label = KIND_TO_LABEL[kind] ?? "DATA";
    const count = (this.kindCounters.get(label) ?? 0) + 1;
    this.kindCounters.set(label, count);
    return `[${label}_${String(count).padStart(3, "0")}]`;
  }

  private tokenizeFromFindings(text: string, findings: DetectionFinding[]): TokenizationResult {
    const lineOffsets = this.buildLineOffsets(text);
    const candidates = findings
      .map((finding) => {
        const start = this.absoluteOffset(lineOffsets, finding.startLine, finding.startChar);
        const end = this.absoluteOffset(lineOffsets, finding.endLine, finding.endChar);
        if (start < 0 || end <= start || end > text.length) {
          return undefined;
        }

        const raw = text.slice(start, end);
        if (!raw.trim()) {
          return undefined;
        }

        const rawHash = crypto.createHash("sha256").update(raw).digest("hex");
        if (rawHash !== finding.valueHash) {
          return undefined;
        }

        return { finding, start, end, raw };
      })
      .filter((value): value is { finding: DetectionFinding; start: number; end: number; raw: string } => Boolean(value))
      .sort((a, b) => (a.start - b.start) || (b.end - b.start) - (a.end - a.start));

    const selected: Array<{ finding: DetectionFinding; start: number; end: number; raw: string }> = [];
    let cursor = 0;
    for (const candidate of candidates) {
      if (candidate.start < cursor) {
        continue;
      }
      selected.push(candidate);
      cursor = candidate.end;
    }

    let transformedText = text;
    const entries: TokenMapEntry[] = [];
    const byDescendingOffset = [...selected].sort((a, b) => b.start - a.start);
    const tokenByKindAndHash = new Map<string, string>();
    const tokenEntryByToken = new Map<string, TokenMapEntry>();
    for (const item of byDescendingOffset) {
      const key = `${item.finding.kind}:${item.finding.valueHash}`;
      let token = tokenByKindAndHash.get(key);
      if (!token) {
        token = this.nextToken(item.finding.kind);
        tokenByKindAndHash.set(key, token);
      }
      transformedText = `${transformedText.slice(0, item.start)}${token}${transformedText.slice(item.end)}`;
      let entry = tokenEntryByToken.get(token);
      if (!entry) {
        entry = {
          token,
          originalHash: item.finding.valueHash,
          originalValue: item.raw,
          label: item.finding.kind,
          createdAt: new Date().toISOString()
        };
        tokenEntryByToken.set(token, entry);
        this.store.set(token, entry);
        entries.push(entry);
      }
    }

    return { transformedText, entries };
  }

  private buildLineOffsets(text: string): number[] {
    const offsets = [0];
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] === "\n") {
        offsets.push(index + 1);
      }
    }
    return offsets;
  }

  private absoluteOffset(lineOffsets: number[], line: number, char: number): number {
    if (line < 0 || line >= lineOffsets.length || char < 0) {
      return -1;
    }
    return lineOffsets[line] + char;
  }

  public registerRawToken(rawValue: string, kind: string): TokenMapEntry {
    const token = this.nextToken(kind);
    const entry: TokenMapEntry = {
      token,
      originalHash: crypto.createHash("sha256").update(rawValue).digest("hex"),
      originalValue: rawValue,
      label: kind,
      createdAt: new Date().toISOString()
    };
    this.store.set(token, entry);
    return entry;
  }
}
