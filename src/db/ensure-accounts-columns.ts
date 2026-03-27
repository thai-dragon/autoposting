import type Database from "better-sqlite3";

/** Older sqlite.db files may lack columns added in schema; Drizzle SELECT fails until migrated. */
export function ensureAccountsColumns(raw: Database.Database) {
  const t = raw
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='accounts'")
    .get() as { name?: string } | undefined;
  if (!t) return;
  const cols = raw.prepare("PRAGMA table_info(accounts)").all() as { name: string }[];
  const have = new Set(cols.map((c) => c.name));
  const add: { name: string; ddl: string }[] = [
    { name: "ab_testing_enabled", ddl: "INTEGER NOT NULL DEFAULT 0" },
    { name: "ab_main_template", ddl: "TEXT" },
    { name: "ab_test_template", ddl: "TEXT" },
    { name: "junction_captions_enabled", ddl: "INTEGER NOT NULL DEFAULT 0" },
    { name: "prepopulated_captions_enabled", ddl: "INTEGER NOT NULL DEFAULT 0" },
    { name: "whisper_voice_enabled", ddl: "INTEGER NOT NULL DEFAULT 1" },
    { name: "caption_mode", ddl: "TEXT NOT NULL DEFAULT 'off'" },
    { name: "carousel_auto_enabled", ddl: "INTEGER NOT NULL DEFAULT 0" },
    { name: "carousels_per_day", ddl: "INTEGER NOT NULL DEFAULT 0" },
    { name: "steve_creeper_enabled", ddl: "INTEGER NOT NULL DEFAULT 0" },
    { name: "autopost_headline", ddl: "TEXT" },
    { name: "autopost_summary", ddl: "TEXT" },
    { name: "autopost_caption", ddl: "TEXT" },
  ];
  for (const { name, ddl } of add) {
    if (!have.has(name)) {
      raw.exec(`ALTER TABLE accounts ADD COLUMN ${name} ${ddl}`);
      have.add(name);
    }
  }
}
