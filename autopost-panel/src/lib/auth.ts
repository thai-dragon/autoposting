import { NextResponse } from "next/server";

export function requirePanelToken(req: Request): NextResponse | null {
  const want = process.env.PANEL_ACCESS_TOKEN;
  if (!want) {
    return NextResponse.json(
      { error: "Server misconfigured: PANEL_ACCESS_TOKEN" },
      { status: 500 },
    );
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${want}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export function requireCronSecret(req: Request): NextResponse | null {
  const want = process.env.CRON_SECRET;
  if (!want) {
    return NextResponse.json(
      { error: "Server misconfigured: CRON_SECRET" },
      { status: 500 },
    );
  }
  const h = req.headers.get("authorization");
  const x = req.headers.get("x-cron-secret");
  if (h === `Bearer ${want}` || x === want) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
