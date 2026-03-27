import { writeFileSync, mkdtempSync } from "fs";
import { unlink, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { autopublishState, publishLog, trends, carouselMetrics, accounts, accountPostingState, reelsMetrics } from "@/db/schema";
import { desc, eq, and, gte } from "drizzle-orm";
import { shortenForVideo, generateReelForTemplate, formatCaptionForTemplate, setCaptionOverrides } from "@/lib/reel";
import {
  uploadToR2FromFile,
  uploadImageToR2,
  publishReel,
  publishCarousel,
  scheduleR2Cleanup,
  type AccountCredentials,
} from "@/lib/instagram";
import { generateCarousel } from "@/lib/carousel";
import { uploadShorts, isYouTubeConfigured } from "@/lib/youtube";
import { createMetricsRecord, getActivePatchVersion } from "@/lib/metrics";
import { getActiveTemplateSlug } from "@/lib/templates";
import { getAbTestingEnabled, getAbMainTemplate, getAbTestTemplate } from "@/lib/app-settings";
import { getNextQuote } from "@/lib/duet-quotes";
import { buildReelDescription } from "@/lib/reel-description";
import { ensureReelAssetsFromManifest } from "@/lib/reel-assets-sync";
import { getHostMemSnapshot } from "@/lib/host-mem-snapshot";
import OpenAI from "openai";

/** Visible in Render logs; filter by [autopublish]. host = Node + cgroup + дерево PID (ffmpeg в tree на Linux). */
function logAutopublishStep(step: string, detail?: Record<string, unknown>) {
  console.error(
    "[autopublish]",
    JSON.stringify({
      step,
      host: getHostMemSnapshot(),
      ...detail,
    }),
  );
}

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function getState() {
  const rows = db.select().from(autopublishState).all();
  return rows[0] || null;
}

function upsertState(data: {
  running?: number;
  currentCluster?: string | null;
  intervalMs?: number;
  lastPublishedAt?: number | null;
  lastAttemptAt?: number | null;
}) {
  const now = Math.floor(Date.now() / 1000);
  const existing = getState();
  if (existing) {
    db.update(autopublishState)
      .set({ ...data, updatedAt: now })
      .where(eq(autopublishState.id, existing.id))
      .run();
  } else {
    db.insert(autopublishState)
      .values({
        running: data.running ?? 0,
        currentCluster: data.currentCluster || null,
        intervalMs: data.intervalMs || 3600000,
        lastPublishedAt: data.lastPublishedAt ?? null,
        lastAttemptAt: data.lastAttemptAt ?? null,
        updatedAt: now,
      })
      .run();
  }
}

function getAccountPostingState(accountId: string) {
  return db.select().from(accountPostingState).where(eq(accountPostingState.accountId, accountId)).get();
}

function updateAccountPostingState(accountId: string) {
  const now = Math.floor(Date.now() / 1000);
  const today = new Date().toISOString().slice(0, 10);
  const existing = getAccountPostingState(accountId);

  if (existing) {
    const isSameDay = existing.dayDate === today;
    db.update(accountPostingState)
      .set({
        lastPublishedAt: now,
        postCountToday: isSameDay ? existing.postCountToday + 1 : 1,
        dayDate: today,
        updatedAt: now,
      })
      .where(eq(accountPostingState.accountId, accountId))
      .run();
  } else {
    db.insert(accountPostingState).values({
      accountId,
      lastPublishedAt: now,
      postCountToday: 1,
      dayDate: today,
      updatedAt: now,
    }).run();
  }
}

function getEligibleAccount(): { account: typeof accounts.$inferSelect; reason?: string } | null {
  const allAccounts = db
    .select()
    .from(accounts)
    .where(eq(accounts.isActive, 1))
    .all()
    .sort((a, b) => a.id.localeCompare(b.id));
  if (allAccounts.length === 0) return null;

  const MIN_GAP_MS = 5 * 60 * 1000;

  const lastAuto = db
    .select({ accountId: publishLog.accountId })
    .from(publishLog)
    .where(eq(publishLog.source, "auto"))
    .orderBy(desc(publishLog.publishedAt))
    .limit(1)
    .get();

  let nextIndex = 0;
  if (lastAuto?.accountId) {
    const lastIdx = allAccounts.findIndex((a) => a.id === lastAuto.accountId);
    if (lastIdx >= 0) nextIndex = (lastIdx + 1) % allAccounts.length;
  }

  const nextAccount = allAccounts[nextIndex];
  const ps = getAccountPostingState(nextAccount.id);
  if (ps?.lastPublishedAt) {
    const elapsed = Date.now() - ps.lastPublishedAt * 1000;
    if (elapsed < MIN_GAP_MS) return null;
  }

  return { account: nextAccount };
}

export async function GET() {
  const state = getState();
  const recentPosts = db
    .select()
    .from(publishLog)
    .orderBy(desc(publishLog.publishedAt))
    .limit(10)
    .all();

  const allLogs = db.select().from(publishLog).all();
  const totalPublished = allLogs.length;
  const totalByTemplate: Record<string, number> = {};
  for (const log of allLogs) {
    const t = log.template || "cards";
    totalByTemplate[t] = (totalByTemplate[t] || 0) + 1;
  }

  const dayAgo = Math.floor(Date.now() / 1000) - 86400;
  const todayCount = db
    .select()
    .from(publishLog)
    .where(gte(publishLog.publishedAt, dayAgo))
    .all().length;

  const clusterRows = db
    .select({ cluster: trends.cluster })
    .from(trends)
    .groupBy(trends.cluster)
    .all()
    .map((r) => r.cluster)
    .filter(Boolean) as string[];

  const activeAccounts = db.select().from(accounts).where(eq(accounts.isActive, 1)).all().length;

  return NextResponse.json({
    running: state?.running === 1,
    currentCluster: state?.currentCluster || null,
    intervalMs: state?.intervalMs || 3600000,
    lastPublishedAt: state?.lastPublishedAt || null,
    clusters: clusterRows,
    recentPosts,
    totalPublished,
    totalByTemplate,
    todayCount,
    dailyLimit: 999999,
    activeAccounts,
  });
}

export async function POST(req: NextRequest) {
  const { action, intervalMs } = await req.json();

  if (action === "start") {
    upsertState({ running: 1, intervalMs: intervalMs || 3600000 });
    return NextResponse.json({ running: true });
  }

  if (action === "stop") {
    upsertState({ running: 0 });
    return NextResponse.json({ running: false });
  }

  if (action === "publish_next") {
    return executePublishNext();
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

/** Same as POST action "start" — used by autopost-panel so publish_next works without a second HTTP server. */
export function ensureAutopublishRunning(intervalMs = 3_600_000) {
  const existing = getState();
  upsertState({ running: 1, intervalMs: existing?.intervalMs ?? intervalMs });
}

export async function executePublishNext(): Promise<NextResponse> {
  logAutopublishStep("executePublishNext_start");
  const state = getState();
  if (!state || state.running !== 1) {
    logAutopublishStep("executePublishNext_exit", { reason: "not_running" });
    return NextResponse.json({ error: "Auto-publish is not running" }, { status: 400 });
  }

  const LOCK_WINDOW_MS = 2 * 60 * 1000;
  if (state.lastAttemptAt && (Date.now() - state.lastAttemptAt * 1000) < LOCK_WINDOW_MS) {
    const waitSec = Math.ceil(LOCK_WINDOW_MS / 1000 - (Date.now() / 1000 - state.lastAttemptAt));
    logAutopublishStep("executePublishNext_exit", { reason: "lock_window" });
    return NextResponse.json({
      skipped: true,
      reason: `Publish in progress or recent attempt. Retry in ~${Math.ceil(waitSec / 60)}min.`,
    });
  }

  try {
    await ensureReelAssetsFromManifest();
    logAutopublishStep("after_ensureReelAssetsFromManifest");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logAutopublishStep("ensureReelAssets_failed", { error: msg.slice(0, 200) });
    return NextResponse.json({ error: `reel assets sync: ${msg}` }, { status: 500 });
  }

  upsertState({ lastAttemptAt: Math.floor(Date.now() / 1000) });

  const eligible = getEligibleAccount();
  if (!eligible) {
    const allAccounts = db.select().from(accounts).where(eq(accounts.isActive, 1)).all();
    if (allAccounts.length === 0) {
      logAutopublishStep("branch_publishForDefaultAccount");
      return publishForDefaultAccount(state);
    }
    logAutopublishStep("executePublishNext_exit", { reason: "no_eligible_account" });
    return NextResponse.json({
      skipped: true,
      reason: "All accounts have reached their daily posting limit or are on cooldown.",
    });
  }

  const account = eligible.account;
  logAutopublishStep("eligible_account", { accountId: account.id, name: account.name, niche: account.niche });
  const creds: AccountCredentials = { accessToken: account.accessToken, userId: account.userId };

  if (account.niche === "hypnotic_quotes") {
    return publishQuoteReel(account, creds, { defaultOnly: true });
  }

  return publishTrendReel(state, account, creds, { defaultOnly: true });
}

async function publishQuoteReel(
  account: typeof accounts.$inferSelect,
  creds: AccountCredentials,
  opts?: { defaultOnly?: boolean },
) {
  const quote = getNextQuote(account.id);
  const autoCount = db.select().from(publishLog).where(eq(publishLog.source, "auto")).all().length;
  let template: string;
  if (opts?.defaultOnly) {
    if (getAbTestingEnabled()) {
      template = autoCount % 2 === 0 ? getAbMainTemplate() : getAbTestTemplate();
    } else {
      template = getActiveTemplateSlug();
    }
  } else {
    template = account.template || "forest";
  }

  const reelCards = [{
    hook: quote.text,
    body: `Chapter: ${quote.chapter}`,
    cluster: "quotes",
    sentiment: "neutral",
  }];

  let caption = `"${quote.text}"\n\n#duet #quotes #hypnotic #gaming #deepquotes #motivation`;
  const descQuote = await buildReelDescription(reelCards as unknown[]);
  if (!descQuote.error && descQuote.description) caption = descQuote.description;
  caption = formatCaptionForTemplate(template, reelCards, caption);

  const cm = account.captionMode || "off";
  setCaptionOverrides({
    junction: cm === "generated",
    prepopulated: cm === "prepopulated",
    whisperVoice: cm !== "off" && account.whisperVoiceEnabled === 1,
  });
  logAutopublishStep("quote_before_generateReel", { template });
  let videoBuffer = await generateReelForTemplate(template, reelCards, { whisperText: (cm === "prepopulated" && account.whisperVoiceEnabled === 1) ? quote.text : undefined });
  logAutopublishStep("quote_after_generateReel", { template, videoBytes: videoBuffer.length });
  setCaptionOverrides(null);

  const igEnabled = account.igEnabled === 1;
  if (!igEnabled) {
    return NextResponse.json({ error: "Instagram not enabled for this account" }, { status: 400 });
  }

  const finalCaption = caption;
  const filename = `auto_quote_${account.id.slice(0, 8)}_${Date.now()}.mp4`;
  const tmpDir = mkdtempSync(join(tmpdir(), "autopub-q-"));
  const tmpPath = join(tmpDir, filename.replace(/[^\w.-]/g, "_"));
  const qBytes = videoBuffer.length;
  writeFileSync(tmpPath, videoBuffer);
  videoBuffer = Buffer.alloc(0);
  logAutopublishStep("quote_spilled_to_disk", { videoBytes: qBytes });
  logAutopublishStep("quote_before_uploadR2_stream", { videoBytes: qBytes });
  const videoUrl = await uploadToR2FromFile(tmpPath, filename);
  await unlink(tmpPath).catch(() => {});
  const result = await publishReel(videoUrl, finalCaption, creds);
  scheduleR2Cleanup(filename);

  const now = Math.floor(Date.now() / 1000);
  const patchVersion = getActivePatchVersion();
  const logResult = db.insert(publishLog).values({
    accountId: account.id,
    cluster: "quotes",
    caption: finalCaption,
    cardsJson: JSON.stringify(reelCards),
    instagramId: result.id,
    youtubeId: null,
    videoUrl,
    publishedAt: now,
    status: "published",
    source: "auto",
    patchVersion,
    template,
  }).run();

  db.insert(reelsMetrics).values({
    accountId: account.id,
    reelId: result.id,
    publishLogId: Number(logResult.lastInsertRowid),
    patchVersion,
    template,
    topic: `duet_${quote.chapter}_${quote.index}`,
    caption: finalCaption,
    descriptionType: "quote",
    hashtags: "#duet #quotes #hypnotic",
    steveCreeperUsed: 0,
    views: 0, likes: 0, comments: 0, saves: 0, shares: 0, avgWatchTime: 0,
    metricsUpdatedAt: now,
    createdAt: now,
  }).run();

  updateAccountPostingState(account.id);
  upsertState({ running: 1, lastPublishedAt: now });

  return NextResponse.json({
    success: true,
    account: account.name,
    type: "quote_reel",
    quote: quote.text,
    chapter: quote.chapter,
    instagramId: result.id,
  });
}

async function publishTrendReel(
  state: NonNullable<ReturnType<typeof getState>>,
  account: typeof accounts.$inferSelect,
  creds: AccountCredentials,
  opts?: { defaultOnly?: boolean },
) {
  const PRIORITY_CLUSTERS = ["World News", "AI / LLM", "Startups", "Finance"];
  const PAUSED_CLUSTERS = ["Data / DB", "Dev Tools", "Self-hosting", "Programming", "Open Source"];

  const clusterRows = db
    .select({ cluster: trends.cluster })
    .from(trends)
    .groupBy(trends.cluster)
    .all()
    .map((r) => r.cluster)
    .filter(Boolean)
    .filter((c) => !PAUSED_CLUSTERS.includes(c!)) as string[];

  const sortedClusters = [
    ...PRIORITY_CLUSTERS.filter((c) => clusterRows.includes(c)),
    ...clusterRows.filter((c) => !PRIORITY_CLUSTERS.includes(c)),
  ];

  if (sortedClusters.length === 0) {
    return NextResponse.json({ error: "No clusters available" }, { status: 400 });
  }

  const lastCluster = state.currentCluster;
  const idx = lastCluster ? sortedClusters.indexOf(lastCluster) : -1;
  const nextCluster = sortedClusters[(idx + 1) % sortedClusters.length];

  const topTrends = db
    .select()
    .from(trends)
    .where(eq(trends.cluster, nextCluster))
    .orderBy(desc(trends.trendScore))
    .limit(3)
    .all();

  if (topTrends.length === 0) {
    upsertState({ running: 1, currentCluster: nextCluster });
    return NextResponse.json({ error: `No trends in ${nextCluster}`, skipped: true });
  }

  const cards = topTrends.map((t) => ({
    headline: t.term,
    summary: `${t.term} trending with ${t.velocity.toFixed(1)}x velocity across ${t.spread} subreddits`,
    cluster: t.cluster || "Other",
    sentiment: "neutral",
    term: t.term,
  }));

  const currentHeadlines = cards.map((c) => c.headline);

  const lastSameCluster = db
    .select()
    .from(publishLog)
    .where(and(eq(publishLog.cluster, nextCluster), eq(publishLog.source, "auto")))
    .orderBy(desc(publishLog.publishedAt))
    .limit(1)
    .all();

  if (lastSameCluster.length > 0 && lastSameCluster[0].cardsJson) {
    try {
      const prevCards: { headline: string }[] = JSON.parse(lastSameCluster[0].cardsJson);
      const prevHeadlines = prevCards.map((c) => c.headline);

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const check = await openai.chat.completions.create({
        model: "gpt-4.1-nano",
        messages: [{
          role: "user",
          content: `Compare these two sets of trending topics for the "${nextCluster}" cluster. Respond in JSON.

Previous post topics: ${JSON.stringify(prevHeadlines)}
Current topics: ${JSON.stringify(currentHeadlines)}

For each current topic, determine if it's essentially the SAME story/event as any previous topic (even if worded differently).
Return: {"fresh_count": <number of truly new/different topics out of ${currentHeadlines.length}>}`,
        }],
        temperature: 0,
        max_tokens: 100,
        response_format: { type: "json_object" },
      });

      const parsed = JSON.parse(check.choices[0]?.message?.content?.trim() || "{}");
      const freshCount = parsed.fresh_count ?? currentHeadlines.length;
      const threshold = Math.ceil(currentHeadlines.length * 2 / 3);

      if (freshCount < threshold) {
        upsertState({ running: 1, currentCluster: nextCluster });
        return NextResponse.json({
          skipped: true,
          reason: `Only ${freshCount}/${currentHeadlines.length} fresh topics (need ${threshold}). Content too similar to last ${nextCluster} post.`,
          cluster: nextCluster,
        });
      }
    } catch (e) {
      console.error("Freshness check failed, proceeding:", e);
    }
  }

  const descBuilt = await buildReelDescription(cards as unknown[]);

  const autoCount = db.select().from(publishLog).where(eq(publishLog.source, "auto")).all().length;
  const carouselEnabled =
    !opts?.defaultOnly && account.carouselAutoEnabled === 1 && (account.carouselsPerDay ?? 0) > 0;
  const todayStr = new Date().toISOString().slice(0, 10);
  const carouselsToday = carouselEnabled
    ? db.select().from(publishLog).where(and(eq(publishLog.accountId, account.id), eq(publishLog.source, "auto"), eq(publishLog.template, "carousel"))).all().filter(l => new Date(l.publishedAt * 1000).toISOString().slice(0, 10) === todayStr).length
    : 0;
  const isCarouselTurn = carouselEnabled && carouselsToday < account.carouselsPerDay! && autoCount % 3 === 2;

  let template: string;
  if (opts?.defaultOnly) {
    if (getAbTestingEnabled()) {
      template = autoCount % 2 === 0 ? getAbMainTemplate() : getAbTestTemplate();
    } else {
      template = getActiveTemplateSlug();
    }
  } else if (account.template && account.template !== "default") {
    const useAccountAb = account.abTestingEnabled === 1;
    if (useAccountAb && account.abMainTemplate && account.abTestTemplate) {
      template = autoCount % 2 === 0 ? account.abMainTemplate : account.abTestTemplate;
    } else {
      template = account.template;
    }
  } else if (getAbTestingEnabled()) {
    template = autoCount % 2 === 0 ? getAbMainTemplate() : getAbTestTemplate();
  } else {
    template = getActiveTemplateSlug();
  }

  const igEnabled = account.igEnabled === 1;
  const ytEnabled = account.ytEnabled === 1;
  if (!igEnabled && !ytEnabled) {
    return NextResponse.json({ error: "No platforms enabled for this account." }, { status: 400 });
  }

  if (isCarouselTurn && igEnabled) {
    try {
      const carouselTopic = `${nextCluster}: ${topTrends.slice(0, 3).map((t) => t.term).join(", ")}`;
      const { data: carouselData, images } = await generateCarousel(carouselTopic);

      const r2Filenames: string[] = [];
      const imageUrls: string[] = [];
      for (let i = 0; i < images.length; i++) {
        const filename = `auto_carousel_${Date.now()}_${i}.jpg`;
        const url = await uploadImageToR2(images[i], filename);
        r2Filenames.push(filename);
        imageUrls.push(url);
      }

      const result = await publishCarousel(imageUrls, carouselData.caption, creds);

      const now = Math.floor(Date.now() / 1000);
      const patchVersion = getActivePatchVersion();
      const logResult = db.insert(publishLog).values({
        accountId: account.id,
        cluster: nextCluster,
        caption: carouselData.caption,
        cardsJson: JSON.stringify(carouselData.slides.map((s) => ({ hook: s.text_hook, body: s.body_text }))),
        instagramId: result.id,
        youtubeId: null,
        videoUrl: null,
        publishedAt: now,
        status: "published",
        source: "auto",
        patchVersion,
        template: "carousel",
      }).run();

      db.insert(carouselMetrics).values({
        accountId: account.id,
        carouselId: result.id,
        publishLogId: Number(logResult.lastInsertRowid),
        patchVersion,
        topic: carouselTopic,
        caption: carouselData.caption,
        slidesCount: images.length,
        slidesJson: JSON.stringify(carouselData.slides),
        views: 0, likes: 0, comments: 0, saves: 0, shares: 0, reach: 0,
        metricsUpdatedAt: now,
        createdAt: now,
      }).run();

      for (const fn of r2Filenames) scheduleR2Cleanup(fn);

      updateAccountPostingState(account.id);
      upsertState({ running: 1, currentCluster: nextCluster, lastPublishedAt: now });
      return NextResponse.json({ success: true, account: account.name, cluster: nextCluster, instagramId: result.id, type: "carousel" });
    } catch (e) {
      console.error("[AutoPublish Carousel] Failed, falling back to reel:", e);
    }
  }

  let caption = `Trending: ${topTrends.map((t) => t.term).join(", ")}`;
  let bodyOverrides: string[] | undefined;

  if (!descBuilt.error) {
    if (descBuilt.description) caption = descBuilt.description;
    if (descBuilt.sections) {
      bodyOverrides = descBuilt.sections.map((s) => s.body).filter((b): b is string => typeof b === "string");
    }
  }

  let reelCards;
  if (bodyOverrides && bodyOverrides.length === cards.length) {
    reelCards = cards.map((c, i) => ({
      hook: c.headline,
      body: bodyOverrides![i],
      cluster: c.cluster,
      sentiment: c.sentiment,
    }));
  } else {
    reelCards = await shortenForVideo(cards);
  }

  const captionFormatted = formatCaptionForTemplate(template, reelCards, caption);

  const cm2 = account.captionMode || "off";
  setCaptionOverrides({
    junction: cm2 === "generated",
    prepopulated: cm2 === "prepopulated",
    whisperVoice: cm2 !== "off" && account.whisperVoiceEnabled === 1,
  });
  logAutopublishStep("trend_before_generateReel", { template, cluster: nextCluster, defaultOnly: opts?.defaultOnly ?? false });
  let videoBuffer = await generateReelForTemplate(template, reelCards);
  logAutopublishStep("trend_after_generateReel", { template, videoBytes: videoBuffer.length });
  setCaptionOverrides(null);

  const finalCaption = captionFormatted;
  let instagramId: string | null = null;
  let videoUrl: string | null = null;

  const filename = `auto_${nextCluster.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_${Date.now()}.mp4`;
  const tmpDir = mkdtempSync(join(tmpdir(), "autopub-t-"));
  const tmpPath = join(tmpDir, filename.replace(/[^\w.-]/g, "_"));
  const tBytes = videoBuffer.length;
  writeFileSync(tmpPath, videoBuffer);
  videoBuffer = Buffer.alloc(0);
  logAutopublishStep("trend_spilled_to_disk", { videoBytes: tBytes });

  if (igEnabled) {
    logAutopublishStep("trend_before_uploadR2_stream", { videoBytes: tBytes });
    videoUrl = await uploadToR2FromFile(tmpPath, filename);
    const result = await publishReel(videoUrl, finalCaption, creds);
    instagramId = result.id;
    scheduleR2Cleanup(filename);
  }

  let youtubeId: string | null = null;
  if (ytEnabled && isYouTubeConfigured()) {
    try {
      const title = reelCards.map((c) => c.hook).join(" | ").slice(0, 100);
      const tags = (finalCaption.match(/#\w+/g) || []).map((t: string) => t.slice(1)).slice(0, 12);
      const buf = await readFile(tmpPath);
      const yt = await uploadShorts(buf, title, finalCaption, tags);
      youtubeId = yt.id;
    } catch (e) {
      console.error("[YouTube] Upload failed:", e);
    }
  }

  await unlink(tmpPath).catch(() => {});

  if (!instagramId && !youtubeId) {
    return NextResponse.json({ error: "Publish failed for all platforms." }, { status: 500 });
  }

  const now = Math.floor(Date.now() / 1000);
  const patchVersion = getActivePatchVersion();
  const logResult = db.insert(publishLog)
    .values({
      accountId: account.id,
      cluster: nextCluster,
      caption: finalCaption,
      cardsJson: JSON.stringify(cards.map((c) => ({ headline: c.headline, cluster: c.cluster }))),
      instagramId,
      youtubeId,
      videoUrl,
      publishedAt: now,
      status: "published",
      source: "auto",
      patchVersion,
      template,
    })
    .run();

  if (instagramId) {
    createMetricsRecord(instagramId, Number(logResult.lastInsertRowid), finalCaption, nextCluster, "long", template, account.id, false);
  }

  updateAccountPostingState(account.id);
  upsertState({
    running: 1,
    currentCluster: nextCluster,
    lastPublishedAt: now,
  });

  return NextResponse.json({
    success: true,
    account: account.name,
    cluster: nextCluster,
    instagramId,
    youtubeId,
    hostMem: getHostMemSnapshot(),
  });
}

async function publishForDefaultAccount(state: NonNullable<ReturnType<typeof getState>>) {
  const MIN_INTERVAL_MS = 3600000;

  if (state.lastPublishedAt && (Date.now() - state.lastPublishedAt * 1000) < MIN_INTERVAL_MS) {
    const waitMin = Math.ceil((MIN_INTERVAL_MS - (Date.now() - state.lastPublishedAt * 1000)) / 60000);
    return NextResponse.json({
      skipped: true,
      reason: `Too soon. Next in ~${waitMin}min.`,
    });
  }

  const defaultCreds: AccountCredentials = {
    accessToken: process.env.INSTAGRAM_ACCESS_TOKEN!,
    userId: process.env.INSTAGRAM_USER_ID!,
  };
  const fakeAccount = {
    id: "default",
    name: "Default",
    template: "default",
    niche: "trends",
  } as typeof accounts.$inferSelect;

  return publishTrendReel(state, fakeAccount, defaultCreds);
}
