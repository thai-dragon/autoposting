import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/** Queued reels waiting for cron / manual publish (separate module avoids Turbopack stale export cache on `schema.ts`). */
export const videoQueue = sqliteTable("video_queue", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: text("account_id").notNull(),
  r2Key: text("r2_key").notNull(),
  publicUrl: text("public_url").notNull(),
  caption: text("caption").notNull().default(""),
  status: text("status").notNull(),
  createdAt: integer("created_at").notNull(),
  publishedAt: integer("published_at"),
  error: text("error"),
});
