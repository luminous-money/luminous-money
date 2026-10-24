/**
 * The system page (production readiness): for admins only (named by email in the server's
 * LUMINOUS_MONEY_ADMINS, and confirmed), and nobody else learns it exists beyond a 404. What's
 * running and whether it's healthy, the certificate, how much data there is, the last backup,
 * and whether a newer release is out. It changes nothing: upgrading and backing up happen on the
 * server (`luminous-money upgrade`, `luminous-money backup`), so the page says how.
 */
import { formatWhen } from "../lib/format.js";
import { explain, useCheckUpdates, useSystemInfo } from "../lib/queries.js";
import type { SystemInfo } from "../../shared/system.js";

/** Bytes for people: "1.4 MB". */
export function formatBytes(bytes: number): string {
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let unit = 0;
  while (n >= 1000 && unit < units.length - 1) {
    n /= 1000;
    unit++;
  }
  return unit === 0 ? `${n} bytes` : `${n.toFixed(n < 10 ? 1 : 0)} ${units[unit]}`;
}

export function System() {
  const info = useSystemInfo();
  return (
    <main className="stack">
      <header className="page-head">
        <h1>System</h1>
        <p className="muted">What's running here, for this server's admins alone.</p>
      </header>
      {info.isPending && <p className="muted">Loading…</p>}
      {info.error && <p className="card error">{explain(info.error)}</p>}
      {info.data && (
        <>
          <Release info={info.data} />
          <Services info={info.data} />
          {info.data.certificate && <Certificate info={info.data} />}
          <Data info={info.data} />
        </>
      )}
    </main>
  );
}

function Release({ info }: { info: SystemInfo }) {
  const check = useCheckUpdates();
  const { updates } = info;
  return (
    <section className="card system-card" aria-label="Release">
      <h2 className="section-title">Release</h2>
      <p>
        Running <strong>{info.version}</strong>.
      </p>
      {updates.policy === "off" ? (
        <p className="small muted">
          Update checks are off (<code>LUMINOUS_MONEY_UPDATES=off</code>).
        </p>
      ) : updates.latest && updates.newer ? (
        <>
          <p>
            <span className="pill stale">New</span>{" "}
            <a href={updates.latest.url} target="_blank" rel="noreferrer">
              {updates.latest.name ?? `Release ${updates.latest.version}`}
            </a>{" "}
            is out.
          </p>
          <p className="small muted">
            {updates.policy === "auto" && updates.upgrade_at
              ? `The server upgrades itself at ${updates.upgrade_at}. To do it now, on the server: `
              : "To upgrade, on the server (it backs up first): "}
            <code>./luminous-money upgrade</code>
          </p>
        </>
      ) : updates.latest ? (
        <p className="small muted">Up to date: {updates.latest.version} is the latest release.</p>
      ) : null}
      {updates.error && updates.policy !== "off" && (
        <p className="small muted">Couldn't check for releases: {updates.error}.</p>
      )}
      {updates.policy !== "off" && (
        <div className="row-between">
          <span className="small muted">
            {updates.checked_at ? `Checked ${formatWhen(updates.checked_at)}` : "Not checked yet"}
          </span>
          <button type="button" disabled={check.isPending} onClick={() => check.mutate()}>
            {check.isPending ? "Checking…" : "Check now"}
          </button>
        </div>
      )}
      {check.error && <p className="error small">{explain(check.error)}</p>}
    </section>
  );
}

function Services({ info }: { info: SystemInfo }) {
  return (
    <section className="card system-card" aria-label="Services">
      <h2 className="section-title">Services</h2>
      <ul className="system-list">
        {info.services.map((s) => (
          <li key={s.name}>
            <span>{s.name}</span>
            <span className={`pill ${s.status === "up" ? "confirmed" : "stale"}`}>{s.status}</span>
            <span className="small muted">
              {s.status === "up"
                ? [s.version && `version ${s.version}`, s.schema !== null && `schema ${s.schema}`]
                    .filter(Boolean)
                    .join(", ")
                : "not answering (on the server, luminous-money logs says why)"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Certificate({ info }: { info: SystemInfo }) {
  const c = info.certificate!;
  const words = {
    ok: "Valid",
    expiring: "Expiring: renewals are failing",
    expired: "Expired",
    missing: "None issued yet",
    unknown: "Unknown: the gateway didn't say",
  };
  return (
    <section className="card system-card" aria-label="Certificate">
      <h2 className="section-title">Certificate</h2>
      <p>
        {c.domain}:{" "}
        <span className={`pill ${c.status === "ok" ? "confirmed" : "stale"}`}>
          {words[c.status]}
        </span>
      </p>
      {c.expires && (
        <p className="small muted">
          Expires {formatWhen(c.expires)} ({c.days_left} days). Let's Encrypt renews it 30 days
          before.
        </p>
      )}
      {c.status !== "ok" && (
        <p className="small muted">
          On the server, <code>./luminous-money status</code> shows what Let's Encrypt said.
        </p>
      )}
    </section>
  );
}

function Data({ info }: { info: SystemInfo }) {
  const { data, backup } = info;
  return (
    <section className="card system-card" aria-label="Data">
      <h2 className="section-title">Data</h2>
      <p>
        {formatBytes(data.total)} in all:{" "}
        {data.databases.map((d) => `${d.name} ${formatBytes(d.bytes)}`).join(", ")}
        {data.attachments ? `, attachments ${formatBytes(data.attachments)}` : ""}.
      </p>
      <p className="small muted">
        {backup
          ? `Last backup ${formatWhen(backup.made_at)} (${backup.version}). `
          : "No backup made with luminous-money backup yet. "}
        On the server: <code>./luminous-money backup --keep 14</code>, nightly from cron or a timer
        (docs/deploying.md).
      </p>
    </section>
  );
}
