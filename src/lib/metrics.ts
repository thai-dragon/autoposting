import { db } from "@/db";
import { reelsMetrics, metricsHistory, patches, accounts, publishLog } from "@/db/schema";
import { eq, lt } from "drizzle-orm";
import { getReelInsights, getBasicMediaMetrics, type AccountCredentials } from "./instagram";

const TWO_DAYS_SEC = 2 * 86400;
const POLL_COOLDOWN_SEC = 4 * 3600;

export async function pollAllMetrics(): Promise<{
  polled: number;
  errors: number;
  skipped: number;
}> {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - TWO_DAYS_SEC;

  const reels = db
    .select()
    .from(reelsMetrics)
    .where(lt(reelsMetrics.metricsUpdatedAt, now - POLL_COOLDOWN_SEC))
    .all()
    .filter((r) => r.createdAt > cutoff);

  let polled = 0;
  let errors = 0;
  let skipped = 0;

  for (const reel of reels) {
    if (!reel.reelId) {
      skipped++;
      continue;
    }

    let creds: AccountCredentials | undefined;
    let accountIdToUse = reel.accountId;
    if (!accountIdToUse && reel.publishLogId) {
      const log = db.select({ accountId: publishLog.accountId }).from(publishLog).where(eq(publishLog.id, reel.publishLogId)).get();
      accountIdToUse = log?.accountId ?? null;
    }
    if (accountIdToUse) {
      const acc = db.select().from(accounts).where(eq(accounts.id, accountIdToUse)).get();
      if (acc) creds = { accessToken: acc.accessToken, userId: acc.userId };
    } else {
      const defaultAcc = db.select().from(accounts).where(eq(accounts.name, "Default Account")).get();
      if (defaultAcc) creds = { accessToken: defaultAcc.accessToken, userId: defaultAcc.userId };
    }

    try {
      let insights;
      try {
        insights = await getReelInsights(reel.reelId, creds);
      } catch {
        const basic = await getBasicMediaMetrics(reel.reelId, creds);
        insights = {
          views: 0,
          likes: basic.likes,
          comments: basic.comments,
          saves: 0,
          shares: 0,
          avgWatchTime: 0,
        };
      }

      db.update(reelsMetrics)
        .set({
          views: insights.views,
          likes: insights.likes,
          comments: insights.comments,
          saves: insights.saves,
          shares: insights.shares,
          avgWatchTime: insights.avgWatchTime,
          metricsUpdatedAt: now,
        })
        .where(eq(reelsMetrics.id, reel.id))
        .run();

      db.insert(metricsHistory)
        .values({
          reelId: reel.reelId,
          polledAt: now,
          views: insights.views,
          likes: insights.likes,
          comments: insights.comments,
          saves: insights.saves,
          shares: insights.shares,
          avgWatchTime: insights.avgWatchTime,
        })
        .run();

      polled++;
    } catch (e) {
      console.error(`[Metrics] Failed to poll ${reel.reelId}:`, e);
      errors++;
    }
  }

  await syncPatchStats();

  return { polled, errors, skipped };
}

export function syncPatchStats() {
  const allPatches = db.select().from(patches).all();

  for (const p of allPatches) {
    const reels = db
      .select()
      .from(reelsMetrics)
      .where(eq(reelsMetrics.patchVersion, p.version))
      .all();

    if (reels.length === 0) continue;

    const avgViews = reels.reduce((s, r) => s + r.views, 0) / reels.length;
    const avgLikes = reels.reduce((s, r) => s + r.likes, 0) / reels.length;
    const avgSaves = reels.reduce((s, r) => s + r.saves, 0) / reels.length;
    const avgShares = reels.reduce((s, r) => s + r.shares, 0) / reels.length;
    const avgWt = reels.reduce((s, r) => s + r.avgWatchTime, 0) / reels.length;
    const best = reels.reduce((a, b) => a.views > b.views ? a : b);
    const worst = reels.reduce((a, b) => a.views < b.views ? a : b);

    db.update(patches)
      .set({
        totalReels: reels.length,
        avgViews,
        avgLikes,
        avgSaves,
        avgShares,
        avgWatchTime: avgWt,
        bestPerformer: JSON.stringify({ reelId: best.reelId, topic: best.topic, views: best.views }),
        worstPerformer: JSON.stringify({ reelId: worst.reelId, topic: worst.topic, views: worst.views }),
      })
      .where(eq(patches.version, p.version))
      .run();
  }
}

export function getActivePatchVersion(): string | null {
  const active = db
    .select()
    .from(patches)
    .where(eq(patches.isActive, 1))
    .all();
  return active[0]?.version || null;
}

function extractHashtags(caption: string): string {
  const tags = caption.match(/#[\w\u0400-\u04FF]+/g) || [];
  return JSON.stringify(tags.map((t) => t.toLowerCase()));
}

export function createMetricsRecord(
  reelId: string,
  publishLogId: number,
  caption: string,
  topic: string | null,
  descriptionType: "short" | "long" | null = null,
  template: string | null = null,
  accountId: string | null = null,
  steveCreeperUsed = false,
) {
  const now = Math.floor(Date.now() / 1000);
  const patchVersion = getActivePatchVersion();

  db.insert(reelsMetrics)
    .values({
      reelId,
      publishLogId,
      patchVersion,
      template,
      topic,
      caption,
      descriptionType,
      hashtags: extractHashtags(caption),
      steveCreeperUsed: steveCreeperUsed ? 1 : 0,
      views: 0,
      likes: 0,
      comments: 0,
      saves: 0,
      shares: 0,
      avgWatchTime: 0,
      metricsUpdatedAt: now,
      createdAt: now,
      accountId,
    })
    .run();
}
