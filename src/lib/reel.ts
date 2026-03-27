import { writeFileSync, existsSync, readdirSync, unlinkSync, mkdirSync } from "fs";
import { resolve } from "path";
import { execSync, execFileSync } from "child_process";
import OpenAI from "openai";
import { getJunctionCaptionsEnabled, getPrepopulatedCaptionsEnabled, getWhisperVoiceEnabled } from "./app-settings";
import { DUET_QUOTES } from "./duet-quotes-data";
import { isCatsTemplate, isForestTemplate, isRobloxTemplate } from "./template-slugs";

/** Monorepo / Docker: set to repo root so assets/tmp resolve when cwd is a subfolder (e.g. autopost-panel). */
const ROOT = process.env.TT_REPO_ROOT
  ? resolve(process.env.TT_REPO_ROOT)
  : resolve(process.cwd());
const TMP_DIR = resolve(ROOT, "tmp/reels");
const MUSIC_DIR = resolve(ROOT, "assets/music");
const GAMEPLAY_DIR = resolve(ROOT, "assets/gameplay");
const FOREST_VIDEO = resolve(ROOT, "assets/forest-video/forest.mp4");
const ROBLOX_VIDEO = resolve(ROOT, "assets/gameplay/roblox.mp4");
const CATS_VIDEO = resolve(ROOT, "assets/cats-video/cats_video.mp4");
const CAT_SOUND = resolve(ROOT, "assets/sounds/cat-sound.mp4");
const IDEA_22 = resolve(ROOT, "assets/sounds/idea_22.mp3");
const VIDEO_WIDTH = 1080;
const CARD_HEIGHT = 960;
const GAMEPLAY_HEIGHT = 960;
const GAP_SEC = 0.7;
const JUNCTION_STRIP_H = 48;
const JUNCTION_STRIP_TOP = CARD_HEIGHT - JUNCTION_STRIP_H / 2;
const BOTTOM_CROP_TOP = CARD_HEIGHT + JUNCTION_STRIP_H / 2;

export interface ReelCard {
  hook: string;
  body: string;
  cluster: string;
  sentiment: string;
}

export interface ReelResult {
  filePath: string;
  duration: number;
}

function ensureTmpDir() {
  mkdirSync(TMP_DIR, { recursive: true });
}

async function generateJunctionText(_cards: ReelCard[], _duration: number): Promise<{ parts: string[] }> {
  const JUNCTION_FALLBACKS: [string, string][] = [
    ["Hard pill", "to swallow"],
    ["Stop chasing", "start attracting"],
    ["POV: You", "finally realized"],
    ["Psychology fact", "#38 will shock"],
    ["Nobody cares", "work harder"],
    ["Your circle", "defines you"],
    ["Read this", "twice now"],
    ["Silence is", "the best reply"],
  ];

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const [p1, p2] = JUNCTION_FALLBACKS[Math.floor(Math.random() * JUNCTION_FALLBACKS.length)];
    return { parts: [p1, p2] };
  }

  try {
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `You are a viral content expert. Generate a 2-part text overlay for a short video (Reel/TikTok).

GOAL: Convert VIEWERS into FOLLOWERS. The text must be "Save-worthy" or "Share-worthy".

STRATEGY (Use one of these):
1. THE TRUTH BOMB: A harsh reality check.
2. THE IDENTITY HACK: Something relatable regarding anxiety, success, or introversion.
3. THE MYSTERY: A partial sentence that creates a curiosity gap.

EXAMPLES OF WHAT I WANT:
- ["If you ignore", "you lose"] (FOMO)
- ["Cheat code", "for real life"] (Value)
- ["People change", "memories don't"] (Melancholy/Relatable -> High Likes)
- ["Stop telling", "start showing"] (Strong stance)

BAD EXAMPLES (DO NOT USE):
- ["Be happy", "smile more"] (Too generic, weak)
- ["Good vibes", "only here"] (Boring)

RULES:
- Part 1: 1-3 words (The Hook)
- Part 2: 2-5 words (The Punchline)
- MAX 15 chars per part.
- NO cheesy motivation. Be dark, direct, or factual.

Return JSON: {"parts":["...","..."]}`,
        },
      ],
      temperature: 1.1,
      max_tokens: 120,
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content?.trim() || "";
    const parsed = JSON.parse(raw);
    const parts = Array.isArray(parsed.parts)
      ? parsed.parts.map((p: unknown) => String(p).trim())
      : null;

    if (parts && parts.length === 2 && parts.every((s: string) => s.length > 0)) return { parts };
  } catch (e) {
    console.error("Hook gen failed", e);
  }

  const [p1, p2] = JUNCTION_FALLBACKS[Math.floor(Math.random() * JUNCTION_FALLBACKS.length)];
  return { parts: [p1, p2] };
}

function getPrepopulatedJunctionText(): { parts: string[] } {
  const allQuotes: { chapter: string; text: string }[] = [];
  for (const [chapter, quotes] of Object.entries(DUET_QUOTES)) {
    for (const text of quotes) allQuotes.push({ chapter, text });
  }
  const q = allQuotes[Math.floor(Math.random() * allQuotes.length)];
  const words = q.text.split(/\s+/);
  const mid = Math.ceil(words.length / 2);
  return { parts: [words.slice(0, mid).join(" "), words.slice(mid).join(" ")] };
}

let _captionOverrides: { junction: boolean; prepopulated: boolean; whisperVoice?: boolean } | null = null;
export function setCaptionOverrides(overrides: { junction: boolean; prepopulated: boolean; whisperVoice?: boolean } | null) {
  _captionOverrides = overrides;
}

async function getJunctionParts(cards: ReelCard[], duration: number): Promise<{ parts: string[] } | null> {
  const usePrepop = _captionOverrides ? _captionOverrides.prepopulated : getPrepopulatedCaptionsEnabled();
  const useJunction = _captionOverrides ? _captionOverrides.junction : getJunctionCaptionsEnabled();
  if (usePrepop) return getPrepopulatedJunctionText();
  if (useJunction) return generateJunctionText(cards, duration);
  return null;
}

function escapeDrawtext(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "''").replace(/:/g, "\\:");
}

function escapeAlpha(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/,/g, "\\,");
}

