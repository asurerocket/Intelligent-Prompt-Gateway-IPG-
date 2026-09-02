export type RiskLabel = "safe" | "low" | "medium" | "high" | "critical";

export interface RiskFactor {
  name: string;
  contribution: number;
}

export interface RiskScoreResult {
  score: number;
  label: RiskLabel;
  factors: RiskFactor[];
}
