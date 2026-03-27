/**
 * YouTube Shorts upload via Data API v3.
 * Env: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN
 */

let cachedAccessToken: string | null = null;

export function clearYouTubeTokenCache(): void {
  cachedAccessToken = null;
}

async function getAccessToken(): Promise<string> {
  if (cachedAccessToken) return cachedAccessToken;

  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error("YOUTUBE_REFRESH_TOKEN not set. Run: pnpm get-youtube-token");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.YOUTUBE_CLIENT_ID!,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const data = await res.json();
  if (data.error) throw new Error(`YouTube token refresh failed: ${data.error}`);
  cachedAccessToken = data.access_token ?? null;
  if (!cachedAccessToken) throw new Error("YouTube token refresh: no access_token");
  return cachedAccessToken;
}

export async function uploadShorts(
  videoBuffer: Buffer,
  title: string,
  description: string,
  tags: string[] = [],
): Promise<{ id: string; url: string }> {
  const token = await getAccessToken();

  const metadata = {
    snippet: {
      title: title.slice(0, 100),
      description: description.slice(0, 5000),
      tags: (Array.isArray(tags) ? tags : []).slice(0, 50),
      categoryId: "22", // People & Blogs
    },
    status: {
      privacyStatus: "public",
      selfDeclaredMadeForKids: false,
    },
  };

  const boundary = "youtube_upload_" + Date.now();
  const metaPart =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`;
  const body = Buffer.concat([
    Buffer.from(metaPart, "utf-8"),
    videoBuffer,
    Buffer.from(`\r\n--${boundary}--`, "utf-8"),
  ]);

  const initRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
        "Content-Length": String(body.length),
      },
      body,
    },
  );

  if (!initRes.ok) {
    const err = await initRes.text();
    if (initRes.status === 401) {
      cachedAccessToken = null;
      const retryToken = await getAccessToken();
      const retryRes = await fetch(
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${retryToken}`,
            "Content-Type": `multipart/related; boundary=${boundary}`,
            "Content-Length": String(body.length),
          },
          body,
        },
      );
      if (retryRes.ok) {
        const retryResult = await retryRes.json();
        if (retryResult.id) {
          return { id: retryResult.id, url: `https://www.youtube.com/shorts/${retryResult.id}` };
        }
      }
    }
    const hint = initRes.status === 401 ? " Token expired/revoked. Run: pnpm get-youtube-token" : "";
    throw new Error(`YouTube upload failed: ${initRes.status} ${err}${hint}`);
  }

  const result = await initRes.json();
  const videoId = result.id;
  if (!videoId) throw new Error("YouTube upload: no video id in response");

  return {
    id: videoId,
    url: `https://www.youtube.com/shorts/${videoId}`,
  };
}

export function isYouTubeConfigured(): boolean {
  return !!(
    process.env.YOUTUBE_CLIENT_ID &&
    process.env.YOUTUBE_CLIENT_SECRET &&
    process.env.YOUTUBE_REFRESH_TOKEN
  );
}