function buildJunctionBlurFilter(out: "v" | "vblur", useBlur: boolean): string {
  const topH = JUNCTION_STRIP_TOP;
  const botH = CARD_HEIGHT * 2 - BOTTOM_CROP_TOP;
  const juncFilter = useBlur ? "[junc]gblur=sigma=12[juncb]" : "[junc]copy[juncb]";
  return `[v1]split=3[v0][v1a][v2];[v0]crop=iw:${topH}:0:0[top];[v1a]crop=iw:${JUNCTION_STRIP_H}:0:${topH}[junc];[v2]crop=iw:${botH}:0:${BOTTOM_CROP_TOP}[bot];${juncFilter};[top][juncb][bot]vstack=inputs=3[${out}]`;
}

function wrapJunctionText(text: string, maxChars = 14): string[] {
  if (text.length <= maxChars) return [text];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** UTF-8 body written to drawtext textfile= (real newlines only; avoids filter-graph \\n escaping bugs). */
export function junctionPartToTextfileContent(part: string): string {
  return wrapJunctionText(part).map((line) => line.toUpperCase()).join("\n");
}

function resolveJunctionMontserratFont(): string | null {
  const candidates = [
    resolve(ROOT, "assets/fonts/Montserrat-Bold.ttf"),
    resolve(ROOT, "assets/fonts/Montserrat.ttf"),
    resolve(ROOT, "assets/fonts/Montserrat-Black.ttf"),
    resolve(ROOT, "assets/fonts/Montserrat-Regular.ttf"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function escapePathForDrawtextTextfile(absPath: string): string {
  return absPath.replace(/\\/g, "/").replace(/'/g, "'\\''");
}

/**
 * Junction strip text: white on semi-transparent black plate (box), bold sans, no text stroke.
 * Multiline text is written to temp files and passed via drawtext=textfile= so newlines are never parsed through filter_graph (avoids literal "n" bugs with shell vs argv escaping).
 */
export function buildJunctionDrawtextFilter(
  parts: string[],
  duration: number,
  inputLabel: string,
  scratchPrefix: string,
  junkFiles: string[],
): string {
  ensureTmpDir();
  const fontPath = resolveJunctionMontserratFont();
  const fontOpt = fontPath ? `fontfile='${fontPath.replace(/'/g, "'\\''")}':` : "";
  const base = `${fontOpt}fontcolor=white:fontsize=72:box=1:boxcolor=black@0.6:boxborderw=10|20:line_spacing=8:x=(w-text_w)/2:y=(h-text_h)/2`;
  const tFade = 0.4;
  const segDur = Math.max(2, (duration - 2) / parts.length);
  const chains: string[] = [];
  let prevLabel = inputLabel;
  for (let i = 0; i < parts.length; i++) {
    const tStart = 0.5 + i * segDur;
    const tEnd = Math.min(0.5 + (i + 1) * segDur, duration - 1);
    const txtPath = resolve(TMP_DIR, `${scratchPrefix}_junction_${i}.txt`);
    writeFileSync(txtPath, junctionPartToTextfileContent(parts[i]), "utf8");
    junkFiles.push(txtPath);
    const pathQ = escapePathForDrawtextTextfile(txtPath);
    const a = escapeAlpha(`if(lt(t,${tStart}),0,if(lt(t,${tStart + tFade}),(t-${tStart})/${tFade},if(lt(t,${tEnd - tFade}),1,if(lt(t,${tEnd}),(${tEnd}-t)/${tFade},0))))`);
    const nextPartLabel = i < parts.length - 1 ? `v${i + 2}` : "v";
    chains.push(
      `[${prevLabel}]drawtext=textfile='${pathQ}':${base}:enable='between(t,${tStart},${tEnd})':alpha='${a}'[${nextPartLabel}]`,
    );
    prevLabel = nextPartLabel;
  }
  return chains.join(";");
}

// GPT: shorten pulse card summaries for video
export async function shortenForVideo(
  cards: { headline: string; summary: string; cluster: string; sentiment: string }[],
): Promise<ReelCard[]> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const input = cards.map((c, i) =>
    `${i + 1}. [${c.cluster}] "${c.headline}": ${c.summary}`,
  ).join("\n");

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-nano",
    messages: [{
      role: "user",
      content: `Rewrite these trend summaries for a short Instagram Reel voiceover.

${input}

For EACH item return:
- "hook": the headline as-is or slightly shortened (max 8 words, Title Case)
- "body": ONE punchy sentence, max 15 words. Key fact only, no fluff.
- "cluster": keep as-is
- "sentiment": keep as-is

Return JSON: {"items":[{"hook":"...","body":"...","cluster":"...","sentiment":"..."},...]}`,
    }],
    temperature: 0.5,
    max_tokens: 600,
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content?.trim() || "";
  const parsed = JSON.parse(raw);
  const items: ReelCard[] = Array.isArray(parsed) ? parsed : parsed.items ?? [parsed];
  return items.slice(0, cards.length);
}

// OpenAI TTS voiceover
export async function generateVoice(text: string, outputPath: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const duration = Math.ceil(text.length / 14);
    execSync(`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t ${duration} "${outputPath}"`);
    return;
  }

  const openai = new OpenAI({ apiKey });
  try {
    const response = await openai.audio.speech.create({
      model: "tts-1",
      voice: "echo",
      input: text,
      response_format: "mp3",
      speed: 1.05,
    });

    writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    console.error("OpenAI TTS failed, generating silent audio:", e);
    const duration = Math.ceil(text.length / 14);
    execSync(`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t ${duration} "${outputPath}"`);
  }
}

export async function generateWhisperVoice(text: string, outputPath: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    try {
      const openai = new OpenAI({ apiKey });
      const response = await openai.audio.speech.create({
        model: "gpt-4o-mini-tts-2025-12-15",
        voice: "marin",
        input: text,
        instructions:
          "Speak in a soft, intimate whisper. Like an ASMR or meditation guide — breathy, calm, unhurried. Pause between phrases. This is a poetic quote; deliver it with reverence and quiet intensity.",
        response_format: "mp3",
      });
      writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
      return;
    } catch (e) {
      console.warn("OpenAI whisper failed, falling back to ElevenLabs:", e);
    }
  }

  const elevenKey = process.env.ELEVENLABS_API_KEY;
  if (elevenKey) {
    try {
      const voiceId = process.env.ELEVENLABS_WHISPER_VOICE_ID || "j05EIz3iI3JmBTWC3CsA";
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: { "xi-api-key": elevenKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            model_id: "eleven_turbo_v2_5",
            voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.6 },
          }),
        },
      );
      if (res.ok) {
        writeFileSync(outputPath, Buffer.from(await res.arrayBuffer()));
        return;
      }
      console.warn("ElevenLabs whisper failed:", res.status, await res.text());
    } catch (e) {
      console.warn("ElevenLabs whisper failed:", e);
    }
  }

  const duration = Math.ceil(text.length / 10);
  execSync(`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t ${duration} "${outputPath}"`);
}

