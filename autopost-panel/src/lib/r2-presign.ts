import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomBytes } from "crypto";

function client(): S3Client {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const keyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secret = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  if (!accountId || !keyId || !secret) {
    throw new Error("R2 env missing");
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: keyId, secretAccessKey: secret },
  });
}

export async function presignVideoUpload(): Promise<{
  uploadUrl: string;
  publicUrl: string;
  key: string;
}> {
  const bucket = process.env.CLOUDFLARE_R2_BUCKET;
  const base = process.env.CLOUDFLARE_R2_PUBLIC_URL?.replace(/\/$/, "");
  if (!bucket || !base) throw new Error("CLOUDFLARE_R2_BUCKET or CLOUDFLARE_R2_PUBLIC_URL missing");

  const key = `autopost/${Date.now()}_${randomBytes(6).toString("hex")}.mp4`;
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: "video/mp4",
  });
  const uploadUrl = await (getSignedUrl as (a: unknown, b: unknown, o: object) => Promise<string>)(
    client(),
    cmd,
    { expiresIn: 3600 },
  );
  const publicUrl = `${base}/${key}`;
  return { uploadUrl, publicUrl, key };
}
