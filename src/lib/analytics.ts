import OpenAI from "openai";
import { db } from "@/db";
import { patches, reelsMetrics, recommendations } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export async function generatePatchSummary(patchVersion: string): Promise<string> {
  const patch = db
    .select()
    .from(patches)
    .where(eq(patches.version, patchVersion))
    .all()[0];
  if (!patch) throw new Error(`Patch ${patchVersion} not found`);

  const reels = db
    .select()
    .from(reelsMetrics)
    .where(eq(reelsMetrics.patchVersion, patchVersion))
    .all();

  if (reels.length === 0) return JSON.stringify({ summary: "No reels in this patch yet", avg_metrics: {} });

  const avgViews = reels.reduce((s, r) => s + r.views, 0) / reels.length;
  const avgLikes = reels.reduce((s, r) => s + r.likes, 0) / reels.length;
  const avgSaves = reels.reduce((s, r) => s + r.saves, 0) / reels.length;
  const avgShares = reels.reduce((s, r) => s + r.shares, 0) / reels.length;
  const avgWt = reels.reduce((s, r) => s + r.avgWatchTime, 0) / reels.length;

  const best = reels.reduce((a, b) => a.views > b.views ? a : b);
  const worst = reels.reduce((a, b) => a.views < b.views ? a : b);

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-nano",
    messages: [{
      role: "user",
      content: `Generate a brief summary of this content pipeline patch results. Respond in JSON.

Patch: ${patch.version}
Description: ${patch.description}
Config: ${patch.config}
Total reels: ${reels.length}
Avg views: ${avgViews.toFixed(0)}, Avg likes: ${avgLikes.toFixed(0)}, Avg saves: ${avgSaves.toFixed(0)}, Avg shares: ${avgShares.toFixed(0)}, Avg watch time: ${avgWt.toFixed(1)}s
Best performer: "${best.topic}" (${best.views} views, ${best.saves} saves)
Worst performer: "${worst.topic}" (${worst.views} views, ${worst.saves} saves)

Format:
{"summary":"2-3 sentences about results","avg_metrics":{"views":N,"likes":N,"saves":N,"shares":N,"watch_time":N},"best_performer":{"topic":"...","views":N,"why_worked":"..."},"worst_performer":{"topic":"...","views":N,"why_failed":"..."},"key_insight":"one main observation"}`,
    }],
    temperature: 0.3,
    max_tokens: 500,
    response_format: { type: "json_object" },
  });

  const summaryJson = completion.choices[0]?.message?.content?.trim() || "{}";

  db.update(patches)
    .set({
      totalReels: reels.length,
      avgViews: avgViews,
      avgLikes: avgLikes,
      avgSaves: avgSaves,
      avgShares: avgShares,
      avgWatchTime: avgWt,
      bestPerformer: JSON.stringify({ reelId: best.reelId, topic: best.topic, views: best.views, saves: best.saves }),
      worstPerformer: JSON.stringify({ reelId: worst.reelId, topic: worst.topic, views: worst.views, saves: worst.saves }),
      summaryJson,
    })
    .where(eq(patches.version, patchVersion))
    .run();

  return summaryJson;
}

export async function runStrategicAnalysis(): Promise<{
  id: number;
  summary: string;
  recommendations: string[];
}> {
  const allPatches = db
    .select()
    .from(patches)
    .orderBy(desc(patches.createdAt))
    .limit(5)
    .all();

  const activePatch = allPatches.find((p) => p.isActive === 1);

  const currentReels = activePatch
    ? db.select().from(reelsMetrics).where(eq(reelsMetrics.patchVersion, activePatch.version)).all()
    : [];

  const allReels = db.select().from(reelsMetrics).all();
  const bestPerformers = [...allReels].sort((a, b) => b.views - a.views).slice(0, 5);
  const worstPerformers = [...allReels].sort((a, b) => a.views - b.views).slice(0, 5);

  const recentRecs = db
    .select()
    .from(recommendations)
    .orderBy(desc(recommendations.createdAt))
    .limit(5)
    .all();

  const patchSummaries = allPatches.map((p) => ({
    version: p.version,
    description: p.description,
    totalReels: p.totalReels,
    avgViews: p.avgViews,
    avgLikes: p.avgLikes,
    avgSaves: p.avgSaves,
    summary: p.summaryJson ? JSON.parse(p.summaryJson) : null,
    active: p.isActive === 1,
  }));

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const completion = await openai.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 2000,
    messages: [{
      role: "user",
      content: `You are a content strategy analyst for an Instagram Reels account. Respond in JSON.
Analyze results and give concrete recommendations.

## Patches and results:
${JSON.stringify(patchSummaries, null, 2)}

## Current active patch config:
${activePatch?.config || "none"}

## Current patch reels metrics (latest ${Math.min(currentReels.length, 10)}):
${JSON.stringify(currentReels.slice(0, 10).map((r) => ({ topic: r.topic, views: r.views, likes: r.likes, saves: r.saves, shares: r.shares, watchTime: r.avgWatchTime })), null, 2)}

## Best performers all-time (top 5 by views):
${JSON.stringify(bestPerformers.map((r) => ({ topic: r.topic, views: r.views, likes: r.likes, saves: r.saves, patch: r.patchVersion })), null, 2)}

## Worst performers all-time (top 5 lowest views):
${JSON.stringify(worstPerformers.map((r) => ({ topic: r.topic, views: r.views, likes: r.likes, saves: r.saves, patch: r.patchVersion })), null, 2)}

## Previous recommendations and outcomes:
${JSON.stringify(recentRecs.map((r) => ({ summary: r.summary, status: r.status, outcome: r.outcome, recommendations: r.recommendationsJson ? JSON.parse(r.recommendationsJson) : [] })), null, 2)}

## Task

1. **summary**: Current situation (2-3 sentences)
2. **what_works**: What drives best results and why
3. **what_doesnt_work**: What consistently underperforms — EXCLUDE these
4. **trend**: "growing" | "declining" | "stagnating"
5. **recommendations**: 2-3 specific actionable changes. Don't repeat past failed recommendations.
6. **suggested_patch_changes**: Concrete config changes for next patch
7. **confidence**: "high" | "medium" | "low" (based on data quantity)

Format:
{"summary":"...","what_works":"...","what_doesnt_work":"...","trend":"growing|declining|stagnating","recommendations":["...","..."],"suggested_patch_changes":{...},"confidence":"high|medium|low"}`,
    }],
    temperature: 0.4,
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content?.trim() || "{}";
  const parsed = JSON.parse(raw);

  const now = Math.floor(Date.now() / 1000);
  const result = db.insert(recommendations)
    .values({
      basedOnPatches: JSON.stringify(allPatches.map((p) => p.version)),
      modelUsed: "gpt-5.4",
      summary: parsed.summary || "",
      whatWorks: parsed.what_works || null,
      whatDoesntWork: parsed.what_doesnt_work || null,
      trend: parsed.trend || null,
      recommendationsJson: JSON.stringify(parsed.recommendations || []),
      suggestedChangesJson: JSON.stringify(parsed.suggested_patch_changes || {}),
      confidence: parsed.confidence || "low",
      status: "pending",
      createdAt: now,
    })
    .run();

  return {
    id: Number(result.lastInsertRowid),
    summary: parsed.summary || "",
    recommendations: parsed.recommendations || [],
  };
}