export function getAudioDuration(filePath: string): number {
  return parseFloat(
    execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${filePath}"`).toString().trim(),
  );
}

// Canvas card image
export async function generateCardImage(opts: {
  hook: string;
  body: string;
  cluster: string;
  index: number;
  total: number;
  outputPath: string;
}) {
  const { createCanvas } = await import("@napi-rs/canvas");

  const W = VIDEO_WIDTH;
  const H = CARD_HEIGHT;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, "#0f172a");
  bgGrad.addColorStop(0.5, "#0d1117");
  bgGrad.addColorStop(1, "#161b22");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  const pad = 48;
  const centerX = W / 2;
  const cardX = 24, cardY = 20, cardW = W - 48, cardH = H - 40, radius = 20;

  ctx.fillStyle = "rgba(22, 27, 34, 0.85)";
  ctx.beginPath();
  ctx.moveTo(cardX + radius, cardY);
  ctx.lineTo(cardX + cardW - radius, cardY);
  ctx.quadraticCurveTo(cardX + cardW, cardY, cardX + cardW, cardY + radius);
  ctx.lineTo(cardX + cardW, cardY + cardH - radius);
  ctx.quadraticCurveTo(cardX + cardW, cardY + cardH, cardX + cardW - radius, cardY + cardH);
  ctx.lineTo(cardX + radius, cardY + cardH);
  ctx.quadraticCurveTo(cardX, cardY + cardH, cardX, cardY + cardH - radius);
  ctx.lineTo(cardX, cardY + radius);
  ctx.quadraticCurveTo(cardX, cardY, cardX + radius, cardY);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(88, 166, 255, 0.3)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const accentGrad = ctx.createLinearGradient(cardX + pad, 0, cardX + cardW - pad, 0);
  accentGrad.addColorStop(0, "rgba(88, 166, 255, 0)");
  accentGrad.addColorStop(0.5, "rgba(88, 166, 255, 0.8)");
  accentGrad.addColorStop(1, "rgba(88, 166, 255, 0)");
  ctx.fillStyle = accentGrad;
  ctx.fillRect(cardX + pad, cardY, cardW - pad * 2, 2);

  ctx.font = "700 48px sans-serif";
  const hookLines = wrapText(ctx, opts.hook, cardW - pad * 2);
  ctx.font = "500 42px sans-serif";
  const bodyLines = wrapText(ctx, opts.body, cardW - pad * 2);

  const BRAND_H = 42, CLUSTER_H = 42, COUNTER_H = 52;
  const HOOK_LINE = 58, HOOK_GAP = 28, DIVIDER_H = 36, BODY_LINE = 54;
  const CTA_H = 80;

  const totalContentH =
    BRAND_H + CLUSTER_H + COUNTER_H +
    hookLines.length * HOOK_LINE + HOOK_GAP +
    DIVIDER_H + bodyLines.length * BODY_LINE + CTA_H;

  let y = cardY + Math.max(40, (cardH - totalContentH) / 2);

  ctx.font = "600 18px sans-serif";
  ctx.fillStyle = "#58a6ff";
  ctx.textAlign = "center";
  ctx.letterSpacing = "3px";
  ctx.fillText("▲  TREND TRIANGULATION", centerX, y);
  y += BRAND_H;

  const clusterText = opts.cluster.toUpperCase();
  ctx.font = "500 16px sans-serif";
  ctx.letterSpacing = "0px";
  const badgeW = ctx.measureText(clusterText).width + 24;
  const badgeH = 28;
  const badgeX = centerX - badgeW / 2;
  const badgeR = badgeH / 2;
  const badgeTop = y - badgeH + 6;

  ctx.fillStyle = "rgba(88, 166, 255, 0.15)";
  ctx.beginPath();
  ctx.moveTo(badgeX + badgeR, badgeTop);
  ctx.lineTo(badgeX + badgeW - badgeR, badgeTop);
  ctx.quadraticCurveTo(badgeX + badgeW, badgeTop, badgeX + badgeW, badgeTop + badgeR);
  ctx.lineTo(badgeX + badgeW, badgeTop + badgeH - badgeR);
  ctx.quadraticCurveTo(badgeX + badgeW, badgeTop + badgeH, badgeX + badgeW - badgeR, badgeTop + badgeH);
  ctx.lineTo(badgeX + badgeR, badgeTop + badgeH);
  ctx.quadraticCurveTo(badgeX, badgeTop + badgeH, badgeX, badgeTop + badgeH - badgeR);
  ctx.lineTo(badgeX, badgeTop + badgeR);
  ctx.quadraticCurveTo(badgeX, badgeTop, badgeX + badgeR, badgeTop);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#58a6ff";
  ctx.textBaseline = "middle";
  ctx.fillText(clusterText, centerX, badgeTop + badgeH / 2);
  ctx.textBaseline = "alphabetic";
  y += CLUSTER_H;

  ctx.font = "600 22px sans-serif";
  ctx.fillStyle = "rgba(136, 149, 169, 0.6)";
  ctx.fillText(`${opts.index} / ${opts.total}`, centerX, y);
  y += COUNTER_H;

  ctx.font = "700 48px sans-serif";
  ctx.fillStyle = "#ffffff";
  for (const line of hookLines) {
    ctx.fillText(line, centerX, y);
    y += HOOK_LINE;
  }
  y += HOOK_GAP;

  const divGrad = ctx.createLinearGradient(cardX + pad, 0, cardX + cardW - pad, 0);
  divGrad.addColorStop(0, "rgba(48, 54, 61, 0)");
  divGrad.addColorStop(0.5, "rgba(48, 54, 61, 0.8)");
  divGrad.addColorStop(1, "rgba(48, 54, 61, 0)");
  ctx.fillStyle = divGrad;
  ctx.fillRect(cardX + pad, y - 12, cardW - pad * 2, 1);
  y += DIVIDER_H - 12;

  ctx.font = "500 42px sans-serif";
  ctx.fillStyle = "#c9d1d9";
  for (const line of bodyLines) {
    ctx.fillText(line, centerX, y);
    y += BODY_LINE;
  }

  y += 28;
  ctx.font = "600 28px sans-serif";
  ctx.fillStyle = "#58a6ff";
  ctx.fillText("More in description", centerX, y);
  y += 38;
  ctx.font = "400 22px sans-serif";
  ctx.fillStyle = "rgba(136, 149, 169, 0.5)";
  ctx.fillText("Follow so you don't miss out", centerX, y);

  writeFileSync(opts.outputPath, canvas.toBuffer("image/png"));
}

