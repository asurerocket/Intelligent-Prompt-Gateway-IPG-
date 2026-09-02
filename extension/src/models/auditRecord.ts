import { DetectionFinding } from "./finding";

export type AuditAction = "allowed" | "warned" | "blocked" | "tokenized" | "detokenized" | "optimized" | "compressed";

export type AuditType =
  | "PROMPT_FIREWALL"
  | "RESPONSE_FIREWALL"
  | "REPOSITORY_SCAN"
  | "AI_RED_TEAM"
  | "MCP_SCAN"
  | "LLM_SECURITY_SCAN"
  | "CONTEXT_OPTIMIZED"
  | "RESPONSE_COMPRESSED"
  | "TOKEN_ANALYSIS"
  | "EFFICIENCY_REPORT";

export type AuditDirection = "input" | "output" | "repo" | "assessment" | "optimization";

export interface AuditRecord {
  id: string;
  time: string;
  user: string;
  file: string;
  provider: string;
  direction: AuditDirection;
  riskScore: number;
  riskLabel: "safe" | "low" | "medium" | "high" | "critical";
  findings: DetectionFinding[];
  action: AuditAction;
  auditType?: AuditType;
  repository?: string;
  score?: number;
  recommendations?: string[];
  details?: string;
}
