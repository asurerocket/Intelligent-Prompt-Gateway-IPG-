export class CompressionEngine {
  public compress(text: string): string {
    const collapsedImports = this.collapseImportRuns(text);
    const collapsedComments = this.collapseCommentRuns(collapsedImports);
    return this.collapseLogsAndWhitespace(collapsedComments);
  }

  private collapseImportRuns(text: string): string {
    const lines = text.split(/\r?\n/);
    const output: string[] = [];
    let importRun = 0;

    for (const line of lines) {
      if (line.trim().startsWith("import ")) {
        importRun += 1;
        if (importRun <= 8) {
          output.push(line);
        }
        continue;
      }

      if (importRun > 8) {
        output.push(`// [ROCKET_AI_SHIELD] ${importRun - 8} import lines collapsed`);
      }
      importRun = 0;
      output.push(line);
    }

    if (importRun > 8) {
      output.push(`// [ROCKET_AI_SHIELD] ${importRun - 8} import lines collapsed`);
    }

    return output.join("\n");
  }

  private collapseCommentRuns(text: string): string {
    const lines = text.split(/\r?\n/);
    const output: string[] = [];
    let commentRun = 0;

    for (const line of lines) {
      const isComment = line.trim().startsWith("//") || line.trim().startsWith("#");
      if (isComment) {
        commentRun += 1;
        if (commentRun <= 5) {
          output.push(line);
        }
        continue;
      }

      if (commentRun > 5) {
        output.push(`// [ROCKET_AI_SHIELD] ${commentRun - 5} comment lines collapsed`);
      }
      commentRun = 0;
      output.push(line);
    }

    if (commentRun > 5) {
      output.push(`// [ROCKET_AI_SHIELD] ${commentRun - 5} comment lines collapsed`);
    }

    return output.join("\n");
  }

  private collapseLogsAndWhitespace(text: string): string {
    const lines = text.split(/\r?\n/);
    const output: string[] = [];
    let blankRun = 0;
    let stackTraceRun = 0;
    let opsLogRun = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      const looksLikeTrace = /^at\s+.+\(.+\)$/.test(trimmed);
      const looksLikeVerboseLog = /^(debug|trace|info)\s*[:|-]/i.test(trimmed);
      const looksLikeOpsLog =
        /^\d+\s+\d{2}:\d{2}:\d{2}\s+\w+/.test(trimmed) ||
        /(raw\s+(read|write)\s+(started|executed|completed|failed)|setsocketoption\s+executed|accept\s+(started|executed)|close\s+(started|executed)|sql\s+describe\s+parameter|sql\s+reset\s+parameter|http-recv|otma\s+(connect|sendtran|wait\s+resp|receive)\s+(started|ended)|extended\s+text\s+data)/i.test(
          trimmed
        );

      if (!trimmed) {
        blankRun += 1;
        if (blankRun <= 1) {
          output.push(line);
        }
        continue;
      }
      blankRun = 0;

      if (looksLikeOpsLog) {
        opsLogRun += 1;
        if (opsLogRun <= 10) {
          output.push(line);
        }
        continue;
      }

      if (opsLogRun > 10) {
        output.push(`// [ROCKET_AI_SHIELD] ${opsLogRun - 10} operational log lines collapsed`);
      }
      opsLogRun = 0;

      if (looksLikeTrace || looksLikeVerboseLog) {
        stackTraceRun += 1;
        if (stackTraceRun <= 6) {
          output.push(line);
        }
        continue;
      }

      if (stackTraceRun > 6) {
        output.push(`// [ROCKET_AI_SHIELD] ${stackTraceRun - 6} trace/log lines collapsed`);
      }
      stackTraceRun = 0;
      output.push(line);
    }

    if (stackTraceRun > 6) {
      output.push(`// [ROCKET_AI_SHIELD] ${stackTraceRun - 6} trace/log lines collapsed`);
    }
    if (opsLogRun > 10) {
      output.push(`// [ROCKET_AI_SHIELD] ${opsLogRun - 10} operational log lines collapsed`);
    }

    return output.join("\n");
  }
}