function wrapText(
  ctx: { measureText: (t: string) => { width: number } },
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Gameplay clip
export function extractGameplayClip(duration: number, outputPath: string, exclude?: string): boolean {
  if (!existsSync(GAMEPLAY_DIR)) return false;
  let files = readdirSync(GAMEPLAY_DIR).filter((f) => /\.(mp4|webm|mkv)$/.test(f));
  if (exclude) files = files.filter((f) => f !== exclude);
  if (files.length === 0) return false;

  const pick = files[Math.floor(Math.random() * files.length)];
  const srcPath = resolve(GAMEPLAY_DIR, pick);
  const srcDuration = parseFloat(
    execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${srcPath}"`).toString().trim(),
  );
  const maxStart = Math.max(0, srcDuration - duration - 5);
  const startAt = Math.floor(Math.random() * maxStart);

  execSync(
    `ffmpeg -y -ss ${startAt} -i "${srcPath}" -t ${duration} -vf "scale=${VIDEO_WIDTH}:${GAMEPLAY_HEIGHT}:force_original_aspect_ratio=increase,crop=${VIDEO_WIDTH}:${GAMEPLAY_HEIGHT},setsar=1" -r 30 -an "${outputPath}" 2>/dev/null`,
  );
  return true;
}

// Music
export function pickMusic(sentiment: string): string | null {
  for (const dir of [resolve(MUSIC_DIR, sentiment), MUSIC_DIR]) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter((f) => /\.(mp3|wav)$/.test(f));
    if (files.length > 0) {
      return resolve(dir, files[Math.floor(Math.random() * files.length)]);
    }
  }
  return null;
}

// Concat voices with silence gaps
function concatVoices(voiceFiles: string[], gapSec: number, outputPath: string) {
  const n = voiceFiles.length;
  if (n === 1) {
    execSync(`cp "${voiceFiles[0]}" "${outputPath}"`);
    return;
  }

  const inputs: string[] = [];
  for (let i = 0; i < n; i++) {
    inputs.push(`-i "${voiceFiles[i]}"`);
    if (i < n - 1) inputs.push(`-f lavfi -t ${gapSec} -i anullsrc=r=44100:cl=mono`);
  }

  const totalInputs = n + (n - 1);
  const filterParts: string[] = [];
  const concatLabels: string[] = [];
  for (let i = 0; i < totalInputs; i++) {
    filterParts.push(`[${i}:a]aformat=sample_rates=44100:channel_layouts=mono[a${i}]`);
    concatLabels.push(`[a${i}]`);
  }

  const filter = filterParts.join(";") + ";" + concatLabels.join("") + `concat=n=${totalInputs}:v=0:a=1[out]`;
  execSync(
    `ffmpeg -y ${inputs.join(" ")} -filter_complex "${filter}" -map "[out]" -c:a libmp3lame -q:a 2 "${outputPath}" 2>/dev/null`,
  );
}

// Full reel assembly pipeline
export async function generateReel(cards: ReelCard[]): Promise<Buffer> {
  ensureTmpDir();
  const slug = `web_${Date.now()}`;
  const n = cards.length;

  // Voiceovers
  const voiceFiles: string[] = [];
  const voiceDurations: number[] = [];
  for (let i = 0; i < n; i++) {
    const vPath = resolve(TMP_DIR, `${slug}_v${i}.mp3`);
    await generateVoice(`${cards[i].hook}. ${cards[i].body}`, vPath);
    voiceFiles.push(vPath);
    voiceDurations.push(getAudioDuration(vPath));
  }

  // Card images
  const cardImages: string[] = [];
  for (let i = 0; i < n; i++) {
    const cPath = resolve(TMP_DIR, `${slug}_c${i}.png`);
    await generateCardImage({
      hook: cards[i].hook,
      body: cards[i].body,
      cluster: cards[i].cluster,
      index: i + 1,
      total: n,
      outputPath: cPath,
    });
    cardImages.push(cPath);
  }

  const totalVoiceDur = voiceDurations.reduce((a, b) => a + b, 0) + GAP_SEC * (n - 1);

  // Gameplay
  const gpPath = resolve(TMP_DIR, `${slug}_gp.mp4`);
  if (!extractGameplayClip(totalVoiceDur + 2, gpPath)) {
    throw new Error("No gameplay files in assets/gameplay/");
  }

  // Music
  const dominantSentiment = cards
    .map((c) => c.sentiment)
    .sort((a, b) =>
      cards.filter((c) => c.sentiment === b).length -
      cards.filter((c) => c.sentiment === a).length,
    )[0] || "neutral";
  const musicPath = pickMusic(dominantSentiment);

  // Segment durations
  const segDurations = voiceDurations.map((d, i) => i < n - 1 ? d + GAP_SEC : d + 0.5);
  const totalDuration = segDurations.reduce((a, b) => a + b, 0);

  // Card video segments
  const cardVideos: string[] = [];
  for (let i = 0; i < n; i++) {
    const segPath = resolve(TMP_DIR, `${slug}_s${i}.mp4`);
    execSync(
      `ffmpeg -y -loop 1 -i "${cardImages[i]}" -r 30 -t ${segDurations[i]} -vf "scale=${VIDEO_WIDTH}:${CARD_HEIGHT}" -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p "${segPath}" 2>/dev/null`,
    );
    cardVideos.push(segPath);
  }

  // Concat cards
  const concatList = resolve(TMP_DIR, `${slug}_list.txt`);
  writeFileSync(concatList, cardVideos.map((f) => `file '${f}'`).join("\n"));
  const cardConcat = resolve(TMP_DIR, `${slug}_cards.mp4`);
  execSync(`ffmpeg -y -f concat -safe 0 -i "${concatList}" -c copy "${cardConcat}" 2>/dev/null`);

  // Concat voice
  const voiceConcat = resolve(TMP_DIR, `${slug}_vc.mp3`);
  concatVoices(voiceFiles, GAP_SEC, voiceConcat);

  // Final assembly
  const outputPath = resolve(TMP_DIR, `${slug}_reel.mp4`);
  const inputs = [`-i "${cardConcat}"`, `-i "${gpPath}"`, `-i "${voiceConcat}"`];
  let videoFilter =
    `[0:v]trim=0:${totalDuration},setpts=PTS-STARTPTS[top];` +
    `[1:v]trim=0:${totalDuration},setpts=PTS-STARTPTS[bot];` +
    `[top][bot]vstack=inputs=2[v]`;

  const junctionParts = await getJunctionParts(cards, totalDuration);
  const junctionJunk: string[] = [];
  if (junctionParts) {
    const drawtextFilter = buildJunctionDrawtextFilter(junctionParts.parts, totalDuration, "v1", slug, junctionJunk);
    videoFilter =
      `[0:v]trim=0:${totalDuration},setpts=PTS-STARTPTS[top];` +
      `[1:v]trim=0:${totalDuration},setpts=PTS-STARTPTS[bot];` +
      `[top][bot]vstack=inputs=2[v1];` +
      drawtextFilter;
  }

  let cmd: string;
  if (musicPath) {
    inputs.push(`-i "${musicPath}"`);
    cmd =
      `ffmpeg -y ${inputs.join(" ")} ` +
      `-filter_complex "${videoFilter};` +
      `[3:a]volume=0.28,atrim=0:${totalDuration},asetpts=PTS-STARTPTS[bg];` +
      `[2:a]asetpts=PTS-STARTPTS[voice];` +
      `[voice][bg]amix=inputs=2:duration=first[aout]" ` +
      `-map "[v]" -map "[aout]" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 192k -r 30 -t ${totalDuration} ` +
      `"${outputPath}"`;
  } else {
    cmd =
      `ffmpeg -y ${inputs.join(" ")} ` +
      `-filter_complex "${videoFilter};` +
      `[2:a]asetpts=PTS-STARTPTS[aout]" ` +
      `-map "[v]" -map "[aout]" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 192k -r 30 -t ${totalDuration} ` +
      `"${outputPath}"`;
  }

  execSync(cmd);

  // Read result
  const { readFileSync } = await import("fs");
  const result = readFileSync(outputPath);

  // Cleanup all temp files
  const allTmp = [...voiceFiles, ...cardImages, ...cardVideos, concatList, cardConcat, voiceConcat, gpPath, outputPath, ...junctionJunk];
  for (const f of allTmp) {
    try { unlinkSync(f); } catch {}
  }

  return result;
}

