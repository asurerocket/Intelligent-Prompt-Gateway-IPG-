import * as http from "http";
import * as https from "https";
import { URL } from "url";

export interface PresidioAdapterConfig {
  endpoint: string;
  language: string;
  scoreThreshold: number;
  timeoutMs: number;
}

export interface PresidioEntity {
  entityType: string;
  start: number;
  end: number;
  score: number;
}

interface RawPresidioEntity {
  entity_type?: unknown;
  start?: unknown;
  end?: unknown;
  score?: unknown;
}

export class PresidioAdapter {
  public async analyzeText(text: string, config: PresidioAdapterConfig): Promise<PresidioEntity[]> {
    if (!text.trim()) {
      return [];
    }

    const payload = JSON.stringify({
      text,
      language: config.language,
      score_threshold: config.scoreThreshold
    });

    const raw = await this.postJson(config.endpoint, payload, config.timeoutMs);
    if (!Array.isArray(raw)) {
      return [];
    }

    const entities: PresidioEntity[] = [];
    for (const item of raw) {
      const parsed = this.parseEntity(item as RawPresidioEntity, text.length);
      if (parsed) {
        entities.push(parsed);
      }
    }

    return entities;
  }

  private parseEntity(item: RawPresidioEntity, maxLen: number): PresidioEntity | undefined {
    const entityType = typeof item.entity_type === "string" ? item.entity_type.trim() : "";
    const start = typeof item.start === "number" ? item.start : Number(item.start);
    const end = typeof item.end === "number" ? item.end : Number(item.end);
    const score = typeof item.score === "number" ? item.score : Number(item.score);

    if (!entityType || !Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(score)) {
      return undefined;
    }

    const boundedStart = Math.max(0, Math.min(maxLen, Math.floor(start)));
    const boundedEnd = Math.max(boundedStart, Math.min(maxLen, Math.floor(end)));
    if (boundedEnd <= boundedStart) {
      return undefined;
    }

    return {
      entityType,
      start: boundedStart,
      end: boundedEnd,
      score: Math.max(0, Math.min(1, score))
    };
  }

  private postJson(endpoint: string, payload: string, timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const url = new URL(endpoint);
      const isHttps = url.protocol === "https:";
      const client = isHttps ? https : http;

      const req = client.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port ? Number(url.port) : isHttps ? 443 : 80,
          path: `${url.pathname}${url.search}`,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload)
          }
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          res.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8");
            if ((res.statusCode ?? 500) >= 400) {
              reject(new Error(`Presidio endpoint error: ${res.statusCode ?? 500}`));
              return;
            }
            try {
              resolve(JSON.parse(body));
            } catch {
              resolve([]);
            }
          });
        }
      );

      req.setTimeout(Math.max(300, timeoutMs), () => {
        req.destroy(new Error("Presidio request timeout"));
      });

      req.on("error", reject);
      req.write(payload);
      req.end();
    });
  }
}
