import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import * as schema from "./schema";

const dataDir = process.env.AUTOPOST_DATA_DIR || process.cwd();
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

const dbPath = join(dataDir, "autopost.sqlite");
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");

sqlite.exec(`
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS synced_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL DEFAULT '',
  access_token TEXT NOT NULL,
  user_id TEXT NOT NULL,
  ig_enabled INTEGER NOT NULL DEFAULT 1,
  template TEXT NOT NULL DEFAULT 'forest',
  niche TEXT NOT NULL DEFAULT 'trends',
  caption_mode TEXT NOT NULL DEFAULT 'off',
  whisper_voice_enabled INTEGER NOT NULL DEFAULT 1,
  autopost_headline TEXT,
  autopost_summary TEXT,
  autopost_caption TEXT,
  synced_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS autopublish_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  running INTEGER NOT NULL DEFAULT 0,
  interval_ms INTEGER NOT NULL DEFAULT 3600000,
  last_publish_at INTEGER,
  selected_account_id TEXT
);
CREATE TABLE IF NOT EXISTS panel_publish_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  instagram_id TEXT,
  caption TEXT NOT NULL,
  video_url TEXT,
  published_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  error TEXT
);
CREATE TABLE IF NOT EXISTS video_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  public_url TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  published_at INTEGER,
  error TEXT
);
INSERT OR IGNORE INTO autopublish_config (id, running, interval_ms) VALUES (1, 0, 3600000);
`);

export const db = drizzle(sqlite, { schema });
