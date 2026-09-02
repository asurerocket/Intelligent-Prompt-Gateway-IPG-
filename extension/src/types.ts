export type EnforcementDecision = "allow" | "warn" | "block";

export type FindingSource = "regex" | "entropy" | "context";

export interface RegexRule {
  name: string;
  pattern: RegExp;
  severity: number;
  category: string;
}

export interface Finding {
  id: string;
  filePath: string;
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
  valueHash: string;
  preview: string;
  score: number;
  severity: number;
  sources: FindingSource[];
  ruleName?: string;
  category?: string;
  contextHint?: string;
}

export interface PolicyConfig {
  blockOnSave: boolean;
  blockOnCommit: boolean;
  entropyThreshold: number;
  ignorePatterns: string[];
  blockThreshold: number;
  warnThreshold: number;
}

export interface ScanMetrics {
  totalScans: number;
  totalFindings: number;
  blockedEvents: number;
  warnedEvents: number;
  filesAffected: Set<string>;
}

export interface ScanResult {
  findings: Finding[];
  highestScore: number;
  decision: EnforcementDecision;
}
