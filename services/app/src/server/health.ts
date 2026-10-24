/**
 * The stack's health, for uptime monitors: `GET /api/health`, public through the gateway. `app`
 * asks each service's own `/health` (not routed outside) and answers with each one's up or down
 * only: 200 when the stack works (`ok`, or `degraded` when something needs attention but nothing
 * is broken), 503 when it doesn't (`down`).
 *
 * **With a domain** (the gateway serving HTTPS itself), its certificate is watched too, from the
 * gateway's metrics (`traefik_tls_certs_not_after`): Traefik renews it 30 days before it expires,
 * so under `EXPIRING_DAYS` left means renewals have been failing (`degraded`), and an expired or
 * missing one means browsers can't reach the site (`down`). A certificate is public anyway, so
 * saying when it expires gives nothing away.
 */
import type { CertificateHealth } from "../shared/system.js";

export type Up = "up" | "down";

export type { CertificateHealth } from "../shared/system.js";

export type StackHealth = {
  status: "ok" | "degraded" | "down";
  services: { auth: Up; ledger: Up; app: Up; ai: Up };
  /** Only when the gateway serves HTTPS for a domain. */
  certificate?: CertificateHealth;
};

/** Where each service answers `/health`; the gateway's internal port (its metrics); and the
 * domain it serves HTTPS for, if any. */
export type Peers = {
  auth: string;
  ledger: string;
  ai: string;
  gateway?: string;
  domain?: string | null;
};

/** What the stack needs: without these, nothing works. */
const REQUIRED = ["auth", "ledger", "app"] as const;

/** Under this many days left, the certificate's renewals have been failing for a while. */
export const EXPIRING_DAYS = 14;

const DAY = 24 * 60 * 60 * 1000;

/** The certificate for `domain` in the gateway's Prometheus metrics: the latest-expiring one
 * whose name or alternative names include it. */
export function certificateOf(
  metrics: string,
  domain: string,
  now = new Date()
): CertificateHealth {
  const wanted = domain.toLowerCase();
  let latest: number | null = null;
  for (const line of metrics.split("\n")) {
    const m = /^traefik_tls_certs_not_after\{(.*)\}\s+(\S+)/.exec(line);
    if (!m) continue;
    const labels = Object.fromEntries(
      [...m[1]!.matchAll(/(\w+)="((?:[^"\\]|\\.)*)"/g)].map((l) => [l[1], l[2]!.toLowerCase()])
    );
    const names = [labels["cn"], ...(labels["sans"] ?? "").split(",")].map((n) => n?.trim());
    if (!names.includes(wanted)) continue;
    const expires = Number(m[2]) * 1000;
    if (Number.isFinite(expires) && (latest === null || expires > latest)) latest = expires;
  }
  if (latest === null) return { domain, status: "missing", expires: null, days_left: null };
  const days = Math.floor((latest - now.getTime()) / DAY);
  return {
    domain,
    status: latest <= now.getTime() ? "expired" : days < EXPIRING_DAYS ? "expiring" : "ok",
    expires: new Date(latest).toISOString(),
    days_left: days,
  };
}

/** A service's own health: up or down, and when it answers, its version and schema. */
export type Probed = { status: Up; version: string | null; schema: number | null };

const get = (fetchImpl: typeof fetch, base: string, path: string) =>
  fetchImpl(`${base.replace(/\/$/, "")}${path}`, { signal: AbortSignal.timeout(3000) });

/** Ask a service's `/health`. */
export async function probe(url: string, fetchImpl: typeof fetch = fetch): Promise<Probed> {
  try {
    const response = await get(fetchImpl, url, "/health");
    if (!response.ok) return { status: "down", version: null, schema: null };
    const body = (await response.json().catch(() => ({}))) as { version?: string; schema?: number };
    return { status: "up", version: body.version ?? null, schema: body.schema ?? null };
  } catch {
    return { status: "down", version: null, schema: null };
  }
}

/** The gateway's certificate for the domain, when it serves HTTPS for one. */
export async function certificateHealth(
  peers: Peers,
  fetchImpl: typeof fetch = fetch,
  now = new Date()
): Promise<CertificateHealth | undefined> {
  if (!peers.domain || !peers.gateway) return undefined;
  try {
    const response = await get(fetchImpl, peers.gateway, "/metrics");
    if (!response.ok) throw new Error(`metrics answered ${response.status}`);
    return certificateOf(await response.text(), peers.domain, now);
  } catch {
    return { domain: peers.domain, status: "unknown", expires: null, days_left: null };
  }
}

export async function stackHealth(
  peers: Peers,
  fetchImpl: typeof fetch = fetch,
  now = new Date()
): Promise<StackHealth> {
  const ask = async (url: string): Promise<Up> => (await probe(url, fetchImpl)).status;
  const [auth, ledger, ai, cert] = await Promise.all([
    ask(peers.auth),
    ask(peers.ledger),
    ask(peers.ai),
    certificateHealth(peers, fetchImpl, now),
  ]);
  const services = { auth, ledger, app: "up" as const, ai };
  const broken =
    REQUIRED.some((s) => services[s] === "down") ||
    cert?.status === "expired" ||
    cert?.status === "missing";
  const attention = ai === "down" || cert?.status === "expiring" || cert?.status === "unknown";
  return {
    status: broken ? "down" : attention ? "degraded" : "ok",
    services,
    ...(cert ? { certificate: cert } : {}),
  };
}
