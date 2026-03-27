import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "path";
import * as schema from "./schema";
import { ensureAccountsColumns } from "./ensure-accounts-columns";

const dbPath = process.env.SQLITE_DB_PATH?.trim()
  ? path.resolve(process.env.SQLITE_DB_PATH.trim())
  : path.join(process.env.TT_REPO_ROOT?.trim() || process.cwd(), "sqlite.db");
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
ensureAccountsColumns(sqlite);

export const db = drizzle(sqlite, { schema });
