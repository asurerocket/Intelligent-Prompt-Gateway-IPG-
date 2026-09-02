export interface TokenMapEntry {
  token: string;
  originalHash: string;
  originalValue: string;
  label: string;
  createdAt: string;
}

export interface TokenizationResult {
  transformedText: string;
  entries: TokenMapEntry[];
}

export interface DetokenizationResult {
  restoredText: string;
  restoredCount: number;
}
