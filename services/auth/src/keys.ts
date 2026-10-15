/**
 * Access tokens: JWTs signed with Ed25519 (EdDSA), valid for ten minutes, carrying the user
 * (`sub`) and the session (`sid`). `auth` makes its key pair on first start and keeps it in its
 * database, and publishes the public keys (`jwks`), so any service could check tokens itself.
 * Rotating adds a key and retires the old one, which keeps verifying until its tokens expire.
 */
import { after, now, type DatabaseSync } from "@fava-beans/db";
import { exportJWK, generateKeyPair, importJWK, jwtVerify, SignJWT, type JWK } from "jose";

import { later } from "./secrets.js";

export const ACCESS_TTL_SECONDS = 10 * 60;
export const ISSUER = "fava-beans";
export const AUDIENCE = "fava-beans";
const ALG = "EdDSA";

type KeyRow = { kid: string; private_jwk: string; public_jwk: string; retired_at: string | null };
type Key = Parameters<SignJWT["sign"]>[0];

export type AccessClaims = { sub: string; sid: string };

export class SigningKeys {
  private readonly imported = new Map<string, Promise<Key>>();

  constructor(private readonly db: DatabaseSync) {}

  /** Make the first key, if there's none. */
  async ensure(): Promise<void> {
    if (!this.signing()) await this.add();
  }

  /** Add a key and retire the others; drop keys retired long enough ago that nothing they
   * signed is still valid. */
  async rotate(): Promise<string> {
    const stamp = now();
    this.db
      .prepare("UPDATE signing_key SET retired_at = ?, updated_at = ? WHERE retired_at IS NULL")
      .run(stamp, stamp);
    this.db
      .prepare("DELETE FROM signing_key WHERE retired_at < ?")
      .run(later(-2 * ACCESS_TTL_SECONDS * 1000));
    return this.add();
  }

  private async add(): Promise<string> {
    const { privateKey, publicKey } = await generateKeyPair(ALG, {
      crv: "Ed25519",
      extractable: true,
    });
    const kid = crypto.randomUUID();
    const stamp = after(null);
    this.db
      .prepare(
        "INSERT INTO signing_key (kid, private_jwk, public_jwk, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        kid,
        JSON.stringify(await exportJWK(privateKey)),
        JSON.stringify(await exportJWK(publicKey)),
        stamp,
        stamp
      );
    return kid;
  }

  private signing(): KeyRow | undefined {
    return this.db
      .prepare(
        "SELECT * FROM signing_key WHERE retired_at IS NULL ORDER BY created_at DESC LIMIT 1"
      )
      .get() as KeyRow | undefined;
  }

  private key(kid: string, which: "private_jwk" | "public_jwk"): Promise<Key> | undefined {
    const cacheKey = `${kid}:${which}`;
    let key = this.imported.get(cacheKey);
    if (!key) {
      const row = this.db.prepare("SELECT * FROM signing_key WHERE kid = ?").get(kid) as
        KeyRow | undefined;
      if (!row) return undefined;
      key = importJWK(JSON.parse(row[which]) as JWK, ALG) as Promise<Key>;
      this.imported.set(cacheKey, key);
    }
    return key;
  }

  /** The public keys, as a JWK Set. */
  jwks(): { keys: JWK[] } {
    const rows = this.db.prepare("SELECT kid, public_jwk FROM signing_key").all() as KeyRow[];
    return {
      keys: rows.map((r) => ({
        ...(JSON.parse(r.public_jwk) as JWK),
        kid: r.kid,
        alg: ALG,
        use: "sig",
      })),
    };
  }

  async sign({ sub, sid }: AccessClaims): Promise<string> {
    const row = this.signing();
    if (!row) throw new Error("no signing key: call ensure() first");
    return new SignJWT({ sid })
      .setProtectedHeader({ alg: ALG, kid: row.kid, typ: "at+jwt" })
      .setSubject(sub)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
      .sign(await this.key(row.kid, "private_jwk")!);
  }

  /** The claims of a valid access token; undefined for anything else (expired, forged, ...). */
  async verify(
    token: string | undefined,
    { ignoreExpiry = false } = {}
  ): Promise<AccessClaims | undefined> {
    if (!token) return undefined;
    try {
      const { payload } = await jwtVerify(
        token,
        async (header) => {
          const key = header.kid ? this.key(header.kid, "public_jwk") : undefined;
          if (!key) throw new Error("unknown key");
          return key;
        },
        {
          algorithms: [ALG],
          issuer: ISSUER,
          audience: AUDIENCE,
          typ: "at+jwt",
          ...(ignoreExpiry ? { currentDate: new Date(0) } : {}),
        }
      );
      return typeof payload.sub === "string" && typeof payload.sid === "string"
        ? { sub: payload.sub, sid: payload.sid }
        : undefined;
    } catch {
      return undefined;
    }
  }
}
