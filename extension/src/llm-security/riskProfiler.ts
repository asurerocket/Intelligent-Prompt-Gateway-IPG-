import { CategoryScore } from "../models/securityAssessment";

export class RiskProfiler {
  public categoryScores(entries: Array<{ category: string; score: number; passed: boolean }>): CategoryScore[] {
    const grouped = new Map<string, Array<{ score: number; passed: boolean }>>();
    entries.forEach((entry) => {
      const group = grouped.get(entry.category) ?? [];
      group.push({ score: entry.score, passed: entry.passed });
      grouped.set(entry.category, group);
    });

    return [...grouped.entries()].map(([category, group]) => {
      const score = Math.round(group.reduce((sum, item) => sum + item.score, 0) / Math.max(1, group.length));
      const passed = group.filter((item) => item.passed).length;
      return {
        category,
        score,
        passed,
        failed: group.length - passed
      };
    });
  }

  public score(categoryScores: CategoryScore[]): number {
    if (!categoryScores.length) {
      return 0;
    }
    return Math.round(categoryScores.reduce((sum, item) => sum + item.score, 0) / categoryScores.length);
  }
}
