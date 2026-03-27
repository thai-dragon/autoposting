import { db } from "@/db";
import { syncedAccounts, autopublishConfig, panelPublishLog } from "@/db/schema";
import { eq } from "drizzle-orm";
import { generateAndPublishVideo } from "@/lib/generate-publish";

export type TickResult =
  | { ok: true; skipped: string; nextInSec?: number }
  | { ok: true; instagramId: string }
  | { ok: false; error: string; status?: number };

export async function runAutopostTick(opts: {
  respectInterval: boolean;
  requireRunning: boolean;
}): Promise<TickResult> {
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

  const acc = db.select().from(syncedAccounts).where(eq(syncedAccounts.id, accountId)).get();
  if (!acc) {
    return { ok: false, error: "account_not_in_sync_dump", status: 400 };
  }
  if (acc.igEnabled !== 1) {
    return { ok: false, error: "instagram_disabled_for_account", status: 400 };
  }

  const headline = acc.autopostHeadline?.trim();
  if (!headline) {
    return { ok: true, skipped: "missing_autopost_headline" };
  }

  const summary = acc.autopostSummary?.trim() || headline;
  const caption = acc.autopostCaption?.trim() || "";

  try {
    const { instagramId } = await generateAndPublishVideo({
      account: acc,
      headline,
      summary,
      caption,
      publishToInstagram: true,
    });

    if (!instagramId) {
      return { ok: false, error: "publish_failed", status: 500 };
    }

    db.insert(panelPublishLog)
      .values({
        accountId,
        instagramId,
        caption: caption || headline,
        videoUrl: null,
        publishedAt: nowSec,
        status: "published",
      })
      .run();

    db.update(autopublishConfig)
      .set({ lastPublishAt: nowSec })
      .where(eq(autopublishConfig.id, 1))
      .run();

    return { ok: true, instagramId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    db.insert(panelPublishLog)
      .values({
        accountId,
        instagramId: null,
        caption: caption || headline,
        videoUrl: null,
        publishedAt: nowSec,
        status: "failed",
        error: msg,
      })
      .run();
    return { ok: false, error: msg, status: 500 };
  }
}
