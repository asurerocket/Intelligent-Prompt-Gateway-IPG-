import { AnalyticsSnapshot } from "../aiShield/analytics";

export class RiskCharts {
  public lineData(snapshot: AnalyticsSnapshot): number[] {
    const base = snapshot.totalScans || 1;
    return [
      Math.round((snapshot.totalBlocked / base) * 100),
      Math.round((snapshot.totalWarned / base) * 100),
      Math.round((snapshot.tokenizedEvents / base) * 100)
    ];
  }

  public pieData(snapshot: AnalyticsSnapshot): Array<{ label: string; value: number }> {
    return [
      { label: "Blocked", value: snapshot.totalBlocked },
      { label: "Warned", value: snapshot.totalWarned },
      { label: "Tokenized", value: snapshot.tokenizedEvents }
    ];
  }

  public barData(snapshot: AnalyticsSnapshot): Array<{ label: string; value: number }> {
    return snapshot.topLeakTypes.slice(0, 6).map((item) => ({ label: item.key, value: item.count }));
  }

  public sparkline(values: number[]): string {
    if (!values.length) {
      return "n/a";
    }

    const max = Math.max(...values, 1);
    return values
      .map((value) => {
        const ratio = value / max;
        if (ratio > 0.8) {
          return "#";
        }
        if (ratio > 0.5) {
          return "*";
        }
        if (ratio > 0.2) {
          return "+";
        }
        return ".";
      })
      .join("");
  }
}
