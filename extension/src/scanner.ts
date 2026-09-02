import * as crypto from "crypto";
import * as vscode from "vscode";
import { detectHighEntropyTokens } from "./entropy";
import { PolicyEngine } from "./policyEngine";
import { regexRules } from "./regexRules";
import { Finding, FindingSource, ScanResult } from "./types";

interface LineCacheEntry {
  text: string;
  findings: Finding[];
}

interface PartialFindingInput {
  filePath: string;
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
  rawValue: string;
  preview: string;
  score: number;
  severity: number;
  source: FindingSource;
  ruleName?: string;
  category?: string;
  contextHint?: string;
  customIdSuffix?: string;
}

export class Scanner {
  private readonly lineCache = new Map<string, LineCacheEntry>();

  private static readonly ALWAYS_SCAN_RULE_HINTS = [
    "access key",
    "secret",
    "token",
    "private key",
    "authorization",
    "jwt",
    "oauth",
    "password",
    "credential",
    "api key"
  ];

  public constructor(private readonly policyEngine: PolicyEngine) {}

  public scanDocument(document: vscode.TextDocument, lineNumbers?: Set<number>): ScanResult {
    const findings: Finding[] = [];
    const config = this.policyEngine.getConfig();

    const linesToScan = lineNumbers?.size
      ? [...lineNumbers].filter((line) => line >= 0 && line < document.lineCount)
      : [...Array(document.lineCount).keys()];

    for (const lineNumber of linesToScan) {
      const line = document.lineAt(lineNumber);
      const lineText = line.text;
      if (!lineText.trim() || this.policyEngine.isIgnored(lineText)) {
        continue;
      }

      findings.push(...this.scanLine(lineText, document.uri.fsPath, lineNumber, config.entropyThreshold));
    }

    return this.aggregateAndScore(findings, document.uri.fsPath);
  }

