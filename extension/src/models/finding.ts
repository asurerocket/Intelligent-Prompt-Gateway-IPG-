export type FindingSeverity = "low" | "medium" | "high" | "critical";

export type FindingKind =
  | "secret"
  | "pii"
  | "pci"
  | "hipaa"
  | "internal"
  | "credential"
  | "dangerous_command"
  | "data_dump"
  | "unknown";

export interface DetectionFinding {
  id: string;
  kind: FindingKind;
  type: string;
  source: "regex" | "entropy" | "context" | "heuristic" | "classifier";
  filePath: string;
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
  valueHash: string;
  preview: string;
  confidence: number;
  severity: FindingSeverity;
  tags: string[];
}
