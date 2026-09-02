import { DetectionFinding } from "../models/finding";

export interface ClassificationResult {
  kind: "customer_records" | "medical_records" | "legal_documents" | "financial_documents" | "credentials" | "general";
  confidence: number;
  reason: string;
}

export interface ILocalClassifier {
  isModelAvailable(): boolean;
  classify(text: string, findings: DetectionFinding[]): ClassificationResult;
}

export class RuleBasedLocalClassifier implements ILocalClassifier {
  public isModelAvailable(): boolean {
    return false;
  }

  public classify(text: string, findings: DetectionFinding[]): ClassificationResult {
    const lower = text.toLowerCase();
    if (findings.some((f) => f.kind === "credential" || f.kind === "secret")) {
      return { kind: "credentials", confidence: 0.9, reason: "Secret detectors fired" };
    }
    if (/patient|diagnosis|medical|hipaa/.test(lower)) {
      return { kind: "medical_records", confidence: 0.78, reason: "Medical terms found" };
    }
    if (/invoice|ledger|payment|revenue|balance/.test(lower)) {
      return { kind: "financial_documents", confidence: 0.74, reason: "Financial terms found" };
    }
    if (/contract|agreement|nda|clause/.test(lower)) {
      return { kind: "legal_documents", confidence: 0.71, reason: "Legal terms found" };
    }
    if (/customer|ticket|account id|crm/.test(lower)) {
      return { kind: "customer_records", confidence: 0.7, reason: "Customer-data terms found" };
    }
    return { kind: "general", confidence: 0.5, reason: "No strong domain signal" };
  }
}
