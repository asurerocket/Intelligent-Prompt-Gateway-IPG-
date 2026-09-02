import * as crypto from "crypto";
import * as path from "path";
import * as vscode from "vscode";

const SECRET_KEY_NAME = "rocket-ai-shield.token-vault.key.v1";

export interface TokenVaultEntry {
  token: string;
  originalValue: string;
  label: string;
  filePath: string;
  createdAt: string;
}

interface StoredTokenRecord {
  token: string;
  label: string;
  filePath: string;
  createdAt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

export class TokenVault {
  public constructor(private readonly secrets: vscode.SecretStorage, private readonly workspacePath?: string) {}

  public async store(entry: TokenVaultEntry): Promise<void> {
    if (!this.workspacePath || !entry.originalValue) {
      return;
    }

    const key = await this.getOrCreateKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(entry.originalValue, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    const record: StoredTokenRecord = {
      token: entry.token,
      label: entry.label,
      filePath: entry.filePath,
      createdAt: entry.createdAt,
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      ciphertext: ciphertext.toString("base64")
    };

    await this.appendRecord(record);
  }

  public async reveal(token: string): Promise<string | undefined> {
    if (!this.workspacePath || !token.trim()) {
      return undefined;
    }

    const key = await this.getOrCreateKey();
    const records = await this.readRecords();
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const item = records[index];
      if (item.token !== token) {
        continue;
      }

      try {
        const iv = Buffer.from(item.iv, "base64");
        const tag = Buffer.from(item.tag, "base64");
        const data = Buffer.from(item.ciphertext, "base64");
        const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(tag);
        const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
        return plain;
      } catch {
        return undefined;
      }
    }

    return undefined;
  }

  private async getOrCreateKey(): Promise<Buffer> {
    const existing = await this.secrets.get(SECRET_KEY_NAME);
    if (existing) {
      return Buffer.from(existing, "base64");
    }

    const generated = crypto.randomBytes(32);
    await this.secrets.store(SECRET_KEY_NAME, generated.toString("base64"));
    return generated;
  }

  private async appendRecord(record: StoredTokenRecord): Promise<void> {
    const file = this.vaultFileUri();
    const folder = vscode.Uri.file(path.dirname(file.fsPath));

    try {
      await vscode.workspace.fs.stat(folder);
    } catch {
      await vscode.workspace.fs.createDirectory(folder);
    }

    const line = `${JSON.stringify(record)}\n`;
    try {
      const existing = await vscode.workspace.fs.readFile(file);
      await vscode.workspace.fs.writeFile(file, Buffer.concat([existing, Buffer.from(line, "utf8")]));
    } catch {
      await vscode.workspace.fs.writeFile(file, Buffer.from(line, "utf8"));
    }
  }

  private async readRecords(): Promise<StoredTokenRecord[]> {
    const file = this.vaultFileUri();
    try {
      const content = await vscode.workspace.fs.readFile(file);
      const lines = Buffer.from(content)
        .toString("utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      const output: StoredTokenRecord[] = [];
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as StoredTokenRecord;
          if (parsed.token && parsed.iv && parsed.tag && parsed.ciphertext) {
            output.push(parsed);
          }
        } catch {
          // Ignore malformed rows.
        }
      }

      return output;
    } catch {
      return [];
    }
  }

  private vaultFileUri(): vscode.Uri {
    return vscode.Uri.file(path.join(this.workspacePath ?? "", ".rocket-ai-shield", "token-vault.jsonl"));
  }
}
