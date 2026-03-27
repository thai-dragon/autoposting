import { NextRequest, NextResponse } from "next/server";
import { buildReelDescription } from "@/lib/reel-description";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { cards } = await req.json();
    const result = await buildReelDescription(cards);
    if (result.error) {
      const status = result.error === "No cards provided" ? 400 : 500;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({
      description: result.description,
      sections: result.sections ?? [],
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
