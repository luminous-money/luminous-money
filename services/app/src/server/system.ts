/**
 * The system page's facts (production readiness): for admins alone, people named by email in
 * `LUMINOUS_MONEY_ADMINS` whose email is confirmed (auth says so, X-User-Email-Verified). No one
 * else sees any of it, or learns that an upgrade is waiting.
 *
 * - **Services:** each one's health, version and database schema (their own `/health`).
 * - **The certificate,** with a domain (as `/api/health` watches it).
 * - **Data:** the databases' and attachments' size on the volume.
 * - **The last backup,** from the marker `luminous-money backup` leaves on the volume.
 * - **Updates:** the policy (`LUMINOUS_MONEY_UPDATES`: `off`, `notify`, `auto`), and with
 *   anything but `off`, the latest release on GitHub, asked once a day (and on demand). Applying
 *   it is the host's (`luminous-money upgrade`, or its timer with `auto`): the app can't replace
 *   its own containers, and shouldn't be able to.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import type { Release, SystemInfo, UpdatePolicy, UpdateState } from "../shared/system.js";
import type { DailyJob } from "./daily.js";
import { certificateHealth, probe, type Peers } from "./health.js";

export { UPDATE_POLICIES, type UpdatePolicy } from "../shared/system.js";

/** Semver's order for x.y.z (anything after a `-` sorts before the release itself). */
export function newerThan(candidate: string, running: string): boolean {
  const parse = (v: string) => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(v.trim());
    return m ? { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null } : null;
  };
  const a = parse(candidate);
  const b = parse(running);
  if (!a || !b) return false; // a development build isn't on the release line
  for (let i = 0; i < 3; i++) if (a.nums[i] !== b.nums[i]) return a.nums[i]! > b.nums[i]!;
  if (a.pre === b.pre) return false;
  return a.pre === null || (b.pre !== null && a.pre > b.pre);
}

/** The latest release of `repo` on GitHub, or null if it has none. */
export async function latestRelease(
  repo: string,
  version: string,
  fetchImpl: typeof fetch = fetch
): Promise<Release | null> {
  const response = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { accept: "application/vnd.github+json", "user-agent": `luminous-money/${version}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  const body = (await response.json()) as {
    tag_name: string;
    name?: string | null;
    html_url: string;
    published_at?: string | null;
  };
  return {
    version: body.tag_name.replace(/^v/, ""),
    name: body.name ?? null,
    url: body.html_url,
    published_at: body.published_at ?? null,
  };
}

/** What a data directory holds: each database (with its WAL files) and the attachments. */
export function dataUsage(dir: string): SystemInfo["data"] {
  const sizes = new Map<string, number>();
  let attachments = 0;
  const walk = (path: string): number =>
    statSync(path).isDirectory()
      ? readdirSync(path).reduce((n, name) => n + walk(join(path, name)), 0)
      : statSync(path).size;
  for (const name of readdirSync(dir)) {
    const m = /^(.+\.sqlite)(-wal|-shm)?$/.exec(name);
    if (m) sizes.set(m[1]!, (sizes.get(m[1]!) ?? 0) + statSync(join(dir, name)).size);
    else if (name === "attachments") attachments = walk(join(dir, name));
  }
  const databases = [...sizes]
    .map(([name, bytes]) => ({ name, bytes }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    databases,
    attachments,
    total: databases.reduce((n, d) => n + d.bytes, attachments),
  };
}

export type SystemOptions = {
  version: string;
  dataDir: string;
  peers: Peers;
  policy: UpdatePolicy;
  upgradeAt: string | null;
  /** The GitHub repository releases come from (`owner/name`). */
  repo: string;
  /** app's own database schema. */
  schema?: () => number;
  fetchImpl?: typeof fetch;
};

export function createSystem(options: SystemOptions) {
  const { version, dataDir, peers, policy, upgradeAt, repo, schema, fetchImpl = fetch } = options;
  const updates: UpdateState = {
    policy,
    upgrade_at: policy === "auto" ? upgradeAt : null,
    latest: null,
    newer: false,
    checked_at: null,
    error: null,
  };

  /** Ask GitHub for the latest release, unless updates are off. */
  async function check(): Promise<UpdateState> {
    if (policy === "off") return updates;
    try {
      updates.latest = await latestRelease(repo, version, fetchImpl);
      updates.newer = !!updates.latest && newerThan(updates.latest.version, version);
      updates.error = updates.latest ? null : "no releases yet";
    } catch (error) {
      updates.error = error instanceof Error ? error.message : String(error);
    }
    updates.checked_at = new Date().toISOString();
    return updates;
  }

  async function info(): Promise<SystemInfo> {
    const names = ["auth", "ledger", "ai"] as const;
    const [probed, certificate] = await Promise.all([
      Promise.all(names.map((n) => probe(peers[n], fetchImpl))),
      certificateHealth(peers, fetchImpl),
    ]);
    let backup: SystemInfo["backup"] = null;
    try {
      backup = JSON.parse(readFileSync(join(dataDir, "last-backup.json"), "utf8"));
    } catch {
      // none made with `luminous-money backup` yet
    }
    return {
      version,
      services: [
        { name: "app", status: "up", version, schema: schema?.() ?? null },
        ...names.map((name, i) => ({ name, ...probed[i]! })),
      ],
      ...(certificate ? { certificate } : {}),
      data: dataUsage(dataDir),
      backup,
      updates: { ...updates },
    };
  }

  /** Once a day (and at start), the update check. */
  const job: DailyJob = {
    name: "updates",
    at: 5 * 60,
    zones: () => [undefined],
    async run() {
      if (policy === "off") return undefined;
      const state = await check();
      return state.newer
        ? `release ${state.latest!.version} is out (running ${version})`
        : undefined;
    },
  };

  return { check, info, job };
}

export type System = ReturnType<typeof createSystem>;
