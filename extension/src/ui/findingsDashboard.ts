import * as path from "path";
import * as vscode from "vscode";
import { ScanResult } from "../types";

export interface DetailedFindingsDashboardModel {
  filePath: string;
  result: ScanResult;
}

export class DetailedFindingsDashboardPanel {
  private panel: vscode.WebviewPanel | undefined;

  public open(model: DetailedFindingsDashboardModel): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      this.panel.webview.html = this.render(model);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "rocketAiShieldDetailedFindingsDashboard",
      "Rocket AI Shield: Detailed Scan Dashboard",
      vscode.ViewColumn.Beside,
      { enableScripts: false }
    );

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    this.panel.webview.html = this.render(model);
  }

  private render(model: DetailedFindingsDashboardModel): string {
    const { filePath, result } = model;
    const findings = [...result.findings];
    const total = findings.length;

    const categoryCounts = new Map<string, number>();
    const sourceCounts = new Map<string, number>();
    for (const finding of findings) {
      const category = finding.category ?? "uncategorized";
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
      for (const source of finding.sources) {
        sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
      }
    }

    const sortedCategories = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1]);
    const sortedSources = [...sourceCounts.entries()].sort((a, b) => b[1] - a[1]);
    const prioritized = findings
      .slice()
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        if (a.startLine !== b.startLine) {
          return a.startLine - b.startLine;
        }
        return a.startChar - b.startChar;
      })
      .slice(0, 40);

    const riskBand = (score: number): "critical" | "high" | "medium" | "low" => {
      if (score >= 0.85) {
        return "critical";
      }
      if (score >= 0.75) {
        return "high";
      }
      if (score >= 0.6) {
        return "medium";
      }
      return "low";
    };

    const escapeHtml = (value: string): string =>
      value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");

    const compactPath = path.basename(filePath);

    const categoryRows =
      sortedCategories.length === 0
        ? `<tr><td>none</td><td class="num">0</td><td class="num">0.0%</td></tr>`
        : sortedCategories
            .map(([name, count]) => {
              const pct = total > 0 ? ((count / total) * 100).toFixed(1) : "0.0";
              return `<tr><td>${escapeHtml(name)}</td><td class="num">${count}</td><td class="num">${pct}%</td></tr>`;
            })
            .join("");

    const sourceRows =
      sortedSources.length === 0
        ? `<tr><td>none</td><td class="num">0</td><td class="num">0.0%</td></tr>`
        : sortedSources
            .map(([name, count]) => {
              const pct = total > 0 ? ((count / total) * 100).toFixed(1) : "0.0";
              return `<tr><td>${escapeHtml(name)}</td><td class="num">${count}</td><td class="num">${pct}%</td></tr>`;
            })
            .join("");

    const findingsRows =
      prioritized.length === 0
        ? `<tr><td colspan="7">No sensitive data detected.</td></tr>`
        : prioritized
            .map((finding, index) => {
              const band = riskBand(finding.score);
              const category = escapeHtml(finding.category ?? "n/a");
              const rule = escapeHtml(finding.ruleName ?? finding.contextHint ?? "n/a");
              const preview = escapeHtml(finding.preview || "n/a");
              return `<tr>
                <td class="num">${index + 1}</td>
                <td class="num">${finding.startLine + 1}</td>
                <td class="num">${finding.score.toFixed(2)}</td>
                <td><span class="risk risk-${band}">${band}</span></td>
                <td>${category}</td>
                <td>${rule}</td>
                <td class="preview">${preview}</td>
              </tr>`;
            })
            .join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Rocket AI Shield Detailed Scan</title>
  <style>
    :root {
      --bg: #f4f8ff;
      --bg-accent: #e4eefc;
      --card: #ffffff;
      --text: #1e293b;
      --muted: #52607a;
      --line: #d9e3f5;
      --header: #0f4c81;
      --critical: #9f1239;
      --high: #c2410c;
      --medium: #b45309;
      --low: #0f766e;
    }

    body {
      margin: 0;
      padding: 20px;
      color: var(--text);
      background:
        radial-gradient(circle at 85% -10%, #c9ddff 0%, rgba(201, 221, 255, 0) 44%),
        linear-gradient(180deg, var(--bg), var(--bg-accent));
      font-family: "Segoe UI", "Noto Sans", sans-serif;
    }

    .wrap {
      max-width: 1240px;
      margin: 0 auto;
      display: grid;
      gap: 14px;
    }

    .card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 12px;
      box-shadow: 0 10px 24px rgba(15, 76, 129, 0.08);
      overflow: hidden;
    }

    .card h2 {
      margin: 0;
      padding: 12px 14px;
      background: #f2f7ff;
      border-bottom: 1px solid var(--line);
      color: var(--header);
      font-size: 14px;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 10px;
      padding: 14px;
    }

    .metric {
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 10px;
      background: #fcfdff;
    }

    .metric .label {
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      margin-bottom: 6px;
    }

    .metric .value {
      font-size: 18px;
      font-weight: 700;
      word-break: break-word;
    }

    .table-wrap {
      overflow: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12.5px;
    }

    th,
    td {
      border-bottom: 1px solid var(--line);
      text-align: left;
      padding: 9px 10px;
      vertical-align: top;
    }

    th {
      background: #f7faff;
      color: #25456d;
      font-weight: 700;
      position: sticky;
      top: 0;
      z-index: 1;
    }

    td.num {
      text-align: right;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }

    .risk {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }

    .risk-critical {
      color: #fff;
      background: var(--critical);
    }

    .risk-high {
      color: #fff;
      background: var(--high);
    }

    .risk-medium {
      color: #1f2937;
      background: #fde68a;
    }

    .risk-low {
      color: #ecfeff;
      background: var(--low);
    }

    td.preview {
      min-width: 280px;
      max-width: 540px;
      white-space: normal;
      word-break: break-word;
    }

    .split {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }

    @media (max-width: 920px) {
      .split {
        grid-template-columns: 1fr;
      }
      body {
        padding: 12px;
      }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h2>Summary</h2>
      <div class="summary-grid">
        <div class="metric"><div class="label">File</div><div class="value">${escapeHtml(compactPath)}</div></div>
        <div class="metric"><div class="label">Decision</div><div class="value">${escapeHtml(result.decision.toUpperCase())}</div></div>
        <div class="metric"><div class="label">Highest Score</div><div class="value">${result.highestScore.toFixed(2)}</div></div>
        <div class="metric"><div class="label">Total Findings</div><div class="value">${total}</div></div>
      </div>
      <div style="padding: 0 14px 12px 14px; color: var(--muted); font-size: 12px;">
        Path: ${escapeHtml(filePath)}
      </div>
    </div>

    <div class="split">
      <div class="card">
        <h2>Category Breakdown</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Category</th><th class="num">Count</th><th class="num">Share</th></tr>
            </thead>
            <tbody>${categoryRows}</tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <h2>Detection Sources</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Source</th><th class="num">Count</th><th class="num">Share</th></tr>
            </thead>
            <tbody>${sourceRows}</tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Prioritized Findings (Top 40)</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="num">#</th>
              <th class="num">Line</th>
              <th class="num">Score</th>
              <th>Risk</th>
              <th>Category</th>
              <th>Rule</th>
              <th>Preview</th>
            </tr>
          </thead>
          <tbody>${findingsRows}</tbody>
        </table>
      </div>
    </div>
  </div>
</body>
</html>`;
  }
}
