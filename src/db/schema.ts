import {
  sqliteTable,
  text,
  integer,
  real,
  unique,
} from "drizzle-orm/sqlite-core";

export const posts = sqliteTable("posts", {
  id: text("id").primaryKey(),
  subreddit: text("subreddit").notNull(),
  title: text("title").notNull(),
  selftext: text("selftext"),
  score: integer("score").notNull(),
  numComments: integer("num_comments").notNull(),
  createdUtc: integer("created_utc").notNull(),
  fetchedAt: integer("fetched_at").notNull(),
});

export const terms = sqliteTable(
  "terms",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    term: text("term").notNull(),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id),
  },
  (t) => [unique().on(t.term, t.postId)]
);

export const intents = sqliteTable(
  "intents",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id),
    intentType: text("intent_type").notNull(),
    pattern: text("pattern").notNull(),
    snippet: text("snippet").notNull(),
  },
  (t) => [unique().on(t.postId, t.intentType, t.pattern)]
);

export const aiInsights = sqliteTable("ai_insights", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(),
  payload: text("payload").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const termClusters = sqliteTable("term_clusters", {
  term: text("term").primaryKey(),
  cluster: text("cluster").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const trends = sqliteTable("trends", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  term: text("term").notNull(),
  cluster: text("cluster"),
  trendScore: real("trend_score").notNull(),
  velocity: real("velocity").notNull(),
  spread: integer("spread").notNull(),
  engagement: real("engagement").notNull(),
  windowStart: integer("window_start").notNull(),
  windowEnd: integer("window_end").notNull(),
});

export const publishLog = sqliteTable("publish_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: text("account_id"),
  cluster: text("cluster"),
  caption: text("caption").notNull(),
  cardsJson: text("cards_json"),
  instagramId: text("instagram_id"),
  youtubeId: text("youtube_id"),
  videoUrl: text("video_url"),
  publishedAt: integer("published_at").notNull(),
  status: text("status").notNull().default("published"),
  source: text("source").notNull().default("manual"),
  patchVersion: text("patch_version"),
  template: text("template"),
});

export const videoTemplates = sqliteTable("video_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  previewPath: text("preview_path"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const activeTemplate = sqliteTable("active_template", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const platformSettings = sqliteTable("platform_settings", {
  platform: text("platform").primaryKey(),
  enabled: integer("enabled").notNull().default(1),
  updatedAt: integer("updated_at").notNull(),
});

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const clusterPriorities = sqliteTable("cluster_priorities", {
  cluster: text("cluster").primaryKey(),
  accountId: text("account_id"),
  priority: real("priority").notNull().default(1),
  enabled: integer("enabled").notNull().default(1),
  updatedAt: integer("updated_at").notNull(),
});

export const autopublishState = sqliteTable("autopublish_state", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  running: integer("running").notNull().default(0),
  currentCluster: text("current_cluster"),
  intervalMs: integer("interval_ms").notNull().default(3600000),
  lastPublishedAt: integer("last_published_at"),
  lastAttemptAt: integer("last_attempt_at"),
  updatedAt: integer("updated_at").notNull(),
});

export const reelsMetrics = sqliteTable("reels_metrics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: text("account_id"),
  reelId: text("reel_id").notNull(),
  publishLogId: integer("publish_log_id"),
  patchVersion: text("patch_version"),
  template: text("template"),
  topic: text("topic"),
  caption: text("caption"),
  descriptionType: text("description_type"),
  hashtags: text("hashtags"),
  steveCreeperUsed: integer("steve_creeper_used").notNull().default(0),
  views: integer("views").notNull().default(0),
  likes: integer("likes").notNull().default(0),
  comments: integer("comments").notNull().default(0),
  saves: integer("saves").notNull().default(0),
  shares: integer("shares").notNull().default(0),
  avgWatchTime: real("avg_watch_time").notNull().default(0),
  metricsUpdatedAt: integer("metrics_updated_at"),
  createdAt: integer("created_at").notNull(),
});

export const metricsHistory = sqliteTable("metrics_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reelId: text("reel_id").notNull(),
  polledAt: integer("polled_at").notNull(),
  views: integer("views").notNull().default(0),
  likes: integer("likes").notNull().default(0),
  comments: integer("comments").notNull().default(0),
  saves: integer("saves").notNull().default(0),
  shares: integer("shares").notNull().default(0),
  avgWatchTime: real("avg_watch_time").notNull().default(0),
});