// Forest + Cats: forest top, cats_video bottom (replacing Minecraft), no sound from cats, random from 1min+, cat + idea_22
export async function generateReelCats(cards: ReelCard[], withIdea22 = true): Promise<Buffer> {
  ensureTmpDir();
  const slug = `web_${Date.now()}`;

  const duration = Math.round((8 + Math.random() * 7) * 10) / 10; // 8–15 sec

  if (!existsSync(FOREST_VIDEO)) throw new Error("assets/forest-video/forest.mp4 not found");
  if (!existsSync(CATS_VIDEO)) throw new Error("assets/cats-video/cats_video.mp4 not found");
  if (!existsSync(CAT_SOUND)) throw new Error("assets/sounds/cat-sound.mp4 not found");
  if (withIdea22 && !existsSync(IDEA_22)) throw new Error("assets/sounds/idea_22.mp3 not found");

  const forestDuration = parseFloat(
    execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${FOREST_VIDEO}"`).toString().trim(),
  );
  const catsDuration = parseFloat(
    execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${CATS_VIDEO}"`).toString().trim(),
  );
  const catDuration = parseFloat(
    execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${CAT_SOUND}"`).toString().trim(),
  );

  const forestMinStart = forestDuration >= 300 + duration ? 300 : 0;
  const forestMaxStart = Math.max(forestMinStart, Math.min(forestMinStart + 300, forestDuration - duration - 1));
  const forestStart = forestMinStart + Math.random() * Math.max(0, forestMaxStart - forestMinStart);

  const catsMinStart = 60;
  const catsMaxStart = Math.max(catsMinStart, Math.min(catsMinStart + 300, catsDuration - duration - 1));
  const catsStart = catsMinStart + Math.random() * Math.max(0, catsMaxStart - catsMinStart);

  const speedFactor = 0.98 + Math.random() * 0.04;
  const extractDur = duration * speedFactor;

  const forestPath = resolve(TMP_DIR, `${slug}_forest.mp4`);
  const catsPath = resolve(TMP_DIR, `${slug}_cats.mp4`);

  execSync(
    `ffmpeg -y -ss ${forestStart} -i "${FOREST_VIDEO}" -t ${extractDur} -map 0:v:0 ` +
    `-vf "scale=${VIDEO_WIDTH}:${CARD_HEIGHT}:force_original_aspect_ratio=increase,crop=${VIDEO_WIDTH}:${CARD_HEIGHT},setsar=1,setpts=PTS/${speedFactor}" ` +
    `-r 30 -an -c:v libx264 -movflags +faststart "${forestPath}"`,
    { stdio: "pipe" },
  );
  execSync(
    `ffmpeg -y -ss ${catsStart} -i "${CATS_VIDEO}" -t ${extractDur} -map 0:v:0 ` +
    `-vf "scale=${VIDEO_WIDTH}:${GAMEPLAY_HEIGHT}:force_original_aspect_ratio=increase,crop=${VIDEO_WIDTH}:${GAMEPLAY_HEIGHT},setsar=1,setpts=PTS/${speedFactor}" ` +
    `-r 30 -an -c:v libx264 -movflags +faststart "${catsPath}"`,
    { stdio: "pipe" },
  );

  const catStart = Math.random() * Math.max(0, catDuration - duration - 0.5);
  const catAudioPath = resolve(TMP_DIR, `${slug}_cat.mp3`);
  execSync(
    `ffmpeg -y -ss ${catStart} -i "${CAT_SOUND}" -t ${duration} -vn -c:a libmp3lame -q:a 2 "${catAudioPath}"`,
    { stdio: "pipe" },
  );

  let mixedAudioPath = catAudioPath;
  const idea22AudioPath = withIdea22 ? resolve(TMP_DIR, `${slug}_idea22.mp3`) : null;
  if (withIdea22 && idea22AudioPath) {
    const idea22Duration = parseFloat(
      execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${IDEA_22}"`).toString().trim(),
    );
    const idea22Start = Math.random() * Math.max(0, idea22Duration - duration - 0.5);
    execSync(
      `ffmpeg -y -ss ${idea22Start} -i "${IDEA_22}" -t ${duration} -vn -c:a libmp3lame -q:a 2 "${idea22AudioPath}"`,
      { stdio: "pipe" },
    );
    mixedAudioPath = resolve(TMP_DIR, `${slug}_mixed.mp3`);
    execFileSync(
      "ffmpeg",
      [
        "-y", "-i", catAudioPath, "-i", idea22AudioPath,
        "-filter_complex", "[0:a]volume=1[cat];[1:a]volume=0.28[idea];[cat][idea]amix=inputs=2:duration=first[a]",
        "-map", "[a]", "-c:a", "libmp3lame", "-q:a", "2", "-t", String(duration),
        mixedAudioPath,
      ],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
    );
  }

  const stackedPath = resolve(TMP_DIR, `${slug}_stacked.mp4`);
  const outputPath = resolve(TMP_DIR, `${slug}_reel.mp4`);

  const allTmp = [forestPath, catsPath, catAudioPath, stackedPath, outputPath];
  if (idea22AudioPath) allTmp.push(idea22AudioPath);
  if (mixedAudioPath !== catAudioPath) allTmp.push(mixedAudioPath);

  const junctionResult1 = await getJunctionParts(cards, duration);
  const withCaptions = !!junctionResult1;
  const junctionJunkCats: string[] = [];
  let vstackFilter = `[0:v][1:v]vstack=inputs=2[v1];${buildJunctionBlurFilter(withCaptions ? "vblur" : "v", withCaptions)}`;
  if (withCaptions) {
    vstackFilter += ";" + buildJunctionDrawtextFilter(junctionResult1.parts, duration, "vblur", slug, junctionJunkCats);
  }

  try {
    execFileSync(
      "ffmpeg",
      [
        "-y", "-i", forestPath, "-i", catsPath,
        "-filter_complex", vstackFilter,
        "-map", "[v]", "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p",
        "-r", "30", "-t", String(duration), "-an",
        stackedPath,
      ],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
    );

    execFileSync(
      "ffmpeg",
      [
        "-y", "-i", stackedPath, "-i", mixedAudioPath,
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-t", String(duration), "-map", "0:v:0", "-map", "1:a:0",
        outputPath,
      ],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
    );
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message?: string };
    const detail = (err.stderr || err.stdout || err.message || String(e)).slice(-500);
    throw new Error(`FFmpeg forest+cats: ${detail}`);
  }

  const { readFileSync } = await import("fs");
  const result = readFileSync(outputPath);

  for (const f of [...allTmp, ...junctionJunkCats]) {
    try { unlinkSync(f); } catch {}
  }

  return result;
}

