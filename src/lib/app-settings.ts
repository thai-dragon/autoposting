import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { eq } from "drizzle-orm";

const JUNCTION_CAPTIONS_KEY = "junction_captions_enabled";
const PREPOPULATED_CAPTIONS_KEY = "prepopulated_captions_enabled";
const WHISPER_VOICE_KEY = "whisper_voice_enabled";
const AB_TESTING_KEY = "ab_testing_enabled";
const AB_MAIN_TEMPLATE_KEY = "ab_main_template";
const AB_TEST_TEMPLATE_KEY = "ab_test_template";

export function getJunctionCaptionsEnabled(): boolean {
  const row = db.select().from(appSettings).where(eq(appSettings.key, JUNCTION_CAPTIONS_KEY)).all()[0];
  return row?.value === "1";
}

export function getPrepopulatedCaptionsEnabled(): boolean {
  const row = db.select().from(appSettings).where(eq(appSettings.key, PREPOPULATED_CAPTIONS_KEY)).all()[0];
  return row?.value === "1";
}

export function getWhisperVoiceEnabled(): boolean {
  const row = db.select().from(appSettings).where(eq(appSettings.key, WHISPER_VOICE_KEY)).all()[0];
  return row === undefined || row.value === "1";
}

export function getAbTestingEnabled(): boolean {
  const row = db.select().from(appSettings).where(eq(appSettings.key, AB_TESTING_KEY)).all()[0];
  return row?.value === "1";
}

export function getAbMainTemplate(): string {
  const row = db.select().from(appSettings).where(eq(appSettings.key, AB_MAIN_TEMPLATE_KEY)).all()[0];
  return row?.value || "cards";
}

export function getAbTestTemplate(): string {
  const row = db.select().from(appSettings).where(eq(appSettings.key, AB_TEST_TEMPLATE_KEY)).all()[0];
  return row?.value || "forest_cats";
}
