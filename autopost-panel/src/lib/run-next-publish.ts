import { db } from "@/db";
import { videoQueue, autopublishConfig, panelPublishLog } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { publishReel, scheduleR2Cleanup } from "@tt/lib/instagram";
import { getMainAccount } from "@/lib/main-db";

export type PublishResult =
  | { ok: true; skipped: string; nextInSec?: number }
  | { ok: true; instagramId: string; queueId: number }
  | { ok: false; error: string; status?: number };

export async function runNextPublish(opts: {
  respectInterval: boolean;
  /** Cron requires autopublish ON; manual "post next" does not. */
  requireRunning: boolean;
}): Promise<PublishResult> {
  const cfg = db.select().from(autopublishConfig).where(eq(autopublishConfig.id, 1)).get();
  if (opts.requireRunning && !cfg?.running) {
    return { ok: true, skipped: "not_running" };
  }
  if (!cfg) {
    return { ok: false, error: "config_missing", status: 500 };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (
    opts.respectInterval &&
    cfg.lastPublishAt != null &&
    (nowSec - cfg.lastPublishAt) * 1000 < cfg.intervalMs
  ) {
    return {
      ok: true,
      skipped: "interval",
      nextInSec: Math.ceil(
        (cfg.intervalMs - (nowSec - cfg.lastPublishAt) * 1000) / 1000,
      ),
    };
  }

  const accountId = cfg.selectedAccountId;
  if (!accountId) {
    return { ok: false, error: "no_account_selected", status: 400 };
  }

  const acc = getMainAccount(accountId);
  if (!acc) {
    return { ok: false, error: "account_missing", status: 400 };
  }
  if (acc.igEnabled !== 1) {
    return { ok: false, error: "instagram_disabled_for_account", status: 400 };
  }

  const pending = db
    .select()
    .from(videoQueue)
    .where(and(eq(videoQueue.accountId, accountId), eq(videoQueue.status, "pending")))
    .orderBy(asc(videoQueue.createdAt))
    .limit(1)
    .all();
  const job = pending[0];
  if (!job) {
    return { ok: true, skipped: "queue_empty" };
  }

  try {
    const result = await publishReel(job.publicUrl, job.caption, {
      accessToken: acc.accessToken,
      userId: acc.userId,
    });

    db.update(videoQueue)
      .set({ status: "published", publishedAt: nowSec })
      .where(eq(videoQueue.id, job.id))
      .run();

    try {
      scheduleR2Cleanup(job.r2Key);
    } catch {
      /* optional */
    }

    db.insert(panelPublishLog)
      .values({
        accountId,
        instagramId: result.id,
        caption: job.caption,
        videoUrl: job.publicUrl,
        publishedAt: nowSec,
        status: "published",
      })
      .run();

    db.update(autopublishConfig)
      .set({ lastPublishAt: nowSec })
      .where(eq(autopublishConfig.id, 1))
      .run();

    return { ok: true, instagramId: result.id, queueId: job.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    db.update(videoQueue)
      .set({ status: "failed", error: msg })
      .where(eq(videoQueue.id, job.id))
      .run();

    db.insert(panelPublishLog)
      .values({
        accountId,
        instagramId: null,
        caption: job.caption,
        videoUrl: job.publicUrl,
        publishedAt: nowSec,
        status: "failed",
        error: msg,
      })
      .run();

    return { ok: false, error: msg, status: 500 };
  }
}