// Forest template: forest video top, gameplay bottom, cat sound (+ optional idea_22 piano quieter), no TTS
export async function generateReelForest(cards: ReelCard[], withIdea22 = false, whisperText?: string): Promise<Buffer> {
  ensureTmpDir();
  const slug = `web_${Date.now()}`;

  const duration = Math.round((8 + Math.random() * 7) * 10) / 10; // 8–15 sec, 1 decimal

  if (!existsSync(FOREST_VIDEO)) throw new Error("assets/forest-video/forest.mp4 not found");
  if (!existsSync(CAT_SOUND)) throw new Error("assets/sounds/cat-sound.mp4 not found");
  if (withIdea22 && !existsSync(IDEA_22)) throw new Error("assets/sounds/idea_22.mp3 not found");

  const forestDuration = parseFloat(
    execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${FOREST_VIDEO}"`).toString().trim(),
  );
  const catDuration = parseFloat(
    execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${CAT_SOUND}"`).toString().trim(),
  );

  const forestMinStart = forestDuration >= 300 + duration ? 300 : 0;
  const forestMaxStart = Math.max(forestMinStart, Math.min(forestMinStart + 300, forestDuration - duration - 1));
  const forestStart = forestMinStart + Math.random() * Math.max(0, forestMaxStart - forestMinStart);
  const catStart = Math.random() * Math.max(0, catDuration - duration - 0.5);

  const speedFactor = 0.98 + Math.random() * 0.04;
  const extractDur = duration * speedFactor;

  const forestPath = resolve(TMP_DIR, `${slug}_forest.mp4`);
  execSync(
    `ffmpeg -y -ss ${forestStart} -i "${FOREST_VIDEO}" -t ${extractDur} -map 0:v:0 ` +
    `-vf "scale=${VIDEO_WIDTH}:${CARD_HEIGHT}:force_original_aspect_ratio=increase,crop=${VIDEO_WIDTH}:${CARD_HEIGHT},setsar=1,setpts=PTS/${speedFactor}" ` +
    `-r 30 -an -c:v libx264 -movflags +faststart "${forestPath}"`,
    { stdio: "pipe" },
  );

  const gpPath = resolve(TMP_DIR, `${slug}_gp.mp4`);
  if (!extractGameplayClip(duration + 1, gpPath, "roblox.mp4")) {
    throw new Error("No gameplay files in assets/gameplay/ (excluding roblox.mp4)");
  }

  const catAudioPath = resolve(TMP_DIR, `${slug}_cat.mp3`);
  execSync(
    `ffmpeg -y -ss ${catStart} -i "${CAT_SOUND}" -t ${duration} -vn -c:a libmp3lame -q:a 2 "${catAudioPath}"`,
    { stdio: "pipe" },
  );

  let mixedAudioPath = catAudioPath;
  const idea22AudioPath = withIdea22 ? resolve(TMP_DIR, `${slug}_idea22.mp3`) : null;
  if (withIdea22 && idea22AudioPath) {
    const idea22Duration = parseFloat(
      execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${IDEA_22}"`).toString().trim(),
    );
    const idea22Start = Math.random() * Math.max(0, idea22Duration - duration - 0.5);
    execSync(
      `ffmpeg -y -ss ${idea22Start} -i "${IDEA_22}" -t ${duration} -vn -c:a libmp3lame -q:a 2 "${idea22AudioPath}"`,
      { stdio: "pipe" },
    );
    mixedAudioPath = resolve(TMP_DIR, `${slug}_mixed.mp3`);
    execFileSync(
      "ffmpeg",
      [
        "-y", "-i", catAudioPath, "-i", idea22AudioPath,
        "-filter_complex", "[0:a]volume=1[cat];[1:a]volume=0.28[idea];[cat][idea]amix=inputs=2:duration=first[a]",
        "-map", "[a]", "-c:a", "libmp3lame", "-q:a", "2", "-t", String(duration),
        mixedAudioPath,
      ],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
    );
  }

  const junctionResult2 = await getJunctionParts(cards, duration);
  const withCaptions2 = !!junctionResult2;

  const useWhisperVoice = _captionOverrides?.whisperVoice ?? getWhisperVoiceEnabled();
  const effectiveWhisper = useWhisperVoice && (whisperText || (withCaptions2 && (_captionOverrides?.prepopulated) ? junctionResult2.parts.join(" ") : null));

  let whisperPath: string | null = null;
  if (effectiveWhisper) {
    whisperPath = resolve(TMP_DIR, `${slug}_whisper.mp3`);
    await generateWhisperVoice(effectiveWhisper, whisperPath);
    const whisperMixed = resolve(TMP_DIR, `${slug}_whisper_mixed.mp3`);
    execFileSync(
      "ffmpeg",
      [
        "-y", "-i", mixedAudioPath, "-i", whisperPath,
        "-filter_complex",
        `[0:a]volume=0.6[bg];[1:a]volume=1.0,adelay=1500|1500[wh];[bg][wh]amix=inputs=2:duration=first:normalize=0[a]`,
        "-map", "[a]", "-c:a", "libmp3lame", "-q:a", "2", "-t", String(duration),
        whisperMixed,
      ],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
    );
    mixedAudioPath = whisperMixed;
  }

  const stackedPath = resolve(TMP_DIR, `${slug}_stacked.mp4`);
  const outputPath = resolve(TMP_DIR, `${slug}_reel.mp4`);

  const allTmp = [forestPath, gpPath, catAudioPath, stackedPath, outputPath];
  if (idea22AudioPath) allTmp.push(idea22AudioPath);
  if (whisperPath) allTmp.push(whisperPath);
  if (mixedAudioPath !== catAudioPath) allTmp.push(mixedAudioPath);
  const junctionJunkForest: string[] = [];
  let vstackFilter = `[0:v][1:v]vstack=inputs=2[v1];${buildJunctionBlurFilter(withCaptions2 ? "vblur" : "v", withCaptions2)}`;
  if (withCaptions2) {
    vstackFilter += ";" + buildJunctionDrawtextFilter(junctionResult2.parts, duration, "vblur", slug, junctionJunkForest);
  }

  try {
    execFileSync(
      "ffmpeg",
      [
        "-y", "-i", forestPath, "-i", gpPath,
        "-filter_complex", vstackFilter,
        "-map", "[v]", "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p",
        "-r", "30", "-t", String(duration), "-an",
        stackedPath,
      ],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
    );

    execFileSync(
      "ffmpeg",
      [
        "-y", "-i", stackedPath, "-i", mixedAudioPath,
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-t", String(duration), "-map", "0:v:0", "-map", "1:a:0",
        outputPath,
      ],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
    );
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message?: string };
    const detail = (err.stderr || err.stdout || err.message || String(e)).slice(-500);
    throw new Error(`FFmpeg forest: ${detail}`);
  }

  const { readFileSync } = await import("fs");
  const result = readFileSync(outputPath);

  for (const f of [...allTmp, ...junctionJunkForest]) {
    try { unlinkSync(f); } catch {}
  }

  return result;
}

