/**
 * Passwords, after NIST SP 800-63B rev. 4 and OWASP: at least 15 characters (the minimum for a
 * password that's the only factor), at most 128, no composition rules, normalized (NFKC), and
 * not known from breaches. Hashed with Argon2id (OWASP's parameters), stored as a PHC string so
 * the parameters can be raised later; `needsRehash` says when a stored hash is behind.
 */
import { argon2 as argon2Callback, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

export const MIN_LENGTH = 15;
export const MAX_LENGTH = 128;

const argon2 = promisify(argon2Callback);
const PARAMS = { memory: 19456, passes: 2, parallelism: 1 };
const TAG_LENGTH = 32;
const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

/** Whether a password appears in known breaches. */
export type BreachCheck = (password: string) => Promise<boolean>;

const normalize = (password: string) => password.normalize("NFKC");

async function derive(
  password: string,
  nonce: Buffer,
  params: typeof PARAMS,
  tagLength = TAG_LENGTH
): Promise<Buffer> {
  return argon2("argon2id", {
    message: normalize(password),
    nonce,
    tagLength,
    ...params,
  }) as Promise<Buffer>;
}

const b64 = (bytes: Buffer) => bytes.toString("base64").replace(/=+$/, "");

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, PARAMS);
  const { memory: m, passes: t, parallelism: p } = PARAMS;
  return `$argon2id$v=19$m=${m},t=${t},p=${p}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const match = PHC.exec(stored);
  if (!match) return false;
  const [, m, t, p, salt, hash] = match;
  const expected = Buffer.from(hash!, "base64");
  const actual = await derive(
    password,
    Buffer.from(salt!, "base64"),
    { memory: Number(m), passes: Number(t), parallelism: Number(p) },
    expected.length
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Whether `stored` was made with weaker parameters than today's. */
export function needsRehash(stored: string): boolean {
  const match = PHC.exec(stored);
  if (!match) return true;
  return (
    Number(match[1]) < PARAMS.memory ||
    Number(match[2]) < PARAMS.passes ||
    Number(match[3]) !== PARAMS.parallelism
  );
}

/** What's wrong with `password` as a new password for `email`, if anything. */
export async function passwordProblem(
  password: unknown,
  email: string,
  breached: BreachCheck | null
): Promise<string | undefined> {
  if (typeof password !== "string") return "choose a password";
  const length = [...normalize(password)].length;
  if (length < MIN_LENGTH) return `use at least ${MIN_LENGTH} characters`;
  if (length > MAX_LENGTH) return `use at most ${MAX_LENGTH} characters`;
  const lower = normalize(password).toLowerCase();
  if (lower === email.toLowerCase() || lower === "fava-beans" || lower === "favabeans")
    return "choose a password that isn't your email or this app's name";
  if (breached && (await breached(password)))
    return "that password has appeared in a data breach; choose another";
  return undefined;
}

/**
 * Have I Been Pwned's range API (k-anonymity): only the first five characters of the password's
 * SHA-1 are sent, padded responses hide which range was asked for. If HIBP can't be reached, the
 * check passes: an outage shouldn't stop anyone signing up.
 */
export function pwnedPasswords(
  fetcher: typeof fetch = fetch,
  base = "https://api.pwnedpasswords.com"
): BreachCheck {
  return async (password) => {
    const sha1 = createHash("sha1").update(normalize(password)).digest("hex").toUpperCase();
    try {
      const response = await fetcher(`${base}/range/${sha1.slice(0, 5)}`, {
        headers: { "add-padding": "true" },
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) return false;
      const suffix = sha1.slice(5);
      return (await response.text())
        .split("\n")
        .some((line) => line.startsWith(`${suffix}:`) && Number(line.split(":")[1]) > 0);
    } catch {
      return false;
    }
  };
}
