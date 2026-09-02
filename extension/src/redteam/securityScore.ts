import { AssessmentBand, CategoryScore } from "../models/securityAssessment";
import { RedTeamCategory } from "./attackLibrary";

export interface CategoryBucket {
  category: RedTeamCategory;
  scores: number[];
  passed: number;
  failed: number;
}

export function toBand(score: number): AssessmentBand {
  if (score >= 90) {
    return "excellent";
  }
  if (score >= 75) {
    return "good";
  }
  if (score >= 50) {
    return "moderate_risk";
  }
  return "high_risk";
}

export function aggregateCategoryScores(buckets: CategoryBucket[]): CategoryScore[] {
  return buckets.map((bucket) => {
    const avg = bucket.scores.length ? Math.round(bucket.scores.reduce((a, b) => a + b, 0) / bucket.scores.length) : 0;
    return {
      category: bucket.category,
      score: avg,
      passed: bucket.passed,
      failed: bucket.failed
    };
  });
}

export function overallScore(scores: CategoryScore[]): number {
  if (!scores.length) {
    return 0;
  }
  return Math.round(scores.reduce((sum, item) => sum + item.score, 0) / scores.length);
}
