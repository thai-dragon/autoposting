import { existsSync, readFileSync } from "fs";
import { execFileSync } from "child_process";

export type HostMemSnapshot = {
  /** process.memoryUsage() — только Node/V8 */
  node: {
    rssMB: number;
    heapUsedMB: number;
    externalMB: number;
  };
  /** VmRSS из /proc/self/status (Linux), обычно близко к node.rss */
  procSelfRssMB?: number;
  /** cgroup v2/v1 — фактическое потребление контейнера (если доступно) */
  cgroup?: { usageMB?: number; peakMB?: number; limitMB?: number };
  /**
   * Сумма RSS процесса и всех потомков (node → shell → ffmpeg и т.д.).
   * Только Linux; на macOS не заполняется.
   */
  tree?: { totalRssMB: number; lines: string[] };
};

function roundMb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

function parseVmRssKb(status: string): number | undefined {
  const m = status.match(/^VmRSS:\s+(\d+)\s+kB/im);
  return m ? parseInt(m[1], 10) : undefined;
}

function readCgroup(): HostMemSnapshot["cgroup"] {
  if (existsSync("/sys/fs/cgroup/memory.current")) {
    try {
      const usage = parseInt(readFileSync("/sys/fs/cgroup/memory.current", "utf8").trim(), 10);
      const out: NonNullable<HostMemSnapshot["cgroup"]> = {
        usageMB: roundMb(usage),
      };
      if (existsSync("/sys/fs/cgroup/memory.max")) {
        const maxRaw = readFileSync("/sys/fs/cgroup/memory.max", "utf8").trim();
        if (maxRaw !== "max") {
          const lim = parseInt(maxRaw, 10);
          if (!Number.isNaN(lim)) out.limitMB = roundMb(lim);
        }
      }
      return out;
    } catch {
      return undefined;
    }
  }
  if (existsSync("/sys/fs/cgroup/memory/memory.usage_in_bytes")) {
    try {
      const usage = parseInt(readFileSync("/sys/fs/cgroup/memory/memory.usage_in_bytes", "utf8").trim(), 10);
      return { usageMB: roundMb(usage) };
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function sumProcessTreeRss(rootPid: number): { totalRssMB: number; lines: string[] } {
  const out = execFileSync("ps", ["-eo", "pid=", "ppid=", "rss=", "comm="], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  type Row = { pid: number; ppid: number; rssKb: number; comm: string };
  const rows: Row[] = [];
  for (const line of out.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split(/\s+/);
    if (parts.length < 4) continue;
    const pid = parseInt(parts[0], 10);
    const ppid = parseInt(parts[1], 10);
    const rssKb = parseInt(parts[2], 10);
    const comm = parts.slice(3).join(" ");
    if (Number.isNaN(pid) || Number.isNaN(rssKb)) continue;
    rows.push({ pid, ppid, rssKb, comm });
  }
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  const children = new Map<number, number[]>();
  for (const r of rows) {
    if (!children.has(r.ppid)) children.set(r.ppid, []);
    children.get(r.ppid)!.push(r.pid);
  }
  const inTree = new Set<number>();
  function dfs(pid: number) {
    if (inTree.has(pid)) return;
    inTree.add(pid);
    for (const c of children.get(pid) || []) dfs(c);
  }
  dfs(rootPid);
  let totalKb = 0;
  const lines: { rssKb: number; comm: string }[] = [];
  for (const pid of inTree) {
    const r = byPid.get(pid);
    if (r) {
      totalKb += r.rssKb;
      lines.push({ rssKb: r.rssKb, comm: r.comm.slice(0, 80) });
    }
  }
  lines.sort((a, b) => b.rssKb - a.rssKb);
  return {
    totalRssMB: Math.round((totalKb / 1024) * 10) / 10,
    lines: lines.slice(0, 8).map((l) => `${l.rssKb} KB ${l.comm}`),
  };
}

/**
 * Снимок для диагностики OOM на Render/Linux: Node + cgroup + дерево PID (ffmpeg внутри tree).
 */
export function getHostMemSnapshot(): HostMemSnapshot {
  const m = process.memoryUsage();
  const node = {
    rssMB: roundMb(m.rss),
    heapUsedMB: roundMb(m.heapUsed),
    externalMB: roundMb(m.external),
  };
  let procSelfRssMB: number | undefined;
  if (existsSync("/proc/self/status")) {
    try {
      const kb = parseVmRssKb(readFileSync("/proc/self/status", "utf8"));
      if (kb !== undefined) procSelfRssMB = Math.round((kb / 1024) * 10) / 10;
    } catch {
      /* ignore */
    }
  }
  const cgroup = readCgroup();
  let tree: HostMemSnapshot["tree"];
  if (process.platform === "linux") {
    try {
      tree = sumProcessTreeRss(process.pid);
    } catch {
      /* ps формат / sandbox */
    }
  }
  return { node, procSelfRssMB, cgroup, tree };
}
