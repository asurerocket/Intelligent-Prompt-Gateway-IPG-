import { DetectionFinding } from "./finding";

export type AssessmentBand = "excellent" | "good" | "moderate_risk" | "high_risk";

export interface AssessmentRecommendation {
  issue: string;
  impact: string;
  recommendation: string;
  severity: "low" | "medium" | "high" | "critical";
}

export interface AssessmentFinding {
  id: string;
  category: string;
  name: string;
  severity: "low" | "medium" | "high" | "critical";
  passed: boolean;
  score: number;
  details: string;
  evidence: DetectionFinding[];
}

export interface CategoryScore {
  category: string;
  score: number;
  passed: number;
  failed: number;
}

export interface SecurityAssessmentResult {
  id: string;
  assessmentType: "AI_RED_TEAM" | "MCP_SCAN" | "LLM_SECURITY_SCAN";
  target: string;
  startedAt: string;
  completedAt: string;
  totalTests: number;
  passed: number;
  failed: number;
  score: number;
  band: AssessmentBand;
  categoryScores: CategoryScore[];
  findings: AssessmentFinding[];
  recommendations: AssessmentRecommendation[];
  executionMode?: "offline_simulation" | "live_response_analysis";
  durationMs?: number;
  runChecksum?: string;
}

export interface UnifiedSecurityScore {
  promptFirewallScore: number;
  responseFirewallScore: number;
  repositorySecurityScore: number;
  mcpSecurityScore: number;
  llmSecurityScore: number;
  redTeamScore: number;
  efficiencyScore?: number;
  score: number;
  label: "enterprise_ready" | "improving" | "high_risk";
}
