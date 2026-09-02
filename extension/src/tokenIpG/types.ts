export interface StageSaving {
  key: "cleanup" | "headroom" | "focus" | "compression" | "extraction";
  label: string;
  savedTokens: number;
}

export interface MetricRecord {
  id: string;
  timestamp: number;
  query: string;
  rawFileTokens: number;
  beforeTokens: number;
  afterTokens: number;
  reductionPercent: number;
  stagesUsed: string[];
  preprocessLatencyMs: number;
  optimizedPrompt: string;
  stageSavings?: StageSaving[];
}
