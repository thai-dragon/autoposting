import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/** Same shape as main app — reel/app-settings when generating. */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/**
 * Snapshot from triangulation export — panel never opens triangulation sqlite at runtime.
 * Each row can have different autopostHeadline/Summary/Caption (e.g. default vs magnetic).
 */
export const syncedAccounts = sqliteTable("synced_accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  username: text("username").notNull().default(""),
  accessToken: text("access_token").notNull(),
  userId: text("user_id").notNull(),
  igEnabled: integer("ig_enabled").notNull().default(1),
  template: text("template").notNull().default("forest"),
  niche: text("niche").notNull().default("trends"),
  captionMode: text("caption_mode").notNull().default("off"),
  whisperVoiceEnabled: integer("whisper_voice_enabled").notNull().default(1),
  autopostHeadline: text("autopost_headline"),
  autopostSummary: text("autopost_summary"),
  autopostCaption: text("autopost_caption"),
  syncedAt: integer("synced_at").notNull(),
});

export { videoQueue } from "./video-queue";

export const autopublishConfig = sqliteTable("autopublish_config", {
  id: integer("id").primaryKey(),
  running: integer("running").notNull().default(0),
  intervalMs: integer("interval_ms").notNull().default(3_600_000),
  lastPublishAt: integer("last_publish_at"),
  selectedAccountId: text("selected_account_id"),
});

export const panelPublishLog = sqliteTable("panel_publish_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: text("account_id").notNull(),
  instagramId: text("instagram_id"),
  caption: text("caption").notNull(),
  videoUrl: text("video_url"),
  publishedAt: integer("published_at").notNull(),
  status: text("status").notNull(),
  error: text("error"),
});
