"use client";

import { useCallback, useEffect, useState } from "react";

const TOKEN_KEY = "autopost_panel_token";
const ACCENT = "#D91B24";

type AccountRow = {
  id: string;
  name: string;
  username: string;
  template: string;
  igEnabled: number;
  tokenSuffix: string;
};

type Dashboard = {
  accounts: AccountRow[];
  selectedAccountId: string | null;
  autopublishRunning: boolean;
  autopublish: {
    running: number;
    intervalMs: number;
    lastPublishAt: number | null;
    selectedAccountId: string | null;
  } | null;
  logs: {
    id: number;
    status: string;
    instagramId: string | null;
    publishedAt: number;
    error: string | null;
  }[];
};

function headersJson(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export default function Page() {
  const [tokenInput, setTokenInput] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [busy, setBusy] = useState(false);
  /** RSS/heap for tsx child from last Publish now (see _mem in JSON). */
  const [lastPublishMem, setLastPublishMem] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setErr(null);
    const r = await fetch("/api/dashboard", { headers: headersJson(token) });
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      setErr(j.error || r.statusText);
      return;
    }
    setDash((await r.json()) as Dashboard);
  }, [token]);

  useEffect(() => {
    const t = typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
    if (t) setToken(t);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function saveToken() {
    const t = tokenInput.trim();
    if (!t) return;
    localStorage.setItem(TOKEN_KEY, t);
    setToken(t);
    setTokenInput("");
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setDash(null);
  }

  async function selectAccount(id: string) {
    if (!token) return;
    const r = await fetch("/api/accounts/select", {
      method: "POST",
      headers: headersJson(token),
      body: JSON.stringify({ id }),
    });
    if (!r.ok) setErr(((await r.json()) as { error?: string }).error ?? "Error");
    await load();
  }

  async function setAutopublish(on: boolean) {
    if (!token || !dash?.autopublish) return;
    const r = await fetch("/api/autopublish", {
      method: "PATCH",
      headers: headersJson(token),
      body: JSON.stringify({
        running: on,
        intervalMs: dash.autopublish.intervalMs,
      }),
    });
    if (!r.ok) setErr(((await r.json()) as { error?: string }).error ?? "Error");
    await load();
  }

  async function publishNow() {
    if (!token) return;
    setBusy(true);
    setErr(null);
    setLastPublishMem(null);
    try {
      const r = await fetch("/api/publish/triangulation", {
        method: "POST",
        headers: headersJson(token),
      });
      const raw = await r.text();
      let j: Record<string, unknown>;
      try {
        j = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        setErr(`HTTP ${r.status}: ${raw.slice(0, 400)}`);
        return;
      }
      const mem = j._mem;
      if (mem !== undefined && mem !== null) {
        setLastPublishMem(JSON.stringify(mem, null, 2));
      }
      if (!r.ok) {
        setErr(String(j.error || j.detail || r.statusText));
        return;
      }
      if (j.skipped === true) {
        setErr(`Skipped: ${String(j.reason || "unknown")}`);
      } else {
        setErr(null);
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <main className="mx-auto max-w-md px-4 py-12">
        <h1 className="text-2xl font-semibold" style={{ color: ACCENT }}>
          Autopost
        </h1>
        <p className="mt-3 text-sm text-[var(--muted)]">
          Enter access token (same as <code className="text-white/80">PANEL_ACCESS_TOKEN</code> on the server).
          Stored in this browser only.
        </p>
        <input
          type="password"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          placeholder="Token"
          className="mt-5 w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-base outline-none focus:border-[var(--accent)]"
        />
        <button
          type="button"
          onClick={saveToken}
          className="mt-4 w-full rounded-xl py-3 text-sm font-semibold text-white"
          style={{ backgroundColor: ACCENT }}
        >
          Continue
        </button>
      </main>
    );
  }

  const lastPub = dash?.autopublish?.lastPublishAt;
  const lastLog = dash?.logs?.[0];

  return (
    <main className="mx-auto max-w-md px-4 py-8 pb-16">
      <header className="mb-8 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: ACCENT }}>
            Autopost
          </h1>
        </div>
        <button
          type="button"
          onClick={logout}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted)]"
        >
          Sign out
        </button>
      </header>

      {err && (
        <div
          className="mb-4 rounded-xl border px-3 py-2 text-sm"
          style={{ borderColor: ACCENT, background: "#2a0a0c", color: "#ffb4b8" }}
        >
          {err}
        </div>
      )}

      {lastPublishMem && (
        <div className="mb-4 rounded-xl border border-[var(--border)] bg-neutral-900/80 p-3">
          <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
            Child process memory (tsx publish-next-once)
          </div>
          <pre className="mt-2 max-h-48 overflow-auto text-[11px] leading-snug text-neutral-300 whitespace-pre-wrap">
            {lastPublishMem}
          </pre>
        </div>
      )}

      <section className="mb-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Account</h2>
        <ul className="mt-3 space-y-2">
          {(dash?.accounts ?? []).map((a) => {
            const sel = dash?.selectedAccountId === a.id;
            return (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => void selectAccount(a.id)}
                  className="flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left text-sm transition-colors"
                  style={{
                    borderColor: sel ? ACCENT : "var(--border)",
                    background: sel ? "rgba(217, 27, 36, 0.12)" : "transparent",
                  }}
                >
                  <div>
                    <div className="font-medium">{a.name}</div>
                    <div className="text-xs text-[var(--muted)]">
                      {a.username} · {a.tokenSuffix}
                      {a.igEnabled !== 1 && " · IG off"}
                    </div>
                  </div>
                  {sel && (
                    <span className="text-xs font-semibold" style={{ color: ACCENT }}>
                      Active
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        {dash?.accounts.length === 0 && (
          <p className="text-sm text-[var(--muted)]">No accounts in triangulation DB.</p>
        )}
      </section>

      <section className="mb-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
              Autoposting
            </h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Interval posting while enabled (same accounts as triangulation).
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={dash?.autopublishRunning ?? false}
            disabled={!dash}
            onClick={() => void setAutopublish(!dash?.autopublishRunning)}
            className="relative h-8 w-14 shrink-0 rounded-full transition-colors"
            style={{
              backgroundColor: dash?.autopublishRunning ? ACCENT : "#333",
            }}
          >
            <span
              className="absolute top-1 left-1 h-6 w-6 rounded-full bg-white shadow transition-transform"
              style={{
                transform: dash?.autopublishRunning ? "translateX(24px)" : "translateX(0)",
              }}
            />
          </button>
        </div>

        <dl className="mt-4 space-y-2 border-t border-[var(--border)] pt-4 text-sm">
          <div className="flex justify-between gap-2">
            <dt className="text-[var(--muted)]">Status</dt>
            <dd>{dash?.autopublishRunning ? "On" : "Off"}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-[var(--muted)]">Last publish</dt>
            <dd className="text-right">
              {lastPub != null
                ? new Date(lastPub * 1000).toLocaleString()
                : lastLog
                  ? new Date(lastLog.publishedAt * 1000).toLocaleString()
                  : "—"}
            </dd>
          </div>
        </dl>

        <button
          type="button"
          disabled={busy}
          onClick={() => void publishNow()}
          className="mt-4 w-full rounded-xl py-3 text-sm font-semibold text-white disabled:opacity-40"
          style={{ backgroundColor: ACCENT }}
        >
          {busy ? "…" : "Publish now"}
        </button>
      </section>
    </main>
  );
}
