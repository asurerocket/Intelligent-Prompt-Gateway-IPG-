import { DetokenizationResult, TokenMapEntry } from "../models/tokenMap";

export class Detokenizer {
  public restore(text: string, tokenEntries: TokenMapEntry[]): DetokenizationResult {
    let restoredText = text;
    let restoredCount = 0;

    for (const entry of tokenEntries) {
      if (!restoredText.includes(entry.token)) {
        continue;
      }
      restoredText = restoredText.split(entry.token).join(entry.originalValue);
      restoredCount += 1;
    }

    return { restoredText, restoredCount };
  }
}
