import { NextResponse } from "next/server";

export async function GET() {
  const ok = Boolean(process.env.PANEL_ACCESS_TOKEN);
  return NextResponse.json({ ok, service: "autopost-panel" });
}
