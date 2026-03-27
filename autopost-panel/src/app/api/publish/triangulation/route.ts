import { existsSync } from "fs";
import { join, resolve } from "path";
import { execFileSync } from "child_process";
import { NextResponse } from "next/server";
import { requirePanelToken } from "@/lib/auth";

function repoRoot(): string {
  const fromEnv = process.env.TT_REPO_ROOT?.trim();
  if (fromEnv) return resolve(fromEnv);
  return resolve(process.cwd(), "..");
}

function tsxBinary(root: string): string {
  return join(root, "node_modules", ".bin", "tsx");
}

/**
 * One-shot publish: same pipeline as main app, run via root `tsx` (no second HTTP server).
 * Set TT_REPO_ROOT to the trend-triangulation repo if the panel cwd is not autopost-panel/.
 */
export async function POST(req: Request) {
  const deny = requirePanelToken(req);
  if (deny) return deny;

  const root = repoRoot();
  const tsx = tsxBinary(root);
  const script = join(root, "scripts", "publish-next-once.ts");

  if (!existsSync(tsx)) {
    return NextResponse.json(
      {
        error: `tsx not found at ${tsx}. Install deps from repo root (pnpm install).`,
      },
      { status: 500 },
    );
  }
  if (!existsSync(script)) {
    return NextResponse.json({ error: `Missing script ${script}` }, { status: 500 });
  }

  try {
    const stdout = execFileSync(tsx, [script], {
      cwd: root,
      env: { ...process.env },
      maxBuffer: 32 * 1024 * 1024,
      encoding: "utf8",
    });
    const line = stdout.trim().split("\n").filter(Boolean).pop();
    if (!line) {
      return NextResponse.json({ error: "Empty output from publish script" }, { status: 500 });
    }
    const parsed = JSON.parse(line) as {
      status: number;
      body: unknown;
      mem?: { process?: string; start?: unknown; end?: unknown; error?: unknown };
    };
    const payload =
      typeof parsed.body === "object" && parsed.body !== null && !Array.isArray(parsed.body)
        ? { ...(parsed.body as Record<string, unknown>), _mem: parsed.mem }
        : { result: parsed.body, _mem: parsed.mem };
    return NextResponse.json(payload, { status: parsed.status });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        error: "publish-next-once failed",
        detail: msg.slice(0, 800),
      },
      { status: 500 },
    );
  }
}