  public scanTextBlock(text: string, filePath: string, lineOffset = 0): ScanResult {
    const findings: Finding[] = [];
    const config = this.policyEngine.getConfig();
    const lines = text.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line.trim() || this.policyEngine.isIgnored(line)) {
        continue;
      }
      findings.push(...this.scanLine(line, filePath, lineOffset + index, config.entropyThreshold));
    }

    return this.aggregateAndScore(findings, filePath);
  }

  private scanLine(lineText: string, filePath: string, lineNumber: number, entropyThreshold: number): Finding[] {
    const cacheKey = `${filePath}:${lineNumber}`;
    const cached = this.lineCache.get(cacheKey);
    if (cached && cached.text === lineText) {
      return cached.findings;
    }

    const findings: Finding[] = [];
    const lower = lineText.toLowerCase();
    const hasBracket = lineText.includes("[") && lineText.includes("]");
    const hasAt = lineText.includes("@");
    const hasDigits = /\d/.test(lineText);
    const hasAssignment = /[:=]/.test(lineText);
    const looksLikeLongToken = /\S{20,}/.test(lineText);
    const hasSecretKeyword = /(password|passwd|pwd|secret|token|api[_ -]?key|credential|auth|bearer)/i.test(lineText);

    for (const rule of regexRules) {
      if (!this.shouldEvaluateRule(rule.name, lower, { hasBracket, hasAt, hasDigits, hasAssignment, hasSecretKeyword })) {
        continue;
      }

      rule.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = rule.pattern.exec(lineText)) !== null) {
        const rawValue = match[0];
        if (this.isTokenizedPlaceholder(rawValue)) {
          continue;
        }
        if (this.shouldSuppressPlaceholderSensitiveRule(rule.name, rawValue, lineText)) {
          continue;
        }
        if (this.shouldSuppressTraceRuleNoise(rule.name, lineText, filePath)) {
          continue;
        }
        if (this.shouldSuppressIndirectReference(rule.name, rawValue, lineText)) {
          continue;
        }
        findings.push(
          this.toFinding({
            filePath,
            startLine: lineNumber,
            startChar: match.index,
            endLine: lineNumber,
            endChar: match.index + rawValue.length,
            rawValue,
            preview: this.safePreview(rawValue),
            score: Math.max(0.6, rule.severity),
            severity: rule.severity,
            source: "regex",
            ruleName: rule.name,
            category: rule.category
          })
        );
      }
    }

    if (looksLikeLongToken || hasSecretKeyword) {
      const entropyHits = detectHighEntropyTokens(lineText, entropyThreshold, 20);
      for (const hit of entropyHits) {
        findings.push(
          this.toFinding({
            filePath,
            startLine: lineNumber,
            startChar: hit.startChar,
            endLine: lineNumber,
            endChar: hit.endChar,
            rawValue: hit.token,
            preview: this.safePreview(hit.token),
            score: Math.max(0.75, hit.confidence),
            severity: 0.75,
            source: "entropy",
            category: "entropy"
          })
        );
      }
    }

    const contextHits = this.detectContextualSecrets(lineText);
    for (const contextHit of contextHits) {
      if (this.isTokenizedPlaceholder(contextHit.value)) {
        continue;
      }
      findings.push(
        this.toFinding({
          filePath,
          startLine: lineNumber,
          startChar: contextHit.start,
          endLine: lineNumber,
          endChar: contextHit.end,
          rawValue: contextHit.value,
          preview: this.safePreview(contextHit.value),
          score: 0.6,
          severity: 0.6,
          source: "context",
          category: "context",
          contextHint: contextHit.keyword
        })
      );
    }

    const traceHits = this.detectTraceSensitiveSignals(lineText, filePath);
    for (const traceHit of traceHits) {
      if (this.isTokenizedPlaceholder(traceHit.value)) {
        continue;
      }
      findings.push(
        this.toFinding({
          filePath,
          startLine: lineNumber,
          startChar: traceHit.start,
          endLine: lineNumber,
          endChar: traceHit.end,
          rawValue: traceHit.value,
          preview: this.safePreview(traceHit.value),
          score: traceHit.score,
          severity: traceHit.score,
          source: "context",
          category: "trace",
          contextHint: traceHit.keyword,
          customIdSuffix: traceHit.keyword
        })
      );
    }

    const authFailureHit = this.detectAuthFailureSignal(lineText);
    if (authFailureHit && !this.isTokenizedPlaceholder(authFailureHit.value)) {
      findings.push(
        this.toFinding({
          filePath,
          startLine: lineNumber,
          startChar: authFailureHit.start,
          endLine: lineNumber,
          endChar: authFailureHit.end,
          rawValue: authFailureHit.value,
          preview: this.safePreview(authFailureHit.value),
          score: authFailureHit.score,
          severity: authFailureHit.score,
          source: "context",
          category: "auth",
          contextHint: authFailureHit.keyword,
          customIdSuffix: authFailureHit.keyword
        })
      );
    }

    this.lineCache.set(cacheKey, { text: lineText, findings });
    return findings;
  }

  private shouldEvaluateRule(
    ruleName: string,
    lowerLine: string,
    flags: { hasBracket: boolean; hasAt: boolean; hasDigits: boolean; hasAssignment: boolean; hasSecretKeyword: boolean }
  ): boolean {
    const lowerRule = ruleName.toLowerCase();

    if (lowerRule.includes("database query statement")) {
      return this.hasSensitiveSqlSignal(lowerLine);
    }

    if (Scanner.ALWAYS_SCAN_RULE_HINTS.some((hint) => lowerRule.includes(hint))) {
      return true;
    }

    if (lowerRule.includes("placeholder")) {
      return flags.hasBracket;
    }
    if (lowerRule.includes("email")) {
      return flags.hasAt;
    }
    if (lowerRule.includes("phone") || lowerRule.includes("card") || lowerRule.includes("ifsc") || lowerRule.includes("passport")) {
      if (lowerRule.includes("passport") && !/\bpassport\b/.test(lowerLine)) {
        return false;
      }
      return flags.hasDigits;
    }
    if (lowerRule.includes("labeled") || lowerRule.includes("assignment") || lowerRule.includes("label")) {
      return flags.hasAssignment || flags.hasSecretKeyword;
    }
    if (lowerRule.includes("social security") || lowerRule.includes("iban") || lowerRule.includes("driver")) {
      return flags.hasDigits;
    }

    if (flags.hasSecretKeyword) {
      return /(api|token|secret|password|credential|oauth|auth|internal|host|ip|domain|server)/.test(lowerRule);
    }

    return true;
  }

  private hasSensitiveSqlSignal(lowerLine: string): boolean {
    if (!/\b(select|insert|update|delete)\b/.test(lowerLine)) {
      return false;
    }

    if (/\b(password|passwd|pwd|token|secret|api[_ -]?key|credential|auth|authorization|userid|ssn|credit\s*card|bank\s*account)\b/.test(lowerLine)) {
      return true;
    }

    const quotedLiterals = [...lowerLine.matchAll(/'([^']{3,120})'/g)].map((item) => item[1]);
    for (const literal of quotedLiterals) {
      if (!literal) {
        continue;
      }
      if (/[@]/.test(literal)) {
        return true;
      }
      if (/\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/.test(literal)) {
        return true;
      }
      if (/\b\d{9,}\b/.test(literal)) {
        return true;
      }
      if (/\b[a-z0-9._\-]{16,}\b/.test(literal)) {
        return true;
      }
    }

    return false;
  }

  private detectContextualSecrets(lineText: string): Array<{ start: number; end: number; value: string; keyword: string }> {
    const hits: Array<{ start: number; end: number; value: string; keyword: string }> = [];
    const quotedPattern = /\b(password|passwd|pwd|api[_-]?key|secret|token|client_secret|private_key)\b\s*[:=]\s*['\"]([^'\"]{8,})['\"]/gi;
    const unquotedPattern = /\b(password|passwd|pwd|api[_-]?key|secret|token|client_secret|private_key)\b\s*[:=]\s*([^\s,;\)\]}]{8,})/gi;
    const compoundLabelPattern = /\b([A-Za-z][A-Za-z0-9._-]*?(?:token|secret|credential)(?:[A-Za-z0-9._-]*))\b\s*[:=]\s*([^\s,;\)\]}]{8,})/gi;
    const xmlPattern = /<(password|passwd|pwd|token|secret|api[_-]?key|client_secret|private_key)>\s*([^<\s]{6,})\s*<\/\1>/gi;

    let match: RegExpExecArray | null;
    while ((match = quotedPattern.exec(lineText)) !== null) {
      const whole = match[0];
      const value = match[2];
      if (this.isPlaceholderValue(value)) {
        continue;
      }
      const start = match.index + whole.lastIndexOf(value);
      hits.push({
        start,
        end: start + value.length,
        value,
        keyword: match[1]
      });
    }

    while ((match = unquotedPattern.exec(lineText)) !== null) {
      const whole = match[0];
      const value = match[2].replace(/[\"'`]+$/g, "");
      if (value.length < 8) {
        continue;
      }
      if (this.isPlaceholderValue(value)) {
        continue;
      }
      if (this.isIndirectReferenceValue(value)) {
        continue;
      }
      if (this.shouldSkipGenericTokenContext(match[1], value, lineText)) {
        continue;
      }
      const start = match.index + whole.lastIndexOf(match[2]);
      hits.push({
        start,
        end: start + value.length,
        value,
        keyword: match[1]
      });
    }

    while ((match = compoundLabelPattern.exec(lineText)) !== null) {
      const whole = match[0];
      const key = match[1];
      const value = match[2].replace(/[\"'`]+$/g, "");
      if (value.length < 8) {
        continue;
      }
      if (this.isPlaceholderValue(value)) {
        continue;
      }
      if (this.isIndirectReferenceValue(value)) {
        continue;
      }
      if (this.shouldSkipGenericTokenContext(key, value, lineText)) {
        continue;
      }
      const start = match.index + whole.lastIndexOf(match[2]);
      hits.push({
        start,
        end: start + value.length,
        value,
        keyword: key.toLowerCase()
      });
    }

    while ((match = xmlPattern.exec(lineText)) !== null) {
      const whole = match[0];
      const value = match[2];
      const start = match.index + whole.indexOf(value);
      hits.push({
        start,
        end: start + value.length,
        value,
        keyword: match[1]
      });
    }

    return hits;
  }

  private detectTraceSensitiveSignals(
    lineText: string,
    filePath?: string
  ): Array<{ start: number; end: number; value: string; keyword: string; score: number }> {
    const hits: Array<{ start: number; end: number; value: string; keyword: string; score: number }> = [];

    const authorization = /\bAuthorization\s*:\s*([^\r\n]{6,120})/i.exec(lineText);
    if (authorization?.[1]) {
      const value = authorization[1].trim();
      const valueStart = (authorization.index ?? 0) + authorization[0].lastIndexOf(value);
      hits.push({
        start: valueStart,
        end: valueStart + value.length,
        value,
        keyword: "authorization-header",
        score: 0.72
      });
    }

    const userIdPattern = /\b(?:Effective-Userid|USERID)\b\s*(?:[:=]|\()\s*([A-Za-z0-9_*.-]{3,})\)?/gi;
    let userMatch: RegExpExecArray | null;
    while ((userMatch = userIdPattern.exec(lineText)) !== null) {
      const value = userMatch[1];
      if (this.isPlaceholderValue(value)) {
        continue;
      }
      if (/^(?:type|field|length|ccsid|array|nullable|decdigits)$/i.test(value)) {
        continue;
      }
      const start = userMatch.index + userMatch[0].lastIndexOf(value);
      hits.push({
        start,
        end: start + value.length,
        value,
        keyword: "userid",
        score: 0.68
      });
    }

    const failedLogonPattern = /\blogon\s+of\s+userid\s+([A-Za-z0-9_*.-]{3,})\s+failed\b/gi;
    let failedLogonMatch: RegExpExecArray | null;
    while ((failedLogonMatch = failedLogonPattern.exec(lineText)) !== null) {
      const value = failedLogonMatch[1];
      if (!value || this.isPlaceholderValue(value)) {
        continue;
      }
      const start = failedLogonMatch.index + failedLogonMatch[0].lastIndexOf(value);
      hits.push({
        start,
        end: start + value.length,
        value,
        keyword: "userid",
        score: 0.68
      });
    }

    const tokenPattern = /\bLS-TOKEN\s*=\s*X'([0-9A-F]{8,})'/i.exec(lineText);
    if (tokenPattern?.[1]) {
      const value = tokenPattern[1];
      const start = (tokenPattern.index ?? 0) + tokenPattern[0].lastIndexOf(value);
      hits.push({
        start,
        end: start + value.length,
        value,
        keyword: "session-token",
        score: 0.74
      });
    }

    const hostPattern = /\b(?:host|manager|endpoint|server)\b\s*[:=]\s*((?:localhost|(?:\d{1,3}\.){3}\d{1,3})(?::\d{2,5})?)/i.exec(lineText);
    if (hostPattern?.[1]) {
      const value = hostPattern[1];
      const start = (hostPattern.index ?? 0) + hostPattern[0].lastIndexOf(value);
      hits.push({
        start,
        end: start + value.length,
        value,
        keyword: "internal-host",
        score: 0.66
      });
    }

    const hostNamePattern = /\b(host(?:name)?|server(?:name)?|endpoint|domain|manager|process[_ -]?data[_ -]?from|source[_ -]?host|target[_ -]?host)\s*[:=]\s*['"]?([A-Za-z0-9._-]{3,255}(?:\.[A-Za-z0-9._-]{2,255})*)(?::\d{2,5})?['"]?/gi;
    let hostNameMatch: RegExpExecArray | null;
    while ((hostNameMatch = hostNamePattern.exec(lineText)) !== null) {
      const contextKey = (hostNameMatch[1] ?? "").toLowerCase();
      const value = hostNameMatch[2];
      if (!value || /^\d+$/.test(value)) {
        continue;
      }
      if (this.isIpOrLocalhostLiteral(value)) {
        continue;
      }
      if (this.shouldSuppressTraceHostNameByContext(contextKey, value)) {
        continue;
      }
      const start = hostNameMatch.index + hostNameMatch[0].lastIndexOf(value);
      hits.push({
        start,
        end: start + value.length,
        value,
        keyword: "host-name",
        score: 0.65
      });
    }

    const domainPattern = /\b((?:[A-Za-z0-9-]+\.)+(?:com|net|org|io|co|ai|dev|cloud|internal|local|corp))\b/gi;
    let domainMatch: RegExpExecArray | null;
    while ((domainMatch = domainPattern.exec(lineText)) !== null) {
      const value = domainMatch[1];
      if (!value || value.length < 6) {
        continue;
      }
      if (this.shouldSuppressTraceDomainNoise(lineText, filePath)) {
        continue;
      }
      const start = domainMatch.index + domainMatch[0].lastIndexOf(value);
      hits.push({
        start,
        end: start + value.length,
        value,
        keyword: "domain",
        score: /rocketsoftware\.com/i.test(value) ? 0.72 : 0.62
      });
    }

    const jdbcUrlPattern = /\bjdbc:[a-z0-9_]+:\/\/([A-Za-z0-9._-]+)(?::(\d{2,5}))?/gi;
    let jdbcMatch: RegExpExecArray | null;
    while ((jdbcMatch = jdbcUrlPattern.exec(lineText)) !== null) {
      const host = jdbcMatch[1];
      const portText = jdbcMatch[2];
      if (!host) {
        continue;
      }

      let endpoint = host;
      if (portText) {
        const port = Number(portText);
        if (!Number.isFinite(port) || port < 1 || port > 65535) {
          continue;
        }
        endpoint = `${host}:${portText}`;
      }

      const start = jdbcMatch.index + jdbcMatch[0].indexOf(endpoint);
      hits.push({
        start,
        end: start + endpoint.length,
        value: endpoint,
        keyword: "jdbc-endpoint",
        score: portText ? 0.74 : 0.7
      });
    }

    const contextualIpPattern = /\b(?:host|hostname|server|source|destination|manager|endpoint|ip(?:\s*address)?)\b[^\r\n]{0,48}?((?:\d{1,3}\.){3}\d{1,3}(?::\d{2,5})?)\b/gi;
    let ipMatch: RegExpExecArray | null;
    while ((ipMatch = contextualIpPattern.exec(lineText)) !== null) {
      const value = ipMatch[1];
      const ipOnly = value.split(":")[0];
      const octets = ipOnly.split(".").map((octet) => Number(octet));
      if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
        continue;
      }
      const start = ipMatch.index + ipMatch[0].lastIndexOf(value);
      hits.push({
        start,
        end: start + value.length,
        value,
        keyword: "ip-address",
        score: 0.7
      });
    }

    const ipWithPortPattern = /\b((?:localhost|(?:\d{1,3}\.){3}\d{1,3}):(\d{4,5}))\b/gi;
    let ipWithPortMatch: RegExpExecArray | null;
    while ((ipWithPortMatch = ipWithPortPattern.exec(lineText)) !== null) {
      const value = ipWithPortMatch[1];
      const portText = ipWithPortMatch[2];
      const host = value.slice(0, value.lastIndexOf(":"));
      const port = Number(portText);
      if (!Number.isFinite(port) || port < 1000 || port > 65535) {
        continue;
      }

      if (host !== "localhost") {
        const octets = host.split(".").map((octet) => Number(octet));
        if (octets.length !== 4 || octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
          continue;
        }
      }

      const start = ipWithPortMatch.index + ipWithPortMatch[0].lastIndexOf(value);
      hits.push({
        start,
        end: start + value.length,
        value,
        keyword: "ip-port",
        score: 0.74
      });
    }

    const localhostPattern = /\blocalhost(?::\d{2,5})?\b/gi;
    let localhostMatch: RegExpExecArray | null;
    while ((localhostMatch = localhostPattern.exec(lineText)) !== null) {
      const value = localhostMatch[0];
      hits.push({
        start: localhostMatch.index,
        end: localhostMatch.index + value.length,
        value,
        keyword: "localhost",
        score: 0.66
      });
    }

    return hits;
  }

  private isTraceLikeFile(filePath: string): boolean {
    return /(?:^|[\\/])(trace|traces)[^\\/]*\.(txt|log|trc)$/i.test(filePath) || /trace/i.test(filePath);
  }

  private shouldSuppressTraceRuleNoise(ruleName: string, lineText: string, filePath: string): boolean {
    if (!this.isTraceLikeFile(filePath)) {
      return false;
    }

    if (ruleName === "Database Query Statement") {
      return /(postgresql:|sqlprepare\(|sqlexecute|sqlrowcount|sqlnumresultcols|fetch_sql_row|jdbc:|sql\s+describe\s+parameter)/i.test(lineText);
    }

    if (ruleName === "Password Label" || ruleName === "User ID Assignment") {
      const traceMetaNoise = /(postgresql:|sqlprepare\(|sqldescribecol|field:\s*(password|userid)\b|\bselect\b[\s\S]*\b(password|userid)\b[\s\S]*\bfrom\b)/i;
      if (traceMetaNoise.test(lineText)) {
        return true;
      }
      if (/\[TOKENIZED_[A-Z0-9_]+_\d{3}\]/i.test(lineText)) {
        return true;
      }
    }

    if (ruleName === "US Social Security Number") {
      const hasSsnContext = /\b(ssn|social\s+security|tax\s*id|national\s*id|aadhaar|aadhar)\b/i.test(lineText);
      return !hasSsnContext;
    }

    if (ruleName === "US Phone Number") {
      const hasPhoneContext = /\b(phone|mobile|contact|call|tel|telephone|fax)\b/i.test(lineText);
      return !hasPhoneContext;
    }

    if (ruleName === "India Phone Number") {
      const hasPhoneContext = /\b(phone|mobile|contact|call|tel|telephone|fax|whatsapp)\b/i.test(lineText);
      return !hasPhoneContext;
    }

    return false;
  }

  private shouldSuppressTraceDomainNoise(lineText: string, filePath?: string): boolean {
    if (!filePath || !this.isTraceLikeFile(filePath)) {
      return false;
    }

    if (/\bjdbc:/i.test(lineText)) {
      return true;
    }

    const strongContext = /(https?:\/\/|\bhost\b\s*[:=]|\bdomain\b\s*[:=]|\bendpoint\b\s*[:=]|\bmanager\b\s*[:=]|process[_ -]?data[_ -]?from\s*=)/i;
    return !strongContext.test(lineText);
  }

  private shouldSuppressTraceHostNameByContext(contextKey: string, value: string): boolean {
    if (!contextKey || !value) {
      return false;
    }

    // PROCESS_DATA_FROM often contains operational agent labels rather than sensitive hostnames.
    if (/process[_ -]?data[_ -]?from/i.test(contextKey)) {
      const normalized = value.trim();
      const hasDot = normalized.includes(".");
      const hasPort = /:\d{2,5}$/.test(normalized);
      const looksLikeIp = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(normalized);
      const looksLikeAgentLabel = /agent/i.test(normalized) && /^[A-Za-z][A-Za-z0-9_-]{2,}$/.test(normalized);

      if (!hasDot && !hasPort && !looksLikeIp && looksLikeAgentLabel) {
        return true;
      }
    }

    return false;
  }

  private isIpOrLocalhostLiteral(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    if (normalized === "localhost") {
      return true;
    }

    if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(normalized)) {
      return false;
    }

    const octets = normalized.split(".").map((octet) => Number(octet));
    return octets.length === 4 && octets.every((octet) => Number.isFinite(octet) && octet >= 0 && octet <= 255);
  }

  private isPlaceholderValue(value: string): boolean {
    const normalized = value
      .replace(/^[\s'"`(\[]+|[\s'"`),.:;\]]+$/g, "")
      .replace(/\*/g, "")
      .trim()
      .toLowerCase();

    if (!normalized) {
      return true;
    }

    if (/^[x_#?-]{3,}$/i.test(normalized)) {
      return true;
    }

    if (/^(?:redact(?:ed)?|mask(?:ed)?|hidden|obfuscated|sanitized)$/i.test(normalized)) {
      return true;
    }

    if (/^[x*#?_-]+(?:[.@:/-][x*#?_-]+)+$/i.test(normalized)) {
      return true;
    }

    if (/^x{2,}@x{2,}\.[a-zx]{2,}$/i.test(normalized)) {
      return true;
    }

    return ["unknown", "none", "null", "nil", "na", "n/a", "n\\a", "notset", "not_set", "masked", "redacted"].includes(normalized);
  }

  private shouldSuppressPlaceholderSensitiveRule(ruleName: string, rawValue: string, lineText: string): boolean {
    const lowerRule = ruleName.toLowerCase();
    const allowStructuralRule = /(database query statement|pem block|private key|authorization header generic|basic auth header|bearer token header)/.test(lowerRule);
    if (allowStructuralRule) {
      return false;
    }

    const likelySensitiveRule =
      /(password|passwd|pwd|user id assignment|userid|uid|secret|token|api key|credential|connection string|email|phone|card|iban|ifsc|passport|driver|host|server|domain|ip|url|case number|account)/.test(
        lowerRule
      ) || !/statement|path assignment/.test(lowerRule);

    if (!likelySensitiveRule) {
      return false;
    }

    if (this.isPlaceholderValue(rawValue)) {
      return true;
    }

    const assignmentPatterns = [
      /\b(?:password|passwd|pwd|user[_ -]?id|userid|uid|token|secret|api[_ -]?key|credential)\b\s*[:=]\s*['"]?([^\s'";,\)\]}]+)/i,
      /\b(?:uid|user\s*id)\b\s*=\s*([^;\s]+)/i,
      /\bpwd\b\s*=\s*([^;\s]+)/i,
      /\b(?:host|hostname|server|domain|ip(?:\s*address)?|endpoint|url|email|phone|mobile|account|iban|ifsc)\b\s*[:=]\s*['"]?([^\s'";,\)\]}]+)/i
    ];

    for (const pattern of assignmentPatterns) {
      const fromRaw = pattern.exec(rawValue);
      if (fromRaw?.[1] && this.isPlaceholderValue(fromRaw[1])) {
        return true;
      }
      const fromLine = pattern.exec(lineText);
      if (fromLine?.[1] && this.isPlaceholderValue(fromLine[1])) {
        return true;
      }
    }

    const kvPairs = [...lineText.matchAll(/\b([A-Za-z_][A-Za-z0-9_.-]{1,64})\s*=\s*([^;\s,\)\]}]+)/g)];
    for (const pair of kvPairs) {
      const key = (pair[1] ?? "").toLowerCase();
      const value = pair[2] ?? "";
      if (!key || !value) {
        continue;
      }
      if (/(uid|userid|user|pwd|password|token|secret|key|credential|host|server|domain|ip|endpoint|email|phone|account)/.test(key)) {
        if (this.isPlaceholderValue(value)) {
          return true;
        }
      }
    }

    return false;
  }

  private isTokenizedPlaceholder(value: string): boolean {
    const normalized = value.trim();
    if (!normalized) {
      return false;
    }

    const compact = normalized.replace(/[\s"'`),.:;\]}]+$/g, "");
    if (!compact) {
      return false;
    }

    // Context regex extraction may capture placeholders without the closing bracket.
    // Accept both complete and truncated bracket forms.
    return /^\[?TOKENIZED_[A-Z0-9_]+_\d{3}\]?$/i.test(compact);
  }

  private isIndirectReferenceValue(value: string): boolean {
    const normalized = value.replace(/[\"'`]+$/g, "").trim();
    if (!normalized) {
      return true;
    }

    return /^(?:process\s*\.\s*env(?:\s*\?\.)?\s*\.\s*[A-Za-z_][A-Za-z0-9_]*|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|env\.[A-Za-z_][A-Za-z0-9_]*)$/i.test(
      normalized
    );
  }

  private shouldSuppressIndirectReference(ruleName: string, rawValue: string, lineText: string): boolean {
    const lowerRule = ruleName.toLowerCase();
    if (!/(password|secret|token|api key|credential)/.test(lowerRule)) {
      return false;
    }

    const assignment = /[:=]\s*([^\s,;\)\]}]+)/.exec(rawValue) ?? /[:=]\s*([^\s,;\)\]}]+)/.exec(lineText);
    if (!assignment?.[1]) {
      return false;
    }

    return this.isIndirectReferenceValue(assignment[1]);
  }

  private shouldSkipGenericTokenContext(keyword: string, value: string, lineText: string): boolean {
    if (!/token/i.test(keyword)) {
      return false;
    }

    const normalized = value.replace(/[\"'`]+$/g, "").trim();
    if (/^x'[0-9a-f]{8,}'?$/i.test(normalized)) {
      return true;
    }

    if (/\bls-token\b/i.test(lineText) && /^[0-9a-f]{8,}$/i.test(normalized)) {
      return true;
    }

    return false;
  }

  private aggregateAndScore(findings: Finding[], filePath: string): ScanResult {
    if (!findings.length) {
      return { findings: [], highestScore: 0, decision: "allow" };
    }

    const deduped = new Map<string, Finding>();

    for (const finding of findings) {
      const key = `${finding.startLine}:${finding.startChar}:${finding.endChar}:${finding.valueHash}`;
      const existing = deduped.get(key);
      if (!existing) {
        deduped.set(key, finding);
        continue;
      }

      const mergedSources = Array.from(new Set([...existing.sources, ...finding.sources]));
      const weightedScore = this.combineScore(existing.score, finding.score, mergedSources);
      deduped.set(key, {
        ...existing,
        score: weightedScore,
        severity: Math.max(existing.severity, finding.severity),
        sources: mergedSources,
        ruleName: existing.ruleName ?? finding.ruleName,
        category: existing.category ?? finding.category,
        contextHint: existing.contextHint ?? finding.contextHint
      });
    }

    const mergedFindings = [...deduped.values()].map((finding) => ({
      ...finding,
      filePath,
      score: this.normalizeScore(finding.score)
    }));

    const highestSingleScore = mergedFindings.reduce((max, finding) => Math.max(max, finding.score), 0);
    const cumulativeScore = this.evidenceScore(mergedFindings, highestSingleScore);
    const highestScore = Math.max(highestSingleScore, cumulativeScore);
    const decision = this.policyEngine.evaluateScore(highestScore);

    return {
      findings: mergedFindings,
      highestScore,
      decision
    };
  }

  private evidenceScore(findings: Finding[], highestSingleScore: number): number {
    if (!findings.length) {
      return 0;
    }

    const uniqueLines = new Set(findings.map((item) => `${item.startLine}:${item.endLine}`)).size;
    const categories = new Set(findings.map((item) => item.category ?? "unknown"));
    const hasCritical = findings.some((item) => {
      const rule = (item.ruleName ?? "").toLowerCase();
      return (
        item.severity >= 0.95 ||
        rule.includes("private key") ||
        rule.includes("aws access key") ||
        rule.includes("openai api key") ||
        rule.includes("github") ||
        rule.includes("connection string")
      );
    });

    if (hasCritical) {
      return 0.98;
    }

    let score = highestSingleScore;
    if (findings.length >= 20 || uniqueLines >= 12) {
      score = Math.max(score, 0.72);
    }
    if (findings.length >= 70 || uniqueLines >= 30) {
      score = Math.max(score, 0.81);
    }
    if (findings.length >= 140 || uniqueLines >= 60) {
      score = Math.max(score, 0.9);
    }

    // Mixed auth + trace signals are usually sensitive operational leakage.
    if (categories.has("auth") && categories.has("trace")) {
      score = Math.min(0.96, score + 0.05);
    }

    return this.normalizeScore(score);
  }

  private detectAuthFailureSignal(lineText: string): { start: number; end: number; value: string; keyword: string; score: number } | undefined {
    const patterns: Array<{ regex: RegExp; keyword: string; score: number; valueGroup: number }> = [
      { regex: /invalid\s+userid\/?password\s*[:=]\s*([^\s,;\)\]}]{3,})/i, keyword: "invalid-credentials", score: 0.72, valueGroup: 1 },
      { regex: /logon\s+of\s+userid\s+([A-Za-z0-9_*.-]{3,})\s+failed/i, keyword: "failed-logon", score: 0.74, valueGroup: 1 }
    ];

    for (const pattern of patterns) {
      const match = pattern.regex.exec(lineText);
      const capturedValue = match?.[pattern.valueGroup];
      if (!capturedValue || this.isPlaceholderValue(capturedValue)) {
        continue;
      }
      const value = capturedValue;
      const start = lineText.indexOf(value, match.index ?? 0);
      return {
        start,
        end: start + value.length,
        value,
        keyword: pattern.keyword,
        score: pattern.score
      };
    }

    return undefined;
  }

  private combineScore(current: number, incoming: number, sources: FindingSource[]): number {
    const sourceWeight: Record<FindingSource, number> = {
      regex: 0.9,
      entropy: 0.75,
      context: 0.6
    };

    const weightedSignals = sources.map((source) => sourceWeight[source]);
    const base = (current + incoming) / 2;
    const evidenceBoost = weightedSignals.reduce((sum, value) => sum + value, 0) / (sources.length || 1);
    return Math.max(base, evidenceBoost);
  }

  private normalizeScore(score: number): number {
    if (!Number.isFinite(score)) {
      return 0;
    }
    return Math.max(0, Math.min(1, score));
  }

  private toFinding(input: PartialFindingInput): Finding {
    const hash = crypto.createHash("sha256").update(input.rawValue).digest("hex");
    const idSuffix = input.customIdSuffix ? `:${input.customIdSuffix}` : "";

    return {
      id: `${input.filePath}:${input.startLine}:${input.startChar}:${hash.slice(0, 12)}${idSuffix}`,
      filePath: input.filePath,
      startLine: input.startLine,
      startChar: input.startChar,
      endLine: input.endLine,
      endChar: input.endChar,
      valueHash: hash,
      preview: input.preview,
      score: input.score,
      severity: input.severity,
      sources: [input.source],
      ruleName: input.ruleName,
      category: input.category,
      contextHint: input.contextHint
    };
  }

  private safePreview(raw: string): string {
    if (!raw) {
      return "";
    }
    if (raw.length <= 6) {
      return "***";
    }
    return `${raw.slice(0, 2)}***${raw.slice(-2)}`;
  }
}
