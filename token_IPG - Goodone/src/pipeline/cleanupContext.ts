// Fast, rule-based noise removal. No semantic understanding here.
export function cleanupContext(input: string): string {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, "")        // block comments
    .replace(/<!--[\s\S]*?-->/g, "")          // html comments
    .replace(/\/\/\s*(TODO|FIXME|HACK|NOTE):?.*/gi, "") // dev notes
    .replace(/[ \t]+/g, " ")                  // collapse inline whitespace
    .replace(/\n{3,}/g, "\n\n")               // collapse blank lines
    .replace(/^={3,}.*$/gm, "")               // banner separators
    .replace(/^-{3,}.*$/gm, "")               // dash separators
    .trim();
}
