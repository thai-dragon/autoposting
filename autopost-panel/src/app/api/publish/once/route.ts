import { NextResponse } from "next/server";
import { requirePanelToken } from "@/lib/auth";
import { runNextPublish } from "@/lib/run-next-publish";

/** Post the next pending queue item now (ignores autopublish switch and interval). */
export async function POST(req: Request) {
  const deny = requirePanelToken(req);
  if (deny) return deny;

  const r = await runNextPublish({ respectInterval: false, requireRunning: false });
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error }, { status: r.status ?? 500 });
  }
  if ("skipped" in r) {
    return NextResponse.json({ ok: true, skipped: r.skipped });
  }
  return NextResponse.json({
    ok: true,
    instagramId: r.instagramId,
    queueId: r.queueId,
  });
}
