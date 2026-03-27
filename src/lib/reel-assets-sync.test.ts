import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import test from "node:test";
import { ensureReelAssetsFromManifest } from "./reel-assets-sync";

const origFetch = globalThis.fetch;
const origEnv: Record<string, string | undefined> = {};

function saveEnv(keys: string[]) {
  for (const k of keys) origEnv[k] = process.env[k];
}

function restoreEnv(keys: string[]) {
  for (const k of keys) {
    if (origEnv[k] === undefined) delete process.env[k];
    else process.env[k] = origEnv[k];
  }
}

test.afterEach(() => {
  globalThis.fetch = origFetch;
  restoreEnv([
    "TT_REEL_ASSETS_MANIFEST_URL",
    "TT_REEL_ASSETS_BASE_URL",
    "TT_REPO_ROOT",
  ]);
});

test("ensureReelAssetsFromManifest: no TT_REEL_ASSETS_MANIFEST_URL is a no-op", async () => {
  saveEnv(["TT_REEL_ASSETS_MANIFEST_URL"]);
  delete process.env.TT_REEL_ASSETS_MANIFEST_URL;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls++;
    return new Response("{}", { status: 200 });
  };
  await ensureReelAssetsFromManifest();
  assert.equal(fetchCalls, 0);
});

test("ensureReelAssetsFromManifest: downloads missing files under TT_REPO_ROOT", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reel-assets-test-"));
  saveEnv(["TT_REEL_ASSETS_MANIFEST_URL", "TT_REPO_ROOT"]);
  process.env.TT_REPO_ROOT = dir;
  process.env.TT_REEL_ASSETS_MANIFEST_URL = "https://fake.test/reel-assets/manifest.json";

  const payload = new Uint8Array([1, 2, 3, 4, 5]);
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("manifest.json")) {
      return new Response(
        JSON.stringify({
          version: 1,
          files: [{ path: "assets/sounds/demo.bin", bytes: payload.length }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("assets/sounds/demo.bin")) {
      assert.match(url, /demo\.bin$/);
      return new Response(payload, { status: 200 });
    }
    return new Response("missing", { status: 404 });
  };

  await ensureReelAssetsFromManifest();
  const dest = resolve(dir, "assets/sounds/demo.bin");
  assert.ok(readFileSync(dest).equals(Buffer.from(payload)));

  rmSync(dir, { recursive: true, force: true });
});

test("ensureReelAssetsFromManifest: skips fetch when size matches manifest", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reel-assets-test-"));
  saveEnv(["TT_REEL_ASSETS_MANIFEST_URL", "TT_REPO_ROOT"]);
  process.env.TT_REPO_ROOT = dir;
  process.env.TT_REEL_ASSETS_MANIFEST_URL = "https://fake.test/x/manifest.json";

  const existing = Buffer.from("abc");
  mkdirSync(join(dir, "assets/sounds"), { recursive: true });
  writeFileSync(join(dir, "assets/sounds/skip.bin"), existing);

  const urls: string[] = [];
  globalThis.fetch = async (input: RequestInfo | URL) => {
    urls.push(String(input));
    if (String(input).includes("manifest.json")) {
      return new Response(
        JSON.stringify({
          version: 1,
          files: [{ path: "assets/sounds/skip.bin", bytes: existing.length }],
        }),
        { status: 200 },
      );
    }
    return new Response("should-not-download", { status: 200 });
  };

  await ensureReelAssetsFromManifest();
  assert.equal(urls.length, 1);
  assert.ok(urls[0].includes("manifest.json"));

  rmSync(dir, { recursive: true, force: true });
});

test("ensureReelAssetsFromManifest: uses TT_REEL_ASSETS_BASE_URL for file URLs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reel-assets-test-"));
  saveEnv([
    "TT_REEL_ASSETS_MANIFEST_URL",
    "TT_REEL_ASSETS_BASE_URL",
    "TT_REPO_ROOT",
  ]);
  process.env.TT_REPO_ROOT = dir;
  process.env.TT_REEL_ASSETS_MANIFEST_URL = "https://cdn.example/manifests/reel.json";
  process.env.TT_REEL_ASSETS_BASE_URL = "https://files.example/static";

  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("manifests/reel.json")) {
      return new Response(
        JSON.stringify({
          version: 1,
          files: [{ path: "assets/a.txt", bytes: 2 }],
        }),
        { status: 200 },
      );
    }
    if (url === "https://files.example/static/assets/a.txt") {
      return new Response(new Uint8Array([9, 9]), { status: 200 });
    }
    return new Response(`unexpected ${url}`, { status: 404 });
  };

  await ensureReelAssetsFromManifest();
  assert.deepEqual([...readFileSync(join(dir, "assets/a.txt"))], [9, 9]);

  rmSync(dir, { recursive: true, force: true });
});

test("ensureReelAssetsFromManifest: encodes path segments in file URL", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reel-assets-test-"));
  saveEnv(["TT_REEL_ASSETS_MANIFEST_URL", "TT_REPO_ROOT"]);
  process.env.TT_REPO_ROOT = dir;
  process.env.TT_REEL_ASSETS_MANIFEST_URL = "https://fake.test/p/manifest.json";

  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("manifest.json")) {
      return new Response(
        JSON.stringify({
          version: 1,
          files: [{ path: "assets/weird name/x.bin", bytes: 1 }],
        }),
        { status: 200 },
      );
    }
    if (url.includes("weird%20name")) {
      return new Response(new Uint8Array([7]), { status: 200 });
    }
    return new Response(url, { status: 404 });
  };

  await ensureReelAssetsFromManifest();
  assert.equal(readFileSync(join(dir, "assets/weird name/x.bin"))[0], 7);

  rmSync(dir, { recursive: true, force: true });
});
