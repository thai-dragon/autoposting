import {
  shortenForVideo,
  generateReelForTemplate,
  formatCaptionForTemplate,
  setCaptionOverrides,
} from "@tt/lib/reel";
import { uploadToR2, publishReel, scheduleR2Cleanup } from "@tt/lib/instagram";
import type { syncedAccounts } from "@/db/schema";

export type SyncedAccount = typeof syncedAccounts.$inferSelect;

function applyCaptionOverrides(acc: SyncedAccount) {
  const cm = acc.captionMode || "off";
  setCaptionOverrides({
    junction: cm === "generated",
    prepopulated: cm === "prepopulated",
    whisperVoice: cm !== "off" && acc.whisperVoiceEnabled === 1,
  });
}

export async function generateAndPublishVideo(opts: {
  account: SyncedAccount;
  headline: string;
  summary: string;
  caption: string;
  publishToInstagram: boolean;
}): Promise<{
  videoUrl: string;
  finalCaption: string;
  instagramId?: string;
}> {
  const { account, headline, summary, caption, publishToInstagram } = opts;

  if (account.igEnabled !== 1 && publishToInstagram) {
    throw new Error("Instagram is disabled for this account in the sync snapshot");
  }

  const template = account.template?.trim() || "forest";

  try {
    applyCaptionOverrides(account);
    const forShorten = [
      {
        headline: headline.trim(),
        summary: summary.trim() || headline.trim(),
        cluster: account.niche || "trends",
        sentiment: "neutral",
      },
    ];
    const reelCards = await shortenForVideo(forShorten);
    const buf = await generateReelForTemplate(template, reelCards);
    setCaptionOverrides(null);

    const finalCaption = formatCaptionForTemplate(template, reelCards, caption);
    const filename = `autopost_${Date.now()}.mp4`;
    const videoUrl = await uploadToR2(Buffer.from(buf), filename);
    scheduleR2Cleanup(filename);

    if (!publishToInstagram) {
      return { videoUrl, finalCaption };
    }

    const result = await publishReel(videoUrl, finalCaption, {
      accessToken: account.accessToken,
      userId: account.userId,
    });
    return { videoUrl, finalCaption, instagramId: result.id };
  } catch (e) {
    setCaptionOverrides(null);
    throw e;
  }
}
