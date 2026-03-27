import { db } from "@/db";
import { platformSettings } from "@/db/schema";
import { eq } from "drizzle-orm";

export function getPlatformSettings(): { instagram: boolean; youtube: boolean } {
  const rows = db.select().from(platformSettings).all();
  const map = new Map(rows.map((r) => [r.platform, r.enabled === 1]));
  return {
    instagram: map.get("instagram") ?? true,
    youtube: map.get("youtube") ?? true,
  };
}
