import { createWriteStream, existsSync, mkdirSync, statSync } from "fs";
import { resolve, dirname } from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

function reelAssetsRoot(): string {
  return process.env.TT_REPO_ROOT
    ? resolve(process.env.TT_REPO_ROOT)
    : resolve(process.cwd());
}

export type ReelAssetsManifest = {
  version: number;
  files: { path: string; bytes: number }[];
};

function manifestBaseUrl(manifestUrl: string): string {
  return manifestUrl.replace(/\/manifest\.json\/?$/i, "").replace(/\/$/, "");
}

function filePublicUrl(base: string, relPath: string): string {
  const seg = relPath.split("/").map(encodeURIComponent).join("/");
  return `${base.replace(/\/$/, "")}/${seg}`;
}

/** If TT_REEL_ASSETS_MANIFEST_URL is set, download missing/stale files under TT_REPO_ROOT (same layout as repo assets/). */
export async function ensureReelAssetsFromManifest(): Promise<void> {
  const manifestUrl = process.env.TT_REEL_ASSETS_MANIFEST_URL?.trim();
  if (!manifestUrl) return;

  const base =
    process.env.TT_REEL_ASSETS_BASE_URL?.trim() || manifestBaseUrl(manifestUrl);
  const res = await fetch(manifestUrl);
  if (!res.ok) throw new Error(`reel assets manifest HTTP ${res.status}`);
  const manifest = JSON.parse(await res.text()) as ReelAssetsManifest;
  if (!manifest.files?.length) throw new Error("reel assets manifest: no files");

  const root = reelAssetsRoot();
  for (const f of manifest.files) {
    const dest = resolve(root, f.path);
    if (existsSync(dest) && statSync(dest).size === f.bytes) continue;
    mkdirSync(dirname(dest), { recursive: true });
    const url = filePublicUrl(base, f.path);
    const fr = await fetch(url);
    if (!fr.ok) throw new Error(`reel asset ${f.path}: HTTP ${fr.status} (${url})`);
    if (!fr.body) throw new Error(`reel asset ${f.path}: empty body`);
    const write = createWriteStream(dest);
    await pipeline(Readable.fromWeb(fr.body as Parameters<typeof Readable.fromWeb>[0]), write);
    if (!existsSync(dest) || statSync(dest).size !== f.bytes) {
      throw new Error(`reel asset ${f.path}: size mismatch after download`);
    }
  }
}