// Roblox template: roblox video top (from 3min), gameplay bottom (Minecraft), cat + idea_22, no TTS
export async function generateReelRoblox(cards: ReelCard[], withIdea22 = true): Promise<Buffer> {
  ensureTmpDir();
  const slug = `web_${Date.now()}`;

  const duration = Math.round((8 + Math.random() * 7) * 10) / 10; // 8–15 sec, 1 decimal

  if (!existsSync(ROBLOX_VIDEO)) throw new Error("assets/gameplay/roblox.mp4 not found");
  if (!existsSync(CAT_SOUND)) throw new Error("assets/sounds/cat-sound.mp4 not found");
  if (withIdea22 && !existsSync(IDEA_22)) throw new Error("assets/sounds/idea_22.mp3 not found");

  const robloxDuration = parseFloat(
    execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${ROBLOX_VIDEO}"`).toString().trim(),
  );
  const catDuration = parseFloat(
    execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${CAT_SOUND}"`).toString().trim(),
  );

  const robloxMinStart = robloxDuration >= 180 + duration ? 180 : 0;
  const robloxMaxStart = Math.max(robloxMinStart, Math.min(robloxMinStart + 300, robloxDuration - duration - 1));
  const robloxStart = robloxMinStart + Math.random() * Math.max(0, robloxMaxStart - robloxMinStart);
  const catStart = Math.random() * Math.max(0, catDuration - duration - 0.5);

  const speedFactor = 0.98 + Math.random() * 0.04;
  const extractDur = duration * speedFactor;

  const robloxPath = resolve(TMP_DIR, `${slug}_roblox.mp4`);
  execSync(
    `ffmpeg -y -ss ${robloxStart} -i "${ROBLOX_VIDEO}" -t ${extractDur} -map 0:v:0 ` +
    `-vf "scale=${VIDEO_WIDTH}:${CARD_HEIGHT}:force_original_aspect_ratio=increase,crop=${VIDEO_WIDTH}:${CARD_HEIGHT},setsar=1,setpts=PTS/${speedFactor}" ` +
    `-r 30 -an -c:v libx264 -movflags +faststart "${robloxPath}"`,
    { stdio: "pipe" },
  );

  const gpPath = resolve(TMP_DIR, `${slug}_gp.mp4`);
  if (!extractGameplayClip(duration + 1, gpPath, "roblox.mp4")) {
    throw new Error("No gameplay files in assets/gameplay/ (excluding roblox.mp4)");
  }

  const catAudioPath = resolve(TMP_DIR, `${slug}_cat.mp3`);
  execSync(
    `ffmpeg -y -ss ${catStart} -i "${CAT_SOUND}" -t ${duration} -vn -c:a libmp3lame -q:a 2 "${catAudioPath}"`,
    { stdio: "pipe" },
  );

  let mixedAudioPath = catAudioPath;
  const idea22AudioPath = withIdea22 ? resolve(TMP_DIR, `${slug}_idea22.mp3`) : null;
  if (withIdea22 && idea22AudioPath) {
    const idea22Duration = parseFloat(
      execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${IDEA_22}"`).toString().trim(),
    );
    const idea22Start = Math.random() * Math.max(0, idea22Duration - duration - 0.5);
    execSync(
      `ffmpeg -y -ss ${idea22Start} -i "${IDEA_22}" -t ${duration} -vn -c:a libmp3lame -q:a 2 "${idea22AudioPath}"`,
      { stdio: "pipe" },
    );
    mixedAudioPath = resolve(TMP_DIR, `${slug}_mixed.mp3`);
    execFileSync(
      "ffmpeg",
      [
        "-y", "-i", catAudioPath, "-i", idea22AudioPath,
        "-filter_complex", "[0:a]volume=1[cat];[1:a]volume=0.28[idea];[cat][idea]amix=inputs=2:duration=first[a]",
        "-map", "[a]", "-c:a", "libmp3lame", "-q:a", "2", "-t", String(duration),
        mixedAudioPath,
      ],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
    );
  }

  const stackedPath = resolve(TMP_DIR, `${slug}_stacked.mp4`);
  const outputPath = resolve(TMP_DIR, `${slug}_reel.mp4`);

  const allTmp = [robloxPath, gpPath, catAudioPath, stackedPath, outputPath];
  if (idea22AudioPath) allTmp.push(idea22AudioPath);
  if (mixedAudioPath !== catAudioPath) allTmp.push(mixedAudioPath);

  const junctionResult3 = await getJunctionParts(cards, duration);
  const withCaptions3 = !!junctionResult3;
  const junctionJunkRoblox: string[] = [];
  let vstackFilter = `[0:v][1:v]vstack=inputs=2[v1];${buildJunctionBlurFilter(withCaptions3 ? "vblur" : "v", withCaptions3)}`;
  if (withCaptions3) {
    vstackFilter += ";" + buildJunctionDrawtextFilter(junctionResult3.parts, duration, "vblur", slug, junctionJunkRoblox);
  }

  try {
    execFileSync(
      "ffmpeg",
      [
        "-y", "-i", robloxPath, "-i", gpPath,
        "-filter_complex", vstackFilter,
        "-map", "[v]", "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p",
        "-r", "30", "-t", String(duration), "-an",
        stackedPath,
      ],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
    );

    execFileSync(
      "ffmpeg",
      [
        "-y", "-i", stackedPath, "-i", mixedAudioPath,
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-t", String(duration), "-map", "0:v:0", "-map", "1:a:0",
        outputPath,
      ],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
    );
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message?: string };
    const detail = (err.stderr || err.stdout || err.message || String(e)).slice(-500);
    throw new Error(`FFmpeg roblox: ${detail}`);
  }

  const { readFileSync } = await import("fs");
  const result = readFileSync(outputPath);

  for (const f of [...allTmp, ...junctionJunkRoblox]) {
    try { unlinkSync(f); } catch {}
  }

  return result;
}

