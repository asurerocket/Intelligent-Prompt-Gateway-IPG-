import * as fs from "fs";
import * as readline from "readline";
import { selectRelevantContext } from "./contextRanker";
import { estimateTokens } from "./tokenEstimator";
import { cleanupContext } from "./cleanupContext";
import { OptimizerConfig, OptimizeResult, StageSaving } from "./types";

// Removes tcVISION/mainframe trace-specific noise that generic cleanup cannot target.
function extractDumpAscii(line: string): string | null {
  // tcVISION dump rows usually contain one or more '*' delimited text areas.
  const segments = [...line.matchAll(/\*([^*]*)/g)]
    .map((m) => (m[1] ?? "").trim())
    .filter(Boolean);
  if (segments.length === 0) return null;

  const scored = segments
    .map((seg) => ({ seg, score: scoreAsciiSegment(seg) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;

  const best = scored.slice(0, 2).map((x) => normalizeAsciiSegment(x.seg));
  const joined = best.join(" | ").trim();
  return joined.length > 0 ? joined : null;
}

function normalizeAsciiSegment(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function scoreAsciiSegment(seg: string): number {
  const s = normalizeAsciiSegment(seg);
  if (!s) return 0;

  // Reject common noise patterns from dump glyph columns.
  if (/^[.@\s]+$/.test(s)) return 0;
  if (/^[0-9]+$/.test(s)) return 0;
  if (/^[0-9A-F]{6,}$/i.test(s)) return 0;

  let score = 0;
  if (/[A-Za-z]/.test(s)) score += 4;
  if (/\d{4}-\d{2}-\d{2}/.test(s)) score += 6;
  if (/\d{2}:\d{2}:\d{2}/.test(s)) score += 6;
  if (/T\d{2}:\d{2}:\d{2}/.test(s)) score += 4;
  if (/error|exception|parse|timestamp|jdbc|tcs\d{4}/i.test(s)) score += 8;
  if (/[-:.]/.test(s)) score += 1;

  // Penalize mostly punctuation or mostly dots.
  const punctOnly = s.replace(/[A-Za-z0-9]/g, "");
  if (punctOnly.length > s.length * 0.7) score -= 3;
  const dotCount = (s.match(/[.@]/g) ?? []).length;
  if (dotCount > s.length * 0.5) score -= 4;

  return score > 0 ? score : 0;
}

function isImportantTraceEvidence(line: string): boolean {
  return /return\s*(code|message)|\bRC\b|error|exception|abend|fail|warning|sqlstate|rollback|datetimeparse|could not be parsed|unparsed text/i.test(line);
}

function isTraceMetadataNoise(line: string): boolean {
  if (isImportantTraceEvidence(line)) return false;

  if (/\b(?:message|msg)\s*(?:number|no\.?|#)\s*[:=]?\s*\d+\b/i.test(line)) return true;
  if (/^\s*(?:time|timestamp|date\s*time|elapsed\s*time)\s*[:=]/i.test(line)) return true;
  if (/\b(?:connect|connected|connecting|connection|disconnect|disconnected)\b/i.test(line)) return true;
  if (/\b(?:SQLConnect|SQLDriverConnect|SQLDisconnect|SQLSetConnectAttr|SQLGetConnectAttr)\b/i.test(line)) return true;

  return false;
}

function stripTracePrefixValues(line: string): string {
  return line
    .replace(/^\s*(?:\d+\s+)?0*\d{4,}\s+\d{1,2}:\d{2}:\d{2}(?:\.\d+)?(?:\s+\d+)?\s*/, "")
    .replace(/^\s*\[?\d{4}-\d{2}-\d{2}[T\s]+\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\]?\s*/, "")
    .replace(/^\s*\[?\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\s+\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?\]?\s*/, "")
    .replace(/^\s*\[?\d{1,2}-[A-Za-z]{3}-\d{2,4}\s+\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?\]?\s*/, "")
    .replace(/^\s*(?:time|date|timestamp|date\s*time)\s*[:=]\s*\S+(?:\s+\S+)?\s*/i, "")
    .replace(/^\s*\[?\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?\]?\s*/, "")
    .trim();
}

function traceCleanup(input: string, preserveDumpAscii = false): string {
  return input
    .split("\n")
    .filter((line) => {
      // Drop low-value trace metadata unless it also carries failure evidence.
      if (isTraceMetadataNoise(line)) return false;
      // Drop hex dump address lines: start with hex address + hex bytes + ASCII/EBCDIC repr
      if (!preserveDumpAscii && /^[\s\t]*[0-9A-F]{8,16}\s+[0-9A-F]{2}[0-9A-F\s]+\*/.test(line)) return false;
      // Drop "LENGTH 0x..., SAME AS ABOVE" lines
      if (!preserveDumpAscii && /LENGTH\s+0x[0-9A-F]+,?\s+SAME AS ABOVE/i.test(line)) return false;
      // Drop "Storage dump of ..." header lines
      if (!preserveDumpAscii && /Storage dump of /.test(line)) return false;
      // Drop repetitive SQLDescribeCol metadata (field type/length info)
      if (/POSTGRESQL:\s+SQLDescribeCol=/.test(line)) return false;
      // Drop raw "Field: X Type(...) FieldLength(...)" lines
      if (/^\s*Field:\s+\w+\s+Type\(/.test(line)) return false;
      // Drop "POSTGRESQL: Accumulated row size" lines
      if (/Accumulated row size/.test(line)) return false;
      return true;
    })
    .map(stripTracePrefixValues)
    .join("\n");
}

function removeEmptyLines(input: string): string {
  return input
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .join("\n")
    .trim();
}

// Patterns that are structurally important regardless of query intent
const STRUCTURAL_PATTERNS = [
  /return\s*code/i,
  /return\s*message/i,
  /RC\s*[:=(\s]/i,
  /error/i,
  /exception/i,
  /abend/i,
  /fail/i,
  /warning/i,
  /sqlstate/i,
  /rollback/i,
  /duration/i,
  /performance/i,
];

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Derive query-specific keywords, prioritizing multi-word phrases as semantic units
function deriveQueryKeywords(query: string): RegExp[] {
  const stopWords = new Set([
    "the","is","are","was","were","a","an","in","of","to","for",
    "and","or","it","this","that","what","where","why","how","can",
    "could","should","would","with","from","at","by","on","be","been",
    "have","has","had","not","but","all","when","do","does","did",
    "my","i","you","we","they","he","she","get","give","show","find","tell",
  ]);

  const queryLower = query.toLowerCase();

  // Common log/trace phrases worth matching as units
  const phrases = [
    "return message", "return code", "error message", "exit status",
    "failed", "error", "exception", "time out", "disk full",
    "permission denied", "not found", "success", "completed",
    "abended", "rolledback", "committed", "duration", "processing time"
  ];

  // Extract phrases found in query (order matters — longer phrases first)
  const foundPhrases = phrases
    .sort((a, b) => b.length - a.length)
    .filter(p => queryLower.includes(p));

  // Remove matched phrases from query, then extract remaining single words
  let remaining = queryLower;
  foundPhrases.forEach(p => {
    remaining = remaining.replace(new RegExp(`\\b${p.replace(/\s+/g, "\\s+")}\\b`, "g"), " ");
  });

  const words = remaining
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  // Build regex: phrases as-is (multi-word), words individually
  const phraseRegex = foundPhrases.map((p) => new RegExp(escapeRegex(p).replace(/\s+/g, "\\s+"), "i"));
  const wordRegex = [...new Set(words)].map((w) => new RegExp(escapeRegex(w), "i"));

  return [...phraseRegex, ...wordRegex];
}

function lineMatchesPatterns(line: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(line));
}

function isErrorStartIntent(query: string): boolean {
  const q = query.toLowerCase();
  return /where.*error.*start|error starting point|starting point.*error|where.*fail|failure starting point|point.*failing/.test(q);
}

function detectFailureForensicsIntent(query: string): boolean {
  const q = query.toLowerCase();
  const phrases = [
    "which point", "where fail", "where failed", "where is failing", "process failing",
    "root cause", "failure point", "why failed", "why fail", "what failed",
    "which step failed", "error cause", "failing from", "trace failure",
  ];
  if (phrases.some((p) => q.includes(p))) return true;
  return /\b(fail|failed|failing|error|exception|abend|rc|return code|root cause|issue)\b/i.test(q);
}

function addWindow(selected: Set<number>, max: number, center: number, radius = 4): void {
  const start = Math.max(0, center - radius);
  const end = Math.min(max - 1, center + radius);
  for (let i = start; i <= end; i++) selected.add(i);
}

function findFirstIndex(lines: string[], pattern: RegExp): number {
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) return i;
  }
  return -1;
}

function findLastIndex(lines: string[], pattern: RegExp): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (pattern.test(lines[i])) return i;
  }
  return -1;
}

function findNearestIndex(lines: string[], pattern: RegExp, pivot: number): number {
  let best = -1;
  let bestDist = Number.MAX_SAFE_INTEGER;
  for (let i = 0; i < lines.length; i++) {
    if (!pattern.test(lines[i])) continue;
    const d = Math.abs(i - pivot);
    if (d < bestDist) {
      best = i;
      bestDist = d;
    }
  }
  return best;
}

function findNearestReturnCodeLine(lines: string[], pivot: number): number {
  const candidates: { idx: number; rc: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/Return\s*Code\s*:\s*(\d+)/i);
    if (m) {
      candidates.push({ idx: i, rc: Number(m[1]) });
    }
  }
  if (candidates.length === 0) return -1;

  const nonZero = candidates.filter((c) => c.rc > 0);
  const pool = nonZero.length > 0 ? nonZero : candidates;
  return pool
    .map((c) => ({ ...c, d: Math.abs(c.idx - pivot) }))
    .sort((a, b) => a.d - b.d)[0].idx;
}

function deriveDateTimeFailureProbe(exceptionLine: string): string | null {
  const textMatch = exceptionLine.match(/Text\s+'([^']+)'/i);
  const raw = textMatch?.[1] ?? "";
  if (!raw) return null;

  const idxMatch = exceptionLine.match(/at\s+index\s+(\d+)/i);
  const idx = idxMatch ? Number(idxMatch[1]) : NaN;
  if (!Number.isNaN(idx) && idx >= 0 && idx < raw.length) {
    // Prefer the unparsed remainder; this is the most specific failure signal.
    const tail = raw.slice(idx).replace(/^\D+/, "").trim();
    if (tail.length >= 4) return tail;
  }

  return raw;
}

function readAllLines(filePath: string): Promise<string[]> {
  const allLines: string[] = [];
  return new Promise<string[]>((resolve, reject) => {
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    rl.on("line", (line) => allLines.push(line));
    rl.on("close", () => resolve(allLines));
    rl.on("error", reject);
  });
}

function buildErrorStartContext(allLines: string[]): string {
  const selected = new Set<number>();
  const max = allLines.length;

  const primaryFailure = findFirstIndex(
    allLines,
    /DateTimeParseException|could not be parsed|unparsed text found|JDBC error|\bException\b|\bError\(/i
  );

  const processFail = findFirstIndex(
    allLines,
    /Processing\s+\d+\s+completed.*(error|exception|could not be parsed)|Mngr:\s*Error\(/i
  );
  const mngrError = findLastIndex(allLines, /Mngr:\s*Error\(/i);

  const pivot = processFail >= 0 ? processFail : primaryFailure >= 0 ? primaryFailure : Math.floor(allLines.length / 2);
  const rcLine = findNearestReturnCodeLine(allLines, pivot);
  const rmLine = findNearestIndex(allLines, /Return\s*Message\s*:/i, pivot);

  if (primaryFailure >= 0) addWindow(selected, max, primaryFailure, 4);
  if (processFail >= 0) addWindow(selected, max, processFail, 4);
  if (mngrError >= 0) addWindow(selected, max, mngrError, 4);
  if (rcLine >= 0) addWindow(selected, max, rcLine, 4);
  if (rmLine >= 0) addWindow(selected, max, rmLine, 4);

  // Include the nearest dump block before the primary failure so the ASCII area is visible.
  if (primaryFailure >= 0) {
    const range = findDumpBlockRange(allLines, primaryFailure, 6000);
    if (range) {
      addWindow(selected, max, range.start, 1);
    }
  }

  // Prefer Mngr send dump near failure for better payload evidence.
  if (primaryFailure >= 0 || processFail >= 0) {
    const pivot = mngrError >= 0 ? mngrError : processFail >= 0 ? processFail : primaryFailure;
    const start = Math.max(0, pivot - 5000);
    const end = Math.min(allLines.length - 1, pivot + 1200);
    const sendHeaders: number[] = [];
    for (let i = start; i <= end; i++) {
      if (/storage\s+dump\s+of\s+mngr\s+send/i.test(allLines[i])) sendHeaders.push(i);
    }

    if (sendHeaders.length > 0) {
      const nearest = sendHeaders
        .map((idx) => ({ idx, dist: Math.abs(idx - pivot) }))
        .sort((a, b) => a.dist - b.dist)[0].idx;
      const range = findDumpBlockContainingIndex(allLines, nearest) ?? findDumpBlockRange(allLines, nearest, 1500);
      if (range) {
        addWindow(selected, max, range.start, 12);
      }
    }
  }

  // Anchor around malformed timestamp text when available.
  if (primaryFailure >= 0) {
    const failedTs = deriveDateTimeFailureProbe(allLines[primaryFailure]) ?? "";
    if (failedTs) {
      const normalizedTs = failedTs.replace("T", "-").replace(/:/g, ".");
      const probes = [
        failedTs,
        failedTs.slice(11, 30),
        normalizedTs.slice(11, 30),
        failedTs.slice(0, 10),
      ].filter((p) => p && p.length >= 6);

      const candidates: number[] = [];
      for (let i = 0; i < allLines.length; i++) {
        if (!isDumpContinuationLine(allLines[i])) continue;
        if (probes.some((p) => allLines[i].includes(p))) {
          candidates.push(i);
        }
      }

      candidates
        .map((idx) => ({ idx, dist: Math.abs(idx - primaryFailure) }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 3)
        .forEach(({ idx }) => {
          addWindow(selected, max, idx, 4);
          const range = findDumpBlockContainingIndex(allLines, idx) ?? findDumpBlockRange(allLines, idx, 1500);
          if (range) {
            addWindow(selected, max, range.start, 1);
          }
        });
    }
  }

  // Also capture dump rows nearest to the final manager error section.
  if (mngrError >= 0) {
    const range = findDumpBlockRange(allLines, mngrError, 6000);
    if (range) {
      addWindow(selected, max, range.start, 1);
      const nearRows: number[] = [];
      for (let i = range.start; i <= range.end; i++) {
        if (/index\s*\d+|\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{2}/i.test(allLines[i])) {
          nearRows.push(i);
        }
      }
      nearRows.slice(0, 3).forEach((idx) => addWindow(selected, max, idx, 4));
    }
  }

  const contextLines = [...selected].sort((a, b) => a - b).map((i) => allLines[i]);
  return traceCleanup(cleanupContext(contextLines.join("\n")), true);
}

function extractSuspiciousTokens(lines: string[]): string[] {
  const evidenceLines = lines.filter((l) =>
    /error|exception|failed|invalid|parse|timestamp|return\s*message|return\s*code|sqlstate/i.test(l)
  );
  const tokens = new Set<string>();

  for (const line of evidenceLines) {
    const quoted = line.match(/"([^"]{4,80})"|'([^']{4,80})'/g) ?? [];
    for (const q of quoted) {
      const clean = q.replace(/^['"]|['"]$/g, "").trim();
      if (clean.length >= 4) tokens.add(clean.toLowerCase());
    }

    const dt = line.match(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{1,2}(?::\d{1,2})?/g) ?? [];
    for (const d of dt) tokens.add(d.toLowerCase());

    const words = line.match(/\b[a-z0-9_:\-\.]{4,40}\b/gi) ?? [];
    for (const w of words) {
      const lower = w.toLowerCase();
      if (/error|exception|failed|invalid|timestamp|datetime|parse/.test(lower)) continue;
      if (/[0-9]/.test(lower) || lower.includes("-")) {
        tokens.add(lower);
      }
    }
  }

  return [...tokens].slice(0, 40);
}

function isDumpStartLine(line: string): boolean {
  return /storage\s+dump\s+of\s+/i.test(line) || /\bdump\s+of\b.*\bstart=0x[0-9a-f]+\b.*\blength=0x[0-9a-f]+/i.test(line);
}

function isDumpContinuationLine(line: string): boolean {
  return /(^[\s\t]*[0-9A-F]{8,16}\s+[0-9A-F]{2}[0-9A-F\s]+\*)|(^\s*LENGTH\s+0x[0-9A-F]+)/i.test(line);
}

function findDumpBlockRange(allLines: string[], aroundIndex: number, searchBack = 5000): { start: number; end: number } | null {
  const minIdx = Math.max(0, aroundIndex - searchBack);
  let start = -1;
  for (let i = aroundIndex; i >= minIdx; i--) {
    if (isDumpStartLine(allLines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;

  let end = start;
  while (end + 1 < allLines.length && isDumpContinuationLine(allLines[end + 1])) {
    end++;
    if (end - start > 140) break;
  }

  return { start, end };
}

function findDumpBlockContainingIndex(allLines: string[], idx: number): { start: number; end: number } | null {
  let start = -1;
  for (let i = idx; i >= 0; i--) {
    if (isDumpStartLine(allLines[i])) {
      start = i;
      break;
    }
    if (idx - i > 220) break;
  }
  if (start < 0) return null;

  let end = start;
  while (end + 1 < allLines.length && isDumpContinuationLine(allLines[end + 1])) {
    end++;
    if (end - start > 180) break;
  }
  return { start, end };
}

function collectForensicLines(allLines: string[], matchedIndexes: number[]): string[] {
  const selected = new Set<number>();
  const forcedDump = new Set<number>();
  const max = allLines.length;

  const markerIndexes: number[] = [];
  const markerRegex = /return\s*code|return\s*message|\bRC\b|error|exception|abend|fail|sqlstate|rollback|datetime|timestamp/i;
  for (let i = 0; i < allLines.length; i++) {
    if (markerRegex.test(allLines[i])) markerIndexes.push(i);
  }

  const seedIndexes = [...matchedIndexes, ...markerIndexes];
  for (const idx of seedIndexes) {
    const start = Math.max(0, idx - 3);
    const end = Math.min(max - 1, idx + 4);
    for (let i = start; i <= end; i++) selected.add(i);
  }

  // Force include nearest dump block around hard failure markers.
  const hardFailureIndexes = markerIndexes.filter((idx) =>
    /error|exception|failed|datetimeparse|unparsed text|return\s*code|return\s*message|\bRC\b/i.test(allLines[idx])
  );
  for (const idx of hardFailureIndexes) {
    const range = findDumpBlockRange(allLines, idx);
    if (!range) continue;
    for (let i = range.start; i <= range.end; i++) {
      selected.add(i);
      forcedDump.add(i);
    }
  }

  const suspiciousTokens = extractSuspiciousTokens(allLines);

  // Preserve dump blocks when ASCII side likely contains failing payload.
  for (let i = 0; i < allLines.length; i++) {
    if (!isDumpStartLine(allLines[i])) continue;

    const blockStart = i;
    let blockEnd = i;
    while (blockEnd + 1 < allLines.length && isDumpContinuationLine(allLines[blockEnd + 1])) {
      blockEnd++;
      if (blockEnd - blockStart > 120) break;
    }

    let hasTokenHit = false;
    for (let j = blockStart; j <= blockEnd; j++) {
      const ascii = extractDumpAscii(allLines[j]);
      if (!ascii) continue;
      const lowerAscii = ascii.toLowerCase();
      if (suspiciousTokens.some((t) => lowerAscii.includes(t) || t.includes(lowerAscii))) {
        hasTokenHit = true;
        selected.add(j);
        forcedDump.add(j);
        if (j - 1 >= blockStart) selected.add(j - 1);
        if (j + 1 <= blockEnd) selected.add(j + 1);
      }
    }

    if (hasTokenHit) {
      selected.add(blockStart);
      selected.add(blockEnd);
      forcedDump.add(blockStart);
      forcedDump.add(blockEnd);
    }
  }

  const sorted = [...selected].sort((a, b) => a - b);

  // Cap extremely large selections, but keep lines nearest to failure markers.
  if (sorted.length > 700 && markerIndexes.length > 0) {
    const markerSet = new Set(markerIndexes);
    const forced = sorted.filter((idx) => forcedDump.has(idx));
    const room = Math.max(0, 700 - forced.length);

    const prioritized = sorted
      .filter((idx) => !forcedDump.has(idx))
      .map((idx) => {
        const distance = markerIndexes.reduce((d, m) => Math.min(d, Math.abs(idx - m)), Number.MAX_SAFE_INTEGER);
        const markerBoost = markerSet.has(idx) ? -50 : 0;
        return { idx, rank: distance + markerBoost };
      })
      .sort((a, b) => a.rank - b.rank)
      .slice(0, room)
      .map((x) => x.idx)
      .concat(forced)
      .sort((a, b) => a - b);

    return prioritized.map((i) => allLines[i]);
  }

  return sorted
    .sort((a, b) => a - b)
    .map((i) => allLines[i]);
}

async function readRelevantLines(
  filePath: string,
  queryPatterns: RegExp[],
  tailLines: number,
  forensicMode: boolean
): Promise<{ tailBlock: string; matchedLines: string[]; totalLines: number }> {
  const allPatterns = [...STRUCTURAL_PATTERNS, ...queryPatterns];
  const allLines: string[] = [];
  const matchedIndexes: number[] = [];

  await new Promise<void>((resolve, reject) => {
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    rl.on("line", (line) => {
      const idx = allLines.length;
      allLines.push(line);
      if (lineMatchesPatterns(line, allPatterns)) {
        matchedIndexes.push(idx);
      }
    });
    rl.on("close", resolve);
    rl.on("error", reject);
  });

  const matchedLines = forensicMode
    ? collectForensicLines(allLines, matchedIndexes)
    : matchedIndexes.map((i) => allLines[i]);

  const tailBlock = allLines.slice(-tailLines).join("\n");
  return { tailBlock, matchedLines, totalLines: allLines.length };
}

export async function analyzeFileWithQuery(
  filePath: string,
  query: string,
  config: OptimizerConfig
): Promise<OptimizeResult & { rawMatchCount: number; totalLines: number }> {
  const t0 = Date.now();
  const stagesUsed: string[] = ["Targeted Extraction"];
  const stageSavings: StageSaving[] = [];
  const forensicMode = detectFailureForensicsIntent(query);
  if (forensicMode) {
    stagesUsed.push("Failure Forensics");
  }

  // Raw file token estimate before any extraction or cleanup
  const fileStat = await fs.promises.stat(filePath);
  const rawFileTokens = Math.ceil(fileStat.size / 4);

  // Deterministic evidence mode for "where error starts" style questions.
  if (isErrorStartIntent(query)) {
    const allLines = await readAllLines(filePath);
    const extractedRaw = buildErrorStartContext(allLines);
    const extractedTokens = estimateTokens(query + "\n" + extractedRaw);
    const extracted = removeEmptyLines(extractedRaw);
    const beforeTokens = estimateTokens(query + "\n" + extracted);
    const afterTokens = beforeTokens;
    stageSavings.push({ key: "extraction", label: "Targeted Extraction", savedTokens: Math.max(0, rawFileTokens - extractedTokens) });
    stageSavings.push({ key: "cleanup", label: "Cleanup", savedTokens: Math.max(0, extractedTokens - beforeTokens) });
    stageSavings.push({ key: "headroom", label: "Budget Gate", savedTokens: 0 });
    stageSavings.push({ key: "focus", label: "Context Focus", savedTokens: 0 });
    stagesUsed.push("Error Start Evidence");

    const optimizedPrompt =
      `Question:\n${query}\n\n` +
      `Extracted log context:\n${extracted}`;

    return {
      optimizedPrompt,
      rawFileTokens,
      beforeTokens,
      afterTokens,
      reductionPercent: 0,
      stagesUsed,
      preprocessLatencyMs: Date.now() - t0,
      stageSavings,
      rawMatchCount: extracted.split("\n").filter((line) => line.trim().length > 0).length,
      totalLines: allLines.length,
    };
  }

  const queryPatterns = deriveQueryKeywords(query);
  // Dynamic tail block: short queries get smaller tail (more focused), long queries get larger tail
  const queryWordCount = query.split(/\s+/).length;
  const tailLineCount = queryWordCount < 5 ? 30 : queryWordCount < 10 ? 50 : 60;

  const { tailBlock, matchedLines, totalLines } = await readRelevantLines(
    filePath,
    queryPatterns,
    tailLineCount,
    forensicMode
  );

  const extractedRawBlock = matchedLines.join("\n") + "\n" + tailBlock;
  const extractedTokens = estimateTokens(query + "\n" + extractedRawBlock);
  stageSavings.push({
    key: "extraction",
    label: "Targeted Extraction",
    savedTokens: Math.max(0, rawFileTokens - extractedTokens),
  });

  // Tail block is always kept — it contains Return Code / Return Message in tcVISION traces
  const cleanedTail = removeEmptyLines(traceCleanup(cleanupContext(tailBlock), forensicMode));

  // Only run context focusing on matched lines (not tail), joined with \n\n so ranking can chunk per-line.
  const tailSet = new Set(tailBlock.split("\n"));
  const nonTailMatched = matchedLines.filter(l => !tailSet.has(l));
  const matchedBlock = removeEmptyLines(traceCleanup(cleanupContext(nonTailMatched.join("\n\n")), forensicMode));
  stagesUsed.push("Cleanup");

  const cleanedCombined = removeEmptyLines(matchedBlock + "\n" + cleanedTail);
  const afterCleanupTokens = estimateTokens(query + "\n" + cleanedCombined);
  stageSavings.push({
    key: "cleanup",
    label: "Cleanup",
    savedTokens: Math.max(0, extractedTokens - afterCleanupTokens),
  });

  stageSavings.push({
    key: "headroom",
    label: "Budget Gate",
    savedTokens: 0,
  });

  const beforeTokens = afterCleanupTokens;

  // Context focusing runs only on the matched (non-tail) section; log budget is tighter than chat budget.
  const preFocusTokens = estimateTokens(query + "\n" + matchedBlock);
  const reducedMatched = removeEmptyLines(await selectRelevantContext(query, matchedBlock, config.contextFocusTimeoutMs));
  const postFocusTokens = estimateTokens(query + "\n" + reducedMatched);
  stagesUsed.push("Context Focus");
  stageSavings.push({
    key: "focus",
    label: "Context Focus",
    savedTokens: Math.max(0, preFocusTokens - postFocusTokens),
  });

  // Always append tail block after context focusing.
  const afterFocus = removeEmptyLines(reducedMatched + "\n" + cleanedTail);

  const afterTokens = estimateTokens(query + "\n" + afterFocus);
  const reductionPercent =
    beforeTokens > 0
      ? Math.round(((beforeTokens - afterTokens) / beforeTokens) * 100)
      : 0;

  const optimizedPrompt =
    `Question:\n${query}\n\n` +
    `Extracted log context:\n${afterFocus}`;

  return {
    optimizedPrompt,
    rawFileTokens,
    beforeTokens,
    afterTokens,
    reductionPercent,
    stagesUsed,
    preprocessLatencyMs: Date.now() - t0,
    stageSavings,
    rawMatchCount: matchedLines.length,
    totalLines,
  };
}
