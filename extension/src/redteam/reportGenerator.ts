import * as path from "path";
import * as vscode from "vscode";
import { SecurityAssessmentResult } from "../models/securityAssessment";

export class RedTeamReportGenerator {
  public async exportAll(workspacePath: string | undefined, result: SecurityAssessmentResult): Promise<{ jsonPath: string; csvPath: string; htmlPath: string }> {
    const baseDir = workspacePath ? path.join(workspacePath, ".rocket-ai-shield") : process.cwd();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");

    const jsonPath = path.join(baseDir, `red-team-${stamp}.json`);
    const csvPath = path.join(baseDir, `red-team-${stamp}.csv`);
    const htmlPath = path.join(baseDir, `red-team-${stamp}.html`);

    await vscode.workspace.fs.createDirectory(vscode.Uri.file(baseDir));
    await this.writeFile(jsonPath, JSON.stringify(result, null, 2));
    await this.writeFile(csvPath, this.toCsv(result));
    await this.writeFile(htmlPath, this.toHtml(result));

    return { jsonPath, csvPath, htmlPath };
  }

  private async writeFile(filePath: string, content: string): Promise<void> {
    await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), Buffer.from(content, "utf8"));
  }

  private toCsv(result: SecurityAssessmentResult): string {
    const header = "assessmentType,target,category,test,severity,passed,score,details";
    const rows = result.findings.map((finding) => {
      return [
        result.assessmentType,
        result.target,
        finding.category,
        finding.name,
        finding.severity,
        finding.passed,
        finding.score,
        finding.details.replaceAll('"', "''")
      ]
        .map((value) => `\"${String(value)}\"`)
        .join(",");
    });
    return [header, ...rows].join("\n");
  }

  private toHtml(result: SecurityAssessmentResult): string {
    const rows = result.findings
      .slice(0, 80)
      .map(
        (finding) =>
          `<tr><td>${finding.category}</td><td>${finding.name}</td><td>${finding.severity.toUpperCase()}</td><td>${finding.passed ? "PASS" : "FAIL"}</td><td>${finding.score}</td><td>${finding.details}</td></tr>`
      )
      .join("");

    return `<!doctype html><html><head><meta charset="utf-8" /><title>Red Team Report</title><style>body{font-family:Segoe UI,sans-serif;padding:16px;}table{border-collapse:collapse;width:100%;font-size:12px;}td,th{border:1px solid #ccc;padding:6px;}th{background:#f5f5f5;}</style></head><body><h2>AI Red Team Assessment</h2><p>Score: ${result.score}/100 (${result.band})</p><table><thead><tr><th>Category</th><th>Test</th><th>Severity</th><th>Result</th><th>Score</th><th>Details</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
  }
}
