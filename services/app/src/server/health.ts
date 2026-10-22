/**
 * The stack's health, for uptime monitors: `GET /api/health`, public through the gateway. `app`
 * asks each service's own `/health` (not routed outside) and answers with each one's up or down
 * only, nothing more: 200 when the stack works (`ok`, or `degraded` when only the optional ai
 * service is down), 503 when it doesn't (`down`).
 */

export type Up = "up" | "down";
export type StackHealth = {
  status: "ok" | "degraded" | "down";
  services: { auth: Up; ledger: Up; app: Up; ai: Up };
};

/** Where each service answers `/health`. */
export type Peers = { auth: string; ledger: string; ai: string };

/** What the stack needs: without these, nothing works. */
const REQUIRED = ["auth", "ledger", "app"] as const;

export async function stackHealth(
  peers: Peers,
  fetchImpl: typeof fetch = fetch
): Promise<StackHealth> {
  const ask = async (url: string): Promise<Up> => {
    try {
      const response = await fetchImpl(`${url.replace(/\/$/, "")}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return response.ok ? "up" : "down";
    } catch {
      return "down";
    }
  };
  const [auth, ledger, ai] = await Promise.all([ask(peers.auth), ask(peers.ledger), ask(peers.ai)]);
  const services = { auth, ledger, app: "up" as const, ai };
  const status = REQUIRED.some((s) => services[s] === "down")
    ? "down"
    : ai === "down"
      ? "degraded"
      : "ok";
  return { status, services };
}
