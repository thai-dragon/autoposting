import { writeFileSync, readFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { eq } from "drizzle-orm";

const ROOT = join(process.cwd());
const STEVE_DIR = join(ROOT, "steve-creeper-game");
const STEVE_CREEPER_TOTAL_KEY = "steve_creeper_total";

function getSteveCreeperTotal(): number {
  const row = db.select().from(appSettings).where(eq(appSettings.key, STEVE_CREEPER_TOTAL_KEY)).all()[0];
  return row ? parseInt(row.value, 10) || 0 : 0;
}

function setSteveCreeperTotal(n: number): void {
  const now = Math.floor(Date.now() / 1000);
  const existing = db.select().from(appSettings).where(eq(appSettings.key, STEVE_CREEPER_TOTAL_KEY)).all()[0];
  if (existing) {
    db.update(appSettings).set({ value: String(n), updatedAt: now }).where(eq(appSettings.key, STEVE_CREEPER_TOTAL_KEY)).run();
  } else {
    db.insert(appSettings).values({ key: STEVE_CREEPER_TOTAL_KEY, value: String(n), updatedAt: now }).run();
  }
}

/**
 * Applies Steve Creeper Game overlay to a video buffer.
 * Requires: puppeteer in steve-creeper-game, ffmpeg in PATH.
 * Returns the overlay video as MP4 buffer, or throws on failure.
 */
export async function applySteveCreeperOverlay(videoBuffer: Buffer): Promise<Buffer> {
  const tmpDir = join(ROOT, "tmp");
  const inputPath = join(tmpDir, `steve-input-${Date.now()}.mp4`);
  const outputPath = join(tmpDir, `steve-output-${Date.now()}.mp4`);
  const totalFile = join(tmpDir, "steve-creeper-total.json");

  try {
    const { mkdirSync } = await import("fs");
    try {
      mkdirSync(tmpDir, { recursive: true });
    } catch {}

    writeFileSync(inputPath, videoBuffer);
    const initialTotal = getSteveCreeperTotal();
    writeFileSync(totalFile, JSON.stringify({ total: initialTotal }));

    const scriptPath = join(STEVE_DIR, "generate-from-input.js");
    if (!existsSync(scriptPath)) {
      throw new Error("steve-creeper-game/generate-from-input.js not found");
    }

    try {
      execSync(`node "${scriptPath}" --input "${inputPath}" --output "${outputPath}" --total-file "${totalFile}"`, {
        cwd: STEVE_DIR,
        stdio: "pipe",
        timeout: 120000,
        encoding: "utf8",
      });
    } catch (e) {
      const err = e as { stderr?: string; stdout?: string; message?: string };
      console.error("[Steve Creeper] Script failed:", err.message);
      if (err.stderr) console.error("[Steve Creeper] stderr:", err.stderr);
      if (err.stdout) console.error("[Steve Creeper] stdout:", err.stdout);
      throw e;
    }

    if (!existsSync(outputPath)) {
      throw new Error("Steve Creeper overlay failed: no output file");
    }

    const result = readFileSync(outputPath);
    if (existsSync(totalFile)) {
      try {
        const { total } = JSON.parse(readFileSync(totalFile, "utf8"));
        if (typeof total === "number") setSteveCreeperTotal(total);
      } catch {}
      try {
        unlinkSync(totalFile);
      } catch {}
    }
    return result;
  } finally {
    try {
      unlinkSync(inputPath);
    } catch {}
    try {
      unlinkSync(outputPath);
    } catch {}
  }
}
