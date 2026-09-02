export interface OptimizeResult {
  optimizedPrompt: string;
  beforeTokens: number;
  afterTokens: number;
  reductionPercent: number;
  stagesUsed: string[];
  preprocessLatencyMs: number;
  rawFileTokens: number;
  stageSavings?: StageSaving[];
}

export interface StageSaving {
  key: "cleanup" | "headroom" | "focus" | "compression" | "extraction";
  label: string;
  savedTokens: number;
}

export interface OptimizerConfig {
  maxInputTokens: number;
  contextFocusThresholdPercent: number;
  enableCompression: boolean;
  contextFocusTimeoutMs: number;
  compressionTimeoutMs: number;
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
