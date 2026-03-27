import { NextResponse } from "next/server";
import { db } from "@/db";
import { autopublishConfig, panelPublishLog } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { requirePanelToken } from "@/lib/auth";
import { getMainDb } from "@/lib/main-db";
import { accounts } from "@tt/db/schema";

export async function GET(req: Request) {
  const deny = requirePanelToken(req);
  if (deny) return deny;

  const mainDb = getMainDb();
  const triAccounts = mainDb.select().from(accounts).all();
  const masked = triAccounts.map((a) => ({
    id: a.id,
    name: a.name,
    username: a.username,
    template: a.template,
    igEnabled: a.igEnabled,
    tokenSuffix: a.accessToken ? `…${a.accessToken.slice(-6)}` : "",
  }));

  let cfg = db.select().from(autopublishConfig).where(eq(autopublishConfig.id, 1)).get();
  if (cfg && !cfg.selectedAccountId && triAccounts.length > 0) {
    const first =
      triAccounts.find((a) => a.igEnabled === 1) ?? triAccounts[0];
    db.update(autopublishConfig)
      .set({ selectedAccountId: first!.id })
      .where(eq(autopublishConfig.id, 1))
      .run();
    cfg = db.select().from(autopublishConfig).where(eq(autopublishConfig.id, 1)).get();
  }

  const logs = db
    .select()
    .from(panelPublishLog)
    .orderBy(desc(panelPublishLog.publishedAt))
    .limit(20)
    .all();

  return NextResponse.json({
    accounts: masked,
    selectedAccountId: cfg?.selectedAccountId ?? null,
    autopublishRunning: cfg?.running === 1,
    autopublish: cfg,
    logs,
  });
}