export const carouselMetrics = sqliteTable("carousel_metrics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: text("account_id"),
  carouselId: text("carousel_id").notNull(),
  publishLogId: integer("publish_log_id"),
  patchVersion: text("patch_version"),
  topic: text("topic"),
  caption: text("caption"),
  slidesCount: integer("slides_count").notNull(),
  slidesJson: text("slides_json"),
  views: integer("views").notNull().default(0),
  likes: integer("likes").notNull().default(0),
  comments: integer("comments").notNull().default(0),
  saves: integer("saves").notNull().default(0),
  shares: integer("shares").notNull().default(0),
  reach: integer("reach").notNull().default(0),
  metricsUpdatedAt: integer("metrics_updated_at"),
  createdAt: integer("created_at").notNull(),
});

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  platform: text("platform").notNull().default("instagram"),
  username: text("username").notNull(),
  accessToken: text("access_token").notNull(),
  userId: text("user_id").notNull(),
  niche: text("niche").notNull().default("trends"),
  template: text("template").notNull().default("forest"),
  postingFrequency: integer("posting_frequency").notNull().default(3),
  isActive: integer("is_active").notNull().default(1),
  lastQuoteIndex: integer("last_quote_index").notNull().default(0),
  igEnabled: integer("ig_enabled").notNull().default(1),
  ytEnabled: integer("yt_enabled").notNull().default(1),
  abTestingEnabled: integer("ab_testing_enabled").notNull().default(0),
  abMainTemplate: text("ab_main_template"),
  abTestTemplate: text("ab_test_template"),
  junctionCaptionsEnabled: integer("junction_captions_enabled").notNull().default(0),
  prepopulatedCaptionsEnabled: integer("prepopulated_captions_enabled").notNull().default(0),
  whisperVoiceEnabled: integer("whisper_voice_enabled").notNull().default(1),
  captionMode: text("caption_mode").notNull().default("off"),
  carouselAutoEnabled: integer("carousel_auto_enabled").notNull().default(0),
  carouselsPerDay: integer("carousels_per_day").notNull().default(0),
  steveCreeperEnabled: integer("steve_creeper_enabled").notNull().default(0),
  /** Default copy for autopost panel (per account, e.g. default vs magnetic). Exported in panel dump. */
  autopostHeadline: text("autopost_headline"),
  autopostSummary: text("autopost_summary"),
  autopostCaption: text("autopost_caption"),
  createdAt: integer("created_at").notNull(),
});

export const accountPostingState = sqliteTable("account_posting_state", {
  accountId: text("account_id").primaryKey().references(() => accounts.id),
  lastPublishedAt: integer("last_published_at"),
  postCountToday: integer("post_count_today").notNull().default(0),
  dayDate: text("day_date"),
  updatedAt: integer("updated_at").notNull(),
});

export const patches = sqliteTable("patches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  version: text("version").notNull(),
  description: text("description").notNull(),
  isActive: integer("is_active").notNull().default(1),
  config: text("config").notNull(),
  totalReels: integer("total_reels").notNull().default(0),
  avgViews: real("avg_views"),
  avgLikes: real("avg_likes"),
  avgSaves: real("avg_saves"),
  avgShares: real("avg_shares"),
  avgWatchTime: real("avg_watch_time"),
  bestPerformer: text("best_performer"),
  worstPerformer: text("worst_performer"),
  summaryJson: text("summary_json"),
  commitHash: text("commit_hash"),
  createdAt: integer("created_at").notNull(),
  closedAt: integer("closed_at"),
});

export const recommendations = sqliteTable("recommendations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  basedOnPatches: text("based_on_patches").notNull(),
  modelUsed: text("model_used").notNull(),
  summary: text("summary").notNull(),
  whatWorks: text("what_works"),
  whatDoesntWork: text("what_doesnt_work"),
  trend: text("trend"),
  recommendationsJson: text("recommendations_json"),
  suggestedChangesJson: text("suggested_changes_json"),
  confidence: text("confidence"),
  status: text("status").notNull().default("pending"),
  humanNotes: text("human_notes"),
  resultingPatchVersion: text("resulting_patch_version"),
  outcome: text("outcome"),
  outcomeNotes: text("outcome_notes"),
  createdAt: integer("created_at").notNull(),
});
