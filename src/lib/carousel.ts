import { resolve } from "path";
import OpenAI from "openai";

const ROOT = process.cwd();
const MONTSERRAT_PATH = resolve(ROOT, "assets/fonts/Montserrat.ttf");
const MONTSERRAT_REGULAR_PATH = resolve(
  ROOT,
  "assets/fonts/Montserrat-Regular.ttf",
);

const SLIDE_W = 1080;
const SLIDE_H = 1350;

// ── Types ──

export interface CarouselSlide {
  slide_number: number;
  text_hook: string;
  body_text: string;
  pexels_query: string;
}

export interface CarouselData {
  slides: CarouselSlide[];
  caption: string;
  carousel_topic: string;
}

// ── 1. Content Generation (OpenAI) ──

const CAROUSEL_PROMPT = `You are a viral Instagram carousel creator. Your carousels get millions of saves because they're punchy, surprising, and impossible to stop swiping.

Topic: {TOPIC}

Create a carousel with 5-7 slides. For each slide return JSON:
{
  "slides": [
    {
      "slide_number": 1,
      "text_hook": "First slide — must be a HOOK that stops the scroll. Use pattern interrupts: a bold claim, a number, a question, or a controversial take. Max 8 words.",
      "body_text": "",
      "pexels_query": "Search query for Pexels photo — be specific and visual. Not 'business' but 'person stressed at laptop dark room'"
    },
    {
      "slide_number": 2,
      "text_hook": "Short bold headline for this point — max 6 words",
      "body_text": "2-3 sentences expanding the point. Conversational, like talking to a friend. Use 'you' a lot. Include a surprising fact or counterintuitive insight.",
      "pexels_query": "Specific visual search query matching this slide's content"
    }
  ],
  "caption": "Instagram caption with hook in first line, value summary, CTA, and 5 relevant hashtags.",
  "carousel_topic": "Short topic label for analytics"
}

RULES:
- Slide 1 is ONLY a hook — no explanation, just a scroll-stopping statement
- Each slide should make the reader NEED to see the next one
- Last slide is always a CTA (save/follow)
- Tone: confident, slightly provocative, backed by facts
- Never use generic phrases like "In today's world" or "It's important to note"
- Write like a creator with 500K followers, not like ChatGPT
- When the topic mentions specific real products, games, tools, or brands — USE THEIR REAL NAMES. Do NOT invent fictional replacements. If topic is "top 5 roblox games", name real games like Adopt Me, Brookhaven, Blox Fruits, Tower of Hell, Royale High. Each slide about a specific item MUST name it in text_hook (e.g. "Adopt Me — pet trading mania").
- pexels_query MUST describe MOOD, AESTHETIC, or SETTING for stock photography — NEVER use brand names, game titles, or app names. Pexels has NO game screenshots. Example: instead of "roblox adopt me pets" write "colorful toy collection bright playful room". Instead of "fortnite battle" write "intense neon lights action dark background". Think cinematography, not screenshots.
- Return valid JSON only`;

export async function generateCarouselContent(
  topic: string,
): Promise<CarouselData> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const openai = new OpenAI({ apiKey });
  const completion = await openai.chat.completions.create({
    model: "gpt-5-mini",
    messages: [
      { role: "user", content: CAROUSEL_PROMPT.replace("{TOPIC}", topic) },
    ],
    max_completion_tokens: 4096,
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content?.trim() || "";
  if (!raw) throw new Error("OpenAI returned empty response");

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`OpenAI returned invalid JSON (${raw.length} chars, truncated: ${completion.choices[0]?.finish_reason})`);
  }

  if (!Array.isArray(parsed.slides) || parsed.slides.length < 3) {
    throw new Error("Invalid carousel response from OpenAI");
  }

  return {
    slides: parsed.slides.map((s: CarouselSlide, i: number) => ({
      slide_number: i + 1,
      text_hook: String(s.text_hook || "").trim(),
      body_text: String(s.body_text || "").trim(),
      pexels_query: String(s.pexels_query || "aesthetic background").trim(),
    })),
    caption: String(parsed.caption || "").trim(),
    carousel_topic: String(parsed.carousel_topic || topic).trim(),
  };
}

