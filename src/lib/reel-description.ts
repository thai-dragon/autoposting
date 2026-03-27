import { db } from "@/db";
import { posts, terms } from "@/db/schema";
import { eq, desc, inArray } from "drizzle-orm";
import OpenAI from "openai";

export type ReelDescriptionResult = {
  description?: string;
  sections?: { heading?: string; body?: string }[];
  error?: string;
};

/** Same output shape as POST /api/reels/description (for in-process autopublish / panel). */
export async function buildReelDescription(cards: unknown[]): Promise<ReelDescriptionResult> {
  if (!Array.isArray(cards) || cards.length === 0) {
    return { error: "No cards provided" };
  }

  try {
    const isQuoteReel = cards.every((c: { cluster?: string }) => (c as { cluster?: string }).cluster === "quotes");
    if (isQuoteReel) {
      const c0 = cards[0] as { hook?: string; headline?: string };
      const quoteText = c0?.hook || c0?.headline || "";
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openai.chat.completions.create({
        model: "gpt-4.1-nano",
        messages: [{
          role: "user",
          content: `Write an Instagram caption for a quote video. The quote is: "${quoteText}"

Rules:
- Start with the quote in quotes.
- Add 1-2 short reflective sentences (optional).
- End with 5-8 relevant hashtags (lowercase, no spaces).
- Tone: thoughtful, minimal. No "ALERT" or "world news".
- NEVER mention Reddit or subreddits.

Respond in JSON: {"description":"full caption text","hashtags":["#tag1","#tag2",...]}`,
        }],
        temperature: 0.4,
        max_tokens: 300,
        response_format: { type: "json_object" },
      });
      const raw = completion.choices[0]?.message?.content?.trim() || "";
      const parsed = JSON.parse(raw);
      const desc =
        parsed.description ||
        `"${quoteText}"\n\n${(parsed.hashtags || ["#quotes", "#motivation", "#deepquotes"]).join(" ")}`;
      return { description: desc, sections: [] };
    }

    const cardTerms = cards.map((c: { term?: string }) => c.term).filter(Boolean) as string[];

    const termPosts = await db
      .select({
        term: terms.term,
        title: posts.title,
        selftext: posts.selftext,
        subreddit: posts.subreddit,
        score: posts.score,
      })
      .from(terms)
      .innerJoin(posts, eq(terms.postId, posts.id))
      .where(inArray(terms.term, cardTerms))
      .orderBy(desc(posts.score))
      .limit(100);

    const postsByTerm = new Map<string, typeof termPosts>();
    for (const row of termPosts) {
      const existing = postsByTerm.get(row.term) || [];
      if (existing.length < 6) existing.push(row);
      postsByTerm.set(row.term, existing);
    }

    const sections = cards.map((card: { term?: string; headline?: string; cluster?: string }, i: number) => {
      const t = card.term || "unknown";
      const relatedPosts = postsByTerm.get(t) || [];
      const postList = relatedPosts
        .map((p) => {
          const body = p.selftext ? ` — ${p.selftext.slice(0, 200)}` : "";
          return `  [r/${p.subreddit}, ${p.score}pts] "${p.title}"${body}`;
        })
        .join("\n");

      return `#${i + 1} "${card.headline || t}" (term: ${t}, cluster: ${card.cluster || "Other"}):\n${postList || "  (no posts found)"}`;
    });

    const subreddits = [...new Set(termPosts.map((p) => `r/${p.subreddit}`))].slice(0, 8);

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-nano",
      messages: [{
        role: "user",
        content: `Write an Instagram video description for a tech trend reel. Respond in JSON. Below are the ACTUAL Reddit posts driving each trend.

${sections.join("\n\n")}

Rules:
- For each trend (#1, #2, etc.), write 2-3 sentences with SPECIFIC details from the posts above.
- Include real numbers, company names, product names, people — whatever is in the posts.
- Do NOT invent or assume any facts not present in the posts.
- If posts mention specific events, deals, releases — name them.
- Tone: informative, direct, no hype words like "groundbreaking" or "revolutionary".
- NEVER mention Reddit, subreddits, or "r/" in section bodies. Section bodies are ONLY facts.
- End with relevant hashtags (5-8, lowercase, no spaces).

Format:
{"title":"Short catchy title for the reel","sections":[{"heading":"#1 headline","body":"2-3 sentences with specifics, NO reddit/subreddit mentions"},...], "hashtags":["#tag1","#tag2",...]}`,
      }],
      temperature: 0.3,
      max_tokens: 1000,
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content?.trim() || "";
    const parsed = JSON.parse(raw);

    const lines: string[] = [];
    lines.push(`🔥 ${parsed.title || "Top Trends"}\n`);

    const secs: { heading?: string; body?: string }[] = parsed.sections || [];
    for (const sec of secs) {
      lines.push(`${sec.heading || ""}`);
      lines.push(`${sec.body || ""}\n`);
    }

    lines.push(`📊 Source: ${subreddits.join(", ")}`);
    lines.push(`▲ Trend Triangulation\n`);
    lines.push((parsed.hashtags || []).join(" "));

    return { description: lines.join("\n"), sections: secs };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("Description generation failed:", message);
    return { error: message };
  }
}
