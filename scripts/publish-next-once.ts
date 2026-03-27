/**
 * One-shot autopublish (same as POST /api/reels/autopublish publish_next after start).
 * Used by autopost-panel so it does not need the main Next server or a conflicting @/ alias bundle.
 */
import { ensureAutopublishRunning, executePublishNext } from "../src/app/api/reels/autopublish/route";
import { getHostMemSnapshot } from "../src/lib/host-mem-snapshot";

async function main() {
  const start = getHostMemSnapshot();
  try {
    ensureAutopublishRunning();
    const res = await executePublishNext();
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = { raw: text };
    }
    const end = getHostMemSnapshot();
    // Single stdout line — parent route parses this; mem always visible in API JSON (Render often drops child stderr).
    process.stdout.write(
      `${JSON.stringify({
        status: res.status,
        body,
        mem: { process: "tsx-publish-next-once", start, end },
      })}\n`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stdout.write(
      `${JSON.stringify({
        status: 500,
        body: { error: msg },
        mem: { process: "tsx-publish-next-once", start, error: getHostMemSnapshot() },
      })}\n`,
    );
  }
}

void main();
