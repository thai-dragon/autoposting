import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { autopublishConfig } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requirePanelToken } from "@/lib/auth";
import { getMainAccount } from "@/lib/main-db";

export async function POST(req: NextRequest) {
  const deny = requirePanelToken(req);
  if (deny) return deny;

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const row = getMainAccount(String(id));
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  db.update(autopublishConfig)
    .set({ selectedAccountId: String(id) })
    .where(eq(autopublishConfig.id, 1))
    .run();

  return NextResponse.json({ ok: true });
}
