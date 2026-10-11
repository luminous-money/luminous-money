/** Session tokens: HS256 JWTs whose subject is the user's ID. */
import { jwtVerify, SignJWT } from "jose";

export const LIFETIME_SECONDS = 30 * 24 * 60 * 60;

export class Tokens {
  private readonly key: Uint8Array;

  constructor(secret: string) {
    if (secret.length < 32) throw new Error("AUTH_JWT_SECRET must be at least 32 characters");
    this.key = new TextEncoder().encode(secret);
  }

  issue(userId: string): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(`${LIFETIME_SECONDS}s`)
      .sign(this.key);
  }

  /** The user ID a valid token was issued to, or undefined for anything else. */
  async verify(token: string | undefined): Promise<string | undefined> {
    if (!token) return undefined;
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ["HS256"] });
      return payload.sub;
    } catch {
      return undefined;
    }
  }
}
