/**
 * The system page's types (production readiness), shared by the server and the PWA: what admins
 * see about the deployment, and no one else.
 */

export const UPDATE_POLICIES = ["off", "notify", "auto"] as const;
export type UpdatePolicy = (typeof UPDATE_POLICIES)[number];

/** The gateway's certificate, when it serves HTTPS for a domain (see server/health.ts). */
export type CertificateHealth = {
  domain: string;
  status: "ok" | "expiring" | "expired" | "missing" | "unknown";
  /** When it expires (ISO), if there is one. */
  expires: string | null;
  days_left: number | null;
};

export type Release = {
  version: string;
  name: string | null;
  url: string;
  published_at: string | null;
};

export type UpdateState = {
  policy: UpdatePolicy;
  /** With `auto`: when the host's timer runs (`HH:MM`), as its `.env` says. */
  upgrade_at: string | null;
  latest: Release | null;
  /** Whether the latest is newer than what's running. */
  newer: boolean;
  checked_at: string | null;
  error: string | null;
};

export type ServiceFact = {
  name: string;
  status: "up" | "down";
  version: string | null;
  schema: number | null;
};

export type SystemInfo = {
  /** The release running (app's, which every service shares). */
  version: string;
  services: ServiceFact[];
  certificate?: CertificateHealth;
  data: { databases: { name: string; bytes: number }[]; attachments: number; total: number };
  backup: { made_at: string; version: string } | null;
  updates: UpdateState;
};
