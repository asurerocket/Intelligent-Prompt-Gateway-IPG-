import * as crypto from "crypto";
import * as path from "path";
import * as vscode from "vscode";
import { AuditRecord } from "../models/auditRecord";

export class AuditEngine {
  private readonly records: AuditRecord[] = [];

  public constructor(private readonly workspacePath?: string) {}

  public async record(entry: Omit<AuditRecord, "id">): Promise<void> {
    const record: AuditRecord = {
      ...entry,
      id: crypto.createHash("sha1").update(`${entry.time}|${entry.user}|${entry.provider}|${entry.action}`).digest("hex")
    };

    this.records.push(record);
    if (this.workspacePath) {
      const folder = vscode.Uri.file(path.join(this.workspacePath, ".rocket-ai-shield"));
      const file = vscode.Uri.file(path.join(this.workspacePath, ".rocket-ai-shield", "audit-log.jsonl"));
      try {
        await vscode.workspace.fs.stat(folder);
      } catch {
        await vscode.workspace.fs.createDirectory(folder);
      }
      const payload = `${JSON.stringify(record)}\n`;
      try {
        const existing = await vscode.workspace.fs.readFile(file);
        await vscode.workspace.fs.writeFile(file, Buffer.concat([existing, Buffer.from(payload, "utf8")]));
      } catch {
        await vscode.workspace.fs.writeFile(file, Buffer.from(payload, "utf8"));
      }
    }
  }

  public getRecent(limit = 50): AuditRecord[] {
    return this.records.slice(-limit).reverse();
  }

  public async exportJson(targetPath: string): Promise<void> {
    await vscode.workspace.fs.writeFile(vscode.Uri.file(targetPath), Buffer.from(JSON.stringify(this.records, null, 2), "utf8"));
  }

  public async exportCsv(targetPath: string): Promise<void> {
    const header = "time,user,repository,file,provider,direction,auditType,score,riskScore,riskLabel,findings,action,recommendations,details";
    const lines = this.records.map((r) => {
      const details = (r.details ?? "").replaceAll('"', "''");
      const recommendations = (r.recommendations ?? []).join(" | ").replaceAll('"', "''");
      return [
        r.time,
        r.user,
        r.repository ?? "",
        r.file,
        r.provider,
        r.direction,
        r.auditType ?? "",
        r.score ?? "",
        r.riskScore,
        r.riskLabel,
        r.findings.length,
        r.action,
        recommendations,
        details
      ]
        .map((item) => `\"${String(item)}\"`)
        .join(",");
    });
    await vscode.workspace.fs.writeFile(vscode.Uri.file(targetPath), Buffer.from([header, ...lines].join("\n"), "utf8"));
  }
}
