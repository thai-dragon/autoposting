import { NextResponse } from "next/server";
import { presignVideoUpload } from "@/lib/r2-presign";
import { requirePanelToken } from "@/lib/auth";

export async function POST(req: Request) {
  const deny = requirePanelToken(req);
  if (deny) return deny;
  try {
    const out = await presignVideoUpload();
    return NextResponse.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
