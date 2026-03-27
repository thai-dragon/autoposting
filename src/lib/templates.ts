import { db } from "@/db";
import { activeTemplate } from "@/db/schema";
import { desc } from "drizzle-orm";

export { isCatsTemplate, isForestTemplate, isRobloxTemplate } from "./template-slugs";

export function getActiveTemplateSlug(): string {
  const row = db.select().from(activeTemplate).orderBy(desc(activeTemplate.updatedAt)).limit(1).all()[0];
  return row?.slug ?? "cards";
}