// ── 2. Pexels Photo Fetching ──

export async function fetchPexelsPhoto(query: string): Promise<Buffer> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) throw new Error("PEXELS_API_KEY not set");

  let photoUrl: string | null = null;

  const searchRes = await fetch(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=3&orientation=portrait`,
    { headers: { Authorization: key } },
  );
  if (searchRes.ok) {
    const data = await searchRes.json();
    photoUrl =
      data.photos?.[0]?.src?.large2x || data.photos?.[0]?.src?.original || null;
  }

  if (!photoUrl) {
    const curatedRes = await fetch(
      "https://api.pexels.com/v1/curated?per_page=5",
      { headers: { Authorization: key } },
    );
    if (curatedRes.ok) {
      const data = await curatedRes.json();
      const pick =
        data.photos?.[Math.floor(Math.random() * (data.photos?.length || 1))];
      photoUrl = pick?.src?.large2x || pick?.src?.original || null;
    }
  }

  if (!photoUrl) throw new Error(`No Pexels photo found for: ${query}`);

  const imgRes = await fetch(photoUrl);
  if (!imgRes.ok)
    throw new Error(`Failed to download Pexels photo: ${imgRes.status}`);
  return Buffer.from(await imgRes.arrayBuffer());
}

// ── 3. Image Rendering (@napi-rs/canvas) ──

function wrapCanvasText(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function renderSlideImage(
  photoBuffer: Buffer,
  slide: CarouselSlide,
  isFirst: boolean,
  isLast: boolean,
): Promise<Buffer> {
  const { createCanvas, loadImage, GlobalFonts } = await import("@napi-rs/canvas");
  const { existsSync } = await import("fs");

  if (existsSync(MONTSERRAT_PATH))
    GlobalFonts.registerFromPath(MONTSERRAT_PATH, "Montserrat");
  if (existsSync(MONTSERRAT_REGULAR_PATH))
    GlobalFonts.registerFromPath(MONTSERRAT_REGULAR_PATH, "MontserratRegular");

  const canvas = createCanvas(SLIDE_W, SLIDE_H);
  const ctx = canvas.getContext("2d");

  const img = await loadImage(photoBuffer);

  if (img.width > 0 && img.height > 0) {
    const scale = Math.max(SLIDE_W / img.width, SLIDE_H / img.height);
    const sw = SLIDE_W / scale;
    const sh = SLIDE_H / scale;
    const sx = (img.width - sw) / 2;
    const sy = (img.height - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, SLIDE_W, SLIDE_H);
  } else {
    console.warn("[renderSlideImage] Image decode failed, using gradient fallback");
    const fb = ctx.createLinearGradient(0, 0, SLIDE_W, SLIDE_H);
    fb.addColorStop(0, "#1a1a2e");
    fb.addColorStop(1, "#16213e");
    ctx.fillStyle = fb;
    ctx.fillRect(0, 0, SLIDE_W, SLIDE_H);
  }

  const overlayAlpha = isLast ? 0.85 : 0.75;
  const grad = ctx.createLinearGradient(0, 0, 0, SLIDE_H);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(0.4, `rgba(0,0,0,${overlayAlpha * 0.2})`);
  grad.addColorStop(1, `rgba(0,0,0,${overlayAlpha})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SLIDE_W, SLIDE_H);

  const pad = 60;
  const rectPad = 24;
  const maxTextW = SLIDE_W - pad * 2;
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";

  const drawTextBackdrop = (boxY: number, boxH: number) => {
    const boxX = pad - rectPad;
    const boxW = maxTextW + rectPad * 2;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, boxH, 16);
      ctx.fill();
    } else {
      ctx.fillRect(boxX, boxY, boxW, boxH);
    }
    ctx.fillStyle = "#ffffff";
  };

  if (isFirst) {
    ctx.font = "700 88px Montserrat, sans-serif";
    const hookLines = wrapCanvasText(ctx, slide.text_hook, maxTextW);
    const lineH = 100;
    const totalH = hookLines.length * lineH;
    const boxY = (SLIDE_H - totalH) / 2 - rectPad;
    const boxH = totalH + rectPad * 2;
    drawTextBackdrop(boxY, boxH);
    let y = (SLIDE_H - totalH) / 2 + lineH * 0.7;
    for (const line of hookLines) {
      ctx.fillText(line, SLIDE_W / 2, y);
      y += lineH;
    }
  } else if (isLast) {
    ctx.font = "700 76px Montserrat, sans-serif";
    const hookLines = wrapCanvasText(ctx, slide.text_hook, maxTextW);
    const lineH = 90;
    let totalH = hookLines.length * lineH;

    let bodyLines: string[] = [];
    if (slide.body_text) {
      ctx.font = "400 38px MontserratRegular, Montserrat, sans-serif";
      bodyLines = wrapCanvasText(ctx, slide.body_text, maxTextW);
      totalH += 20 + bodyLines.length * 48;
    }

    const boxY = (SLIDE_H - totalH) / 2 - rectPad;
    const boxH = totalH + rectPad * 2;
    drawTextBackdrop(boxY, boxH);
    let y = (SLIDE_H - totalH) / 2 + lineH * 0.7;
    ctx.font = "700 76px Montserrat, sans-serif";
    for (const line of hookLines) {
      ctx.fillText(line, SLIDE_W / 2, y);
      y += lineH;
    }
    if (bodyLines.length) {
      y += 20;
      ctx.font = "400 38px MontserratRegular, Montserrat, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      for (const line of bodyLines) {
        ctx.fillText(line, SLIDE_W / 2, y);
        y += 48;
      }
    }
  } else {
    ctx.font = "700 64px Montserrat, sans-serif";
    const hookLines = wrapCanvasText(ctx, slide.text_hook, maxTextW);
    const hookLineH = 80;

    let bodyLines: string[] = [];
    if (slide.body_text) {
      ctx.font = "400 36px MontserratRegular, Montserrat, sans-serif";
      bodyLines = wrapCanvasText(ctx, slide.body_text, maxTextW);
    }

    const bodyLineH = 46;
    const gap = 18;
    const totalH =
      hookLines.length * hookLineH +
      (bodyLines.length ? gap + bodyLines.length * bodyLineH : 0);
    const boxY = SLIDE_H - pad - totalH - rectPad;
    const boxH = totalH + rectPad * 2;
    drawTextBackdrop(boxY, boxH);
    let y = SLIDE_H - pad - totalH + hookLineH * 0.7;

    ctx.font = "700 64px Montserrat, sans-serif";
    ctx.fillStyle = "#ffffff";
    for (const line of hookLines) {
      ctx.fillText(line, SLIDE_W / 2, y);
      y += hookLineH;
    }

    if (bodyLines.length) {
      y += gap;
      ctx.font = "400 36px MontserratRegular, Montserrat, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      for (const line of bodyLines) {
        ctx.fillText(line, SLIDE_W / 2, y);
        y += bodyLineH;
      }
    }
  }

  return Buffer.from(canvas.toBuffer("image/jpeg"));
}

// ── 4. Full Pipeline ──

export async function generateCarousel(topic: string): Promise<{
  data: CarouselData;
  images: Buffer[];
}> {
  const data = await generateCarouselContent(topic);

  const images: Buffer[] = [];
  for (let i = 0; i < data.slides.length; i++) {
    const slide = data.slides[i];
    const photo = await fetchPexelsPhoto(slide.pexels_query);
    const rendered = await renderSlideImage(
      photo,
      slide,
      i === 0,
      i === data.slides.length - 1,
    );
    images.push(rendered);
  }

  return { data, images };
}
