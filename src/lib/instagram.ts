import { createReadStream } from "fs";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

const GRAPH_API = "https://graph.instagram.com/v25.0";

let _s3: S3Client | null = null;
function getS3(): S3Client {
  if (!_s3) {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const keyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
    const secret = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
    if (!accountId || !keyId || !secret) {
      throw new Error("R2 env missing: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY");
    }
    _s3 = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: keyId, secretAccessKey: secret },
    });
  }
  return _s3;
}

export interface AccountCredentials {
  accessToken: string;
  userId: string;
}

function resolveCredentials(account?: AccountCredentials): AccountCredentials {
  return {
    accessToken: account?.accessToken || process.env.INSTAGRAM_ACCESS_TOKEN!,
    userId: account?.userId || process.env.INSTAGRAM_USER_ID!,
  };
}

export async function uploadToR2(buffer: Buffer, filename: string): Promise<string> {
  await getS3().send(
    new PutObjectCommand({
      Bucket: process.env.CLOUDFLARE_R2_BUCKET!,
      Key: filename,
      Body: buffer,
      ContentType: "video/mp4",
    }),
  );
  return `${process.env.CLOUDFLARE_R2_PUBLIC_URL}/${filename}`;
}

/** Upload from disk — avoids holding the full mp4 in the Node heap during PutObject (helps 512MB containers). */
export async function uploadToR2FromFile(filePath: string, filename: string): Promise<string> {
  await getS3().send(
    new PutObjectCommand({
      Bucket: process.env.CLOUDFLARE_R2_BUCKET!,
      Key: filename,
      Body: createReadStream(filePath),
      ContentType: "video/mp4",
    }),
  );
  return `${process.env.CLOUDFLARE_R2_PUBLIC_URL}/${filename}`;
}

async function igFetch(path: string, token: string, opts?: RequestInit) {
  const url = path.startsWith("http") ? path : `${GRAPH_API}${path}`;
  const sep = url.includes("?") ? "&" : "?";
  const res = await fetch(`${url}${sep}access_token=${token}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(`Instagram API ${res.status}: ${JSON.stringify(data.error || data)}`);
  return data;
}

export async function publishReel(videoUrl: string, caption: string, account?: AccountCredentials): Promise<{ id: string }> {
  const { accessToken, userId } = resolveCredentials(account);

  const container = await igFetch(`/${userId}/media`, accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      media_type: "REELS",
      video_url: videoUrl,
      caption,
    }),
  });

  const containerId: string = container.id;

  let status = "IN_PROGRESS";
  let attempts = 0;
  while (status === "IN_PROGRESS" && attempts < 60) {
    await new Promise((r) => setTimeout(r, 3000));
    const check = await igFetch(`/${containerId}?fields=status_code`, accessToken);
    status = check.status_code;
    attempts++;
  }

  if (status !== "FINISHED") {
    throw new Error(`Container processing failed: status=${status} after ${attempts} polls`);
  }

  const publish = await igFetch(`/${userId}/media_publish`, accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ creation_id: containerId }),
  });

  return { id: publish.id };
}

export async function uploadImageToR2(buffer: Buffer, filename: string): Promise<string> {
  await getS3().send(
    new PutObjectCommand({
      Bucket: process.env.CLOUDFLARE_R2_BUCKET!,
      Key: filename,
      Body: buffer,
      ContentType: "image/jpeg",
    }),
  );
  return `${process.env.CLOUDFLARE_R2_PUBLIC_URL}/${filename}`;
}

export async function publishCarousel(imageUrls: string[], caption: string, account?: AccountCredentials): Promise<{ id: string }> {
  const { accessToken, userId } = resolveCredentials(account);

  const childIds: string[] = [];
  for (const url of imageUrls) {
    const item = await igFetch(`/${userId}/media`, accessToken, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        image_url: url,
        is_carousel_item: "true",
      }),
    });
    childIds.push(item.id);
  }

  const waitForChild = async (childId: string): Promise<void> => {
    for (let i = 0; i < 30; i++) {
      const data = await igFetch(`/${childId}?fields=status_code`, accessToken);
      const s = data.status_code ?? "IN_PROGRESS";
      if (s === "FINISHED") return;
      if (s === "ERROR" || s === "EXPIRED") throw new Error(`Child ${childId} failed: ${s}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`Child ${childId} timed out`);
  };

  for (const cid of childIds) await waitForChild(cid);

  const container = await igFetch(`/${userId}/media`, accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      media_type: "CAROUSEL",
      children: childIds.join(","),
      caption,
    }),
  });

  const containerId: string = container.id;
  if (!containerId || containerId === "0") {
    throw new Error(`Carousel container creation failed: invalid id. Response: ${JSON.stringify(container)}`);
  }

  let status = "IN_PROGRESS";
  let attempts = 0;
  while (status === "IN_PROGRESS" && attempts < 60) {
    await new Promise((r) => setTimeout(r, 3000));
    const check = await igFetch(`/${containerId}?fields=status_code`, accessToken);
    status = check.status_code ?? "IN_PROGRESS";
    attempts++;
  }

  if (status !== "FINISHED") {
    throw new Error(`Carousel processing failed: status=${status} after ${attempts} polls`);
  }

  const publish = await igFetch(`/${userId}/media_publish`, accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ creation_id: containerId }),
  });

  return { id: publish.id };
}

export function scheduleR2Cleanup(filename: string, delayMs = 600000) {
  setTimeout(async () => {
    try {
      await getS3().send(
        new DeleteObjectCommand({
          Bucket: process.env.CLOUDFLARE_R2_BUCKET!,
          Key: filename,
        }),
      );
      console.log(`[R2] Deleted ${filename}`);
    } catch (e) {
      console.error(`[R2] Failed to delete ${filename}:`, e);
    }
  }, delayMs);
}

export interface ReelInsights {
  views: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  avgWatchTime: number;
}

export async function getReelInsights(mediaId: string, account?: AccountCredentials): Promise<ReelInsights> {
  const { accessToken } = resolveCredentials(account);
  const metrics = "views,likes,comments,saved,shares,ig_reels_avg_watch_time";
  const data = await igFetch(`/${mediaId}/insights?metric=${metrics}`, accessToken);

  const result: ReelInsights = { views: 0, likes: 0, comments: 0, saves: 0, shares: 0, avgWatchTime: 0 };

  for (const item of data.data || []) {
    const val = item.values?.[0]?.value ?? 0;
    switch (item.name) {
      case "views": result.views = val; break;
      case "likes": result.likes = val; break;
      case "comments": result.comments = val; break;
      case "saved": result.saves = val; break;
      case "shares": result.shares = val; break;
      case "ig_reels_avg_watch_time": result.avgWatchTime = val; break;
    }
  }
  return result;
}

export async function getBasicMediaMetrics(mediaId: string, account?: AccountCredentials): Promise<{ likes: number; comments: number }> {
  const { accessToken } = resolveCredentials(account);
  const data = await igFetch(`/${mediaId}?fields=like_count,comments_count`, accessToken);
  return { likes: data.like_count || 0, comments: data.comments_count || 0 };
}

export async function exchangeForLongLivedToken(shortToken: string): Promise<string> {
  const res = await fetch(
    `${GRAPH_API}/access_token?grant_type=ig_exchange_token&client_secret=${process.env.INSTAGRAM_APP_SECRET}&access_token=${shortToken}`,
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`Token exchange failed: ${JSON.stringify(data.error || data)}`);
  return data.access_token;
}
