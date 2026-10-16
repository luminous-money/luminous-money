/**
 * Which URLs `app` will fetch for SimpleFIN. A setup token is just a URL the user pastes, and
 * this may be a public server, so: `https` only, to a host on the allowlist (`SIMPLEFIN_HOSTS`),
 * and never one that resolves to a private or local address. Test stacks relax the scheme and
 * the address check for the fake server (`SIMPLEFIN_ALLOW_INSECURE`), not the allowlist.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type UrlPolicy = { hosts: readonly string[]; allowInsecure: boolean };

export class UrlRefused extends Error {}

/** Whether an IP address is private, loopback, link-local or otherwise not on the internet. */
export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number) as [number, number];
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  const v6 = address.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return (
    v6 === "::1" || v6 === "::" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith("ff")
  );
}

/** Check `url` against the policy (resolving its host); throws UrlRefused with why. */
export async function checkUrl(
  url: string,
  policy: UrlPolicy,
  resolve: (host: string) => Promise<string[]> = async (host) =>
    (await lookup(host, { all: true })).map((a) => a.address)
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UrlRefused("that isn't a SimpleFIN URL");
  }
  if (parsed.protocol !== "https:" && !(policy.allowInsecure && parsed.protocol === "http:"))
    throw new UrlRefused("SimpleFIN URLs must be https");
  const host = parsed.hostname.toLowerCase();
  if (!policy.hosts.some((h) => h.toLowerCase() === host))
    throw new UrlRefused(`${host} isn't a SimpleFIN server this app is set up to use`);
  if (!policy.allowInsecure) {
    const addresses = isIP(host) ? [host] : await resolve(host).catch(() => []);
    if (!addresses.length) throw new UrlRefused(`couldn't find ${host}`);
    if (addresses.some(isPrivateAddress))
      throw new UrlRefused(`${host} points to a private address`);
  }
  return parsed;
}
