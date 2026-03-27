import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/auth";
import { runNextPublish } from "@/lib/run-next-publish";

export async function POST(req: Request) {
  const deny = requireCronSecret(req);
  if (deny) return deny;

  const r = await runNextPublish({ respectInterval: true, requireRunning: true });
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error }, { status: r.status ?? 500 });
  }
  if ("skipped" in r) {
    return NextResponse.json({
      ok: true,
      skipped: r.skipped,
      ...(r.nextInSec != null ? { nextInSec: r.nextInSec } : {}),
    });
  }
  return NextResponse.json({
    ok: true,
    instagramId: r.instagramId,
    queueId: r.queueId,
  });
}
