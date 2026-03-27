import { db } from "@/db";
import { accounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ALL_QUOTES_FLAT } from "./duet-quotes-data";

export { DUET_QUOTES, getQuoteByIndex, getTotalQuotes } from "./duet-quotes-data";

export function getNextQuote(accountId: string): { chapter: string; text: string; index: number } {
  const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account) throw new Error(`Account ${accountId} not found`);

  const idx = account.lastQuoteIndex % ALL_QUOTES_FLAT.length;
  const quote = ALL_QUOTES_FLAT[idx];

  db.update(accounts)
    .set({ lastQuoteIndex: idx + 1 })
    .where(eq(accounts.id, accountId))
    .run();

  return { chapter: quote.chapter, text: quote.text, index: idx };
}
