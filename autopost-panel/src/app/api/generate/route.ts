import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { videoQueue } from "@/db/schema";
import {
  shortenForVideo,
  generateReelForTemplate,
  formatCaptionForTemplate,
  setCaptionOverrides,
} from "@tt/lib/reel";
import { uploadToR2, publishReel, scheduleR2Cleanup } from "@tt/lib/instagram";
import { requirePanelToken } from "@/lib/auth";
import { getMainAccount, resolvePanelReelTemplate } from "@/lib/main-db";
import { ensureReelAssetsFromManifest } from "@tt/lib/reel-assets-sync";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const deny = requirePanelToken(req);
  if (deny) return deny;

  const body = await req.json();
  const {
    accountId,
    headline,
    summary,
    caption = "",
    publishNow = true,
    addToQueue = false,
  } = body as {
    accountId?: string;
    headline?: string;
    summary?: string;
    caption?: string;
    publishNow?: boolean;
    addToQueue?: boolean;
  };

  if (!accountId || !headline?.trim()) {
    return NextResponse.json(
      { error: "accountId and headline required" },
      { status: 400 },
    );
  }

  const acc = getMainAccount(accountId);
  if (!acc) {
    return NextResponse.json({ error: "account not found" }, { status: 404 });
  }

  try {
    await ensureReelAssetsFromManifest();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `reel assets sync: ${msg}` }, { status: 500 });
  }

  const template = resolvePanelReelTemplate(accountId);

  let reelCards;
  try {
    const cm = acc.captionMode || "off";
    setCaptionOverrides({
      junction: cm === "generated",
      prepopulated: cm === "prepopulated",
      whisperVoice: cm !== "off" && acc.whisperVoiceEnabled === 1,
    });

    const forShorten = [
      {
        headline: headline.trim(),
        summary: (summary ?? headline).trim(),
        cluster: acc.niche || "trends",
        sentiment: "neutral",
      },
    ];
    reelCards = await shortenForVideo(forShorten);

    const buf = await generateReelForTemplate(template, reelCards);
    setCaptionOverrides(null);

    const finalCaption = formatCaptionForTemplate(template, reelCards, caption);
    const filename = `autopost_gen_${Date.now()}.mp4`;
    const videoUrl = await uploadToR2(Buffer.from(buf), filename);
    scheduleR2Cleanup(filename);

    const now = Math.floor(Date.now() / 1000);

    if (publishNow) {
      if (acc.igEnabled !== 1) {
        return NextResponse.json(
          { error: "Instagram disabled for this account in triangulation" },
          { status: 400 },
        );
      }
      const result = await publishReel(videoUrl, finalCaption, {
        accessToken: acc.accessToken,
        userId: acc.userId,
      });
      return NextResponse.json({
        ok: true,
        template,
        videoUrl,
        caption: finalCaption,
        instagramId: result.id,
      });
    }

    if (addToQueue) {
      db.insert(videoQueue)
        .values({
          accountId,
          r2Key: filename,
          publicUrl: videoUrl,
          caption: finalCaption,
          status: "pending",
          createdAt: now,
        })
        .run();
    }

    return NextResponse.json({
      ok: true,
      template,
      videoUrl,
      caption: finalCaption,
      queued: addToQueue,
    });
  } catch (e) {
    setCaptionOverrides(null);
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[autopost-panel generate]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