export function formatForestCaption(cards: ReelCard[]): string {
  const lines = cards.map((c, i) => `#${i + 1} ${c.hook}: ${c.body}`);
  const hashtags = getForestHashtags(cards).map((h) => `#${h}`).join(" ");
  return `ALERT!\nDo not miss world news:\n\n${lines.join("\n\n")}\n\n${hashtags}`;
}

export function getForestHashtags(cards: ReelCard[]): string[] {
  const base = ["forest", "minecraft", "cat", "worldnews", "trending", "news", "viral"];
  const cluster = cards[0]?.cluster?.toLowerCase().replace(/\s+/g, "");
  if (cluster) base.push(cluster);
  return base;
}

export function getCatsHashtags(cards: ReelCard[]): string[] {
  const base = ["cats", "cat", "worldnews", "trending", "news", "viral"];
  const cluster = cards[0]?.cluster?.toLowerCase().replace(/\s+/g, "");
  if (cluster) base.push(cluster);
  return base;
}

export function getRobloxHashtags(cards: ReelCard[]): string[] {
  const base = ["roblox", "minecraft", "cat", "worldnews", "trending", "news", "viral"];
  const cluster = cards[0]?.cluster?.toLowerCase().replace(/\s+/g, "");
  if (cluster) base.push(cluster);
  return base;
}

export function formatRobloxCaption(cards: ReelCard[]): string {
  const lines = cards.map((c, i) => `#${i + 1} ${c.hook}: ${c.body}`);
  const hashtags = getRobloxHashtags(cards).map((h) => `#${h}`).join(" ");
  return `ALERT!\nDo not miss world news:\n\n${lines.join("\n\n")}\n\n${hashtags}`;
}

export function formatCatsCaption(cards: ReelCard[]): string {
  const lines = cards.map((c, i) => `#${i + 1} ${c.hook}: ${c.body}`);
  const hashtags = getCatsHashtags(cards).map((h) => `#${h}`).join(" ");
  return `ALERT!\nDo not miss world news:\n\n${lines.join("\n\n")}\n\n${hashtags}`;
}

export async function generateReelForTemplate(
  template: string,
  cards: ReelCard[],
  opts?: { whisperText?: string },
): Promise<Buffer> {
  if (isCatsTemplate(template)) return generateReelCats(cards, true);
  if (isRobloxTemplate(template)) return generateReelRoblox(cards, true);
  if (isForestTemplate(template)) return generateReelForest(cards, template === "forest_idea22", opts?.whisperText);
  return generateReel(cards);
}

export function formatCaptionForTemplate(
  template: string,
  cards: ReelCard[],
  fallback?: string,
): string {
  if (cards[0]?.cluster === "quotes") {
    return fallback ?? `"${cards[0].hook}"\n\n#quotes #hypnotic #deepquotes #motivation`;
  }
  if (isCatsTemplate(template)) return formatCatsCaption(cards);
  if (isRobloxTemplate(template)) return formatRobloxCaption(cards);
  if (isForestTemplate(template)) return formatForestCaption(cards);
  return fallback ?? `Trending now: ${cards.map((c) => c.hook).join(" | ")}`;
}
