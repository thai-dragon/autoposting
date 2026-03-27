export type IntentType =
  | "question"
  | "request"
  | "complaint"
  | "comparison"
  | "showcase";

export interface ExtractedIntent {
  intentType: IntentType;
  pattern: string;
  snippet: string;
}

const PATTERNS: Record<IntentType, RegExp[]> = {
  question: [
    /\bhow\s+(?:to|do|does|can|should)\b/i,
    /\bwhy\s+(?:does|is|do|are|can't|doesn't|won't)\b/i,
    /\bwhat\s+(?:is|are|was|were|would)\b/i,
    /\banyone\s+(?:know|tried|using|have)\b/i,
    /\bis\s+there\s+(?:a|any)\b/i,
    /\bcan\s+(?:someone|anyone|you)\b/i,
    /\bhas\s+anyone\b/i,
    /\?/,
  ],
  request: [
    /\blooking\s+for\b/i,
    /\bneed\s+(?:a|an|help|advice)\b/i,
    /\brecommend(?:ation|ations)?\b/i,
    /\bsuggestion[s]?\b/i,
    /\balternative[s]?\s+(?:to|for)\b/i,
    /\breplacement\s+for\b/i,
    /\bwish\s+there\s+was\b/i,
    /\bany\s+(?:good|free|open.source)\b/i,
    /\bbest\s+(?:way|tool|app|library|framework)\b/i,
  ],
  complaint: [
    /\bfrustrat(?:ed|ing)\b/i,
    /\bannoy(?:ed|ing)\b/i,
    /\bbroken\b/i,
    /\bdoesn'?t\s+work\b/i,
    /\bhate\b/i,
    /\bworst\b/i,
    /\bterrible\b/i,
    /\bwhy\s+can'?t\b/i,
    /\bawful\b/i,
    /\bbuggy\b/i,
    /\bunusable\b/i,
    /\bdisappoint(?:ed|ing)\b/i,
  ],
  comparison: [
    /\bvs\.?\b/i,
    /\bversus\b/i,
    /\bcompared\s+to\b/i,
    /\bbetter\s+than\b/i,
    /\bswitch(?:ed|ing)?\s+from\b/i,
    /\bmov(?:ed|ing)\s+(?:from|to)\b/i,
    /\bor\s+\w+\s*\?/i,
  ],
  showcase: [
    /\bi\s+(?:built|made|created|wrote|developed)\b/i,
    /\bjust\s+(?:launched|released|shipped|published|finished)\b/i,
    /\bmy\s+(?:project|app|tool|side.project|startup)\b/i,
    /\bcheck\s+(?:out|this)\b/i,
    /\bshow(?:case|off|-off|ing\s+off)\b/i,
    /\b(?:open.sourced|introducing)\b/i,
  ],
};

function extractSnippet(text: string, match: RegExpMatchArray): string {
  const idx = match.index ?? 0;
  const start = Math.max(0, text.lastIndexOf(". ", idx - 1) + 2);
  const end = text.indexOf(". ", idx + match[0].length);
  const snippet = text.slice(start, end === -1 ? undefined : end + 1).trim();
  return snippet.slice(0, 200);
}

export function extractIntents(
  title: string,
  selftext: string | null
): ExtractedIntent[] {
  const results: ExtractedIntent[] = [];
  const seen = new Set<string>();
  const fullText = selftext ? `${title}. ${selftext}` : title;

  for (const [intentType, patterns] of Object.entries(PATTERNS) as [
    IntentType,
    RegExp[],
  ][]) {
    for (const regex of patterns) {
      const match = fullText.match(regex);
      if (match) {
        const key = `${intentType}:${regex.source}`;
        if (seen.has(key)) continue;
        seen.add(key);

        results.push({
          intentType,
          pattern: match[0].toLowerCase().trim(),
          snippet: extractSnippet(fullText, match),
        });
        break; // one match per intent type is enough
      }
    }
  }

  return results;
}
