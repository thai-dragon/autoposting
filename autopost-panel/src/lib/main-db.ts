import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { desc, eq } from "drizzle-orm";
import path from "path";
import { accounts, activeTemplate } from "@tt/db/schema";
import { ensureAccountsColumns } from "@tt/db/ensure-accounts-columns";

/** Path to trend-triangulation sqlite.db (accounts, etc.). */
export function getTriangulationSqlitePath(): string {
  const explicit = process.env.SQLITE_DB_PATH?.trim();
  if (explicit) return path.resolve(explicit);
  const root = process.env.TT_REPO_ROOT?.trim() || path.join(process.cwd(), "..");
  return path.join(root, "sqlite.db");
}

let _drizzle: ReturnType<typeof drizzle> | null = null;

export function getMainDb() {
  if (!_drizzle) {
    const sqlite = new Database(getTriangulationSqlitePath());
    sqlite.pragma("journal_mode = WAL");
    ensureAccountsColumns(sqlite);
    _drizzle = drizzle(sqlite, { schema: { accounts, activeTemplate } });
  }
  return _drizzle;
}

export function getMainAccount(accountId: string) {
  return getMainDb().select().from(accounts).where(eq(accounts.id, accountId)).get();
}

/** Same idea as triangulation `getActiveTemplateSlug` — for `accounts.template === "default"`. */
export function getActiveTemplateSlugFromTriangulation(): string {
  const row = getMainDb()
    .select()
    .from(activeTemplate)
    .orderBy(desc(activeTemplate.updatedAt))
    .limit(1)
    .all()[0];
  return row?.slug ?? "cards";
}

/**
 * Which reel template panel manual generate uses: env override, else account.template,
 * else active_template row (when account template is `default`).
 */
export function resolvePanelReelTemplate(accountId: string | null | undefined): string {
  const env = process.env.AUTOPOST_PANEL_TEMPLATE?.trim();
  if (env) return env;
  if (!accountId) return getActiveTemplateSlugFromTriangulation();
  const acc = getMainAccount(accountId);
  if (!acc) return getActiveTemplateSlugFromTriangulation();
  const t = acc.template?.trim();
  if (t && t !== "default") return t;
  return getActiveTemplateSlugFromTriangulation();
}
