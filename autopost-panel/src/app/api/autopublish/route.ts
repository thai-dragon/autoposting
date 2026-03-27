import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { autopublishConfig } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requirePanelToken } from "@/lib/auth";

export async function GET(req: Request) {
  const deny = requirePanelToken(req);
  if (deny) return deny;

  const row = db.select().from(autopublishConfig).where(eq(autopublishConfig.id, 1)).get();
  return NextResponse.json(row);
}

export async function PATCH(req: NextRequest) {
  const deny = requirePanelToken(req);
  if (deny) return deny;

  const body = await req.json();
  const { running, intervalMs, selectedAccountId } = body;

  const cur = db.select().from(autopublishConfig).where(eq(autopublishConfig.id, 1)).get();
  if (!cur) return NextResponse.json({ error: "config missing" }, { status: 500 });

  db.update(autopublishConfig)
    .set({
      running: typeof running === "boolean" ? (running ? 1 : 0) : cur.running,
      intervalMs:
        typeof intervalMs === "number" && intervalMs >= 60_000 ? intervalMs : cur.intervalMs,
      selectedAccountId:
        selectedAccountId === null
          ? null
          : typeof selectedAccountId === "string"
            ? selectedAccountId
            : cur.selectedAccountId,
    })
    .where(eq(autopublishConfig.id, 1))
    .run();

  const next = db.select().from(autopublishConfig).where(eq(autopublishConfig.id, 1)).get();
  return NextResponse.json(next);
}
