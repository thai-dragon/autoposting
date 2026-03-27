import { stopwords } from "./stopwords";

const MAX_TERMS = 12;
const MIN_LENGTH = 4;

export function extractTerms(title: string): string[] {
  const tokens = title
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length >= MIN_LENGTH && !stopwords.has(t));

  const unique = [...new Set(tokens)];
  return unique.slice(0, MAX_TERMS);
}
