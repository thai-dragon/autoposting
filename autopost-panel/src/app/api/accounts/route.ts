import { NextResponse } from "next/server";
import { requirePanelToken } from "@/lib/auth";
import { getMainDb } from "@/lib/main-db";
import { accounts } from "@tt/db/schema";

export async function GET(req: Request) {
  const deny = requirePanelToken(req);
  if (deny) return deny;

  const rows = getMainDb()
    .select()
    .from(accounts)
    .all();
  return NextResponse.json(
    rows.map((a) => ({
      id: a.id,
      name: a.name,
      username: a.username,
      template: a.template,
      igEnabled: a.igEnabled,
      accessToken: a.accessToken ? `…${a.accessToken.slice(-6)}` : "",
    })),
  );
}
