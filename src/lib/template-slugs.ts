/** Template slug checks without DB (safe for autopost-panel + reel). */

export function isForestTemplate(slug: string): boolean {
  return slug === "forest" || slug === "forest_idea22";
}

export function isCatsTemplate(slug: string): boolean {
  return slug === "forest_cats";
}

export function isRobloxTemplate(slug: string): boolean {
  return slug === "roblox_idea22";
}
