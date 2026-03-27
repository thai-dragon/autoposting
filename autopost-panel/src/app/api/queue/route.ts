import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { videoQueue } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { requirePanelToken } from "@/lib/auth";
import { getMainAccount } from "@/lib/main-db";

export async function GET(req: Request) {
  const deny = requirePanelToken(req);
  if (deny) return deny;

  const rows = db.select().from(videoQueue).orderBy(desc(videoQueue.createdAt)).limit(50).all();
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const deny = requirePanelToken(req);
  if (deny) return deny;

  const body = await req.json();
  const { accountId, r2Key, publicUrl, caption } = body;
  if (!accountId || !r2Key || !publicUrl) {
    return NextResponse.json(
      { error: "accountId, r2Key, publicUrl required" },
      { status: 400 },
    );
  }

  if (!getMainAccount(String(accountId))) {
    return NextResponse.json({ error: "unknown account" }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);
  const r = db
    .insert(videoQueue)
    .values({
      accountId: String(accountId),
      r2Key: String(r2Key),
      publicUrl: String(publicUrl),
      caption: typeof caption === "string" ? caption : "",
      status: "pending",
      createdAt: now,
    })
    .run();

  return NextResponse.json({ id: Number(r.lastInsertRowid), ok: true });
}

export async function PATCH(req: NextRequest) {
  const deny = requirePanelToken(req);
  if (deny) return deny;

  const { id, status } = await req.json();
  if (id == null || !status) {
    return NextResponse.json({ error: "id and status required" }, { status: 400 });
  }
  if (status !== "cancelled") {
    return NextResponse.json({ error: "only status=cancelled" }, { status: 400 });
  }

  db.update(videoQueue)
    .set({ status: "cancelled" })
    .where(eq(videoQueue.id, Number(id)))
    .run();

  return NextResponse.json({ ok: true });
}
