/**
 * Encrypting credentials at rest (SimpleFIN access URLs in `app`, AI providers' keys in `ai`):
 * AES-256-GCM with a fresh nonce per value. The stored form says which key encrypted it
 * (`v1:<key id>:<nonce>:<ciphertext+tag>`), so the key can be rotated later without guessing.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export class Sealer {
  private readonly key: Buffer;
  readonly keyId: string;

  /** `name` is the setting the key comes from, for saying which key a value needs. */
  constructor(
    base64Key: string,
    private readonly name = "the encryption key"
  ) {
    this.key = Buffer.from(base64Key, "base64");
    if (this.key.length !== 32) throw new Error("the key must be 32 bytes, base64");
    this.keyId = createHash("sha256").update(this.key).digest("hex").slice(0, 8);
  }

  seal(plain: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final(), cipher.getAuthTag()]);
    return `v1:${this.keyId}:${nonce.toString("base64")}:${body.toString("base64")}`;
  }

  open(sealed: string): string {
    const [version, keyId, nonce, body] = sealed.split(":");
    if (version !== "v1" || !nonce || !body) throw new Error("not a sealed value");
    if (keyId !== this.keyId) throw new Error(`this was sealed with a different ${this.name}`);
    const bytes = Buffer.from(body, "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(nonce, "base64"));
    decipher.setAuthTag(bytes.subarray(-16));
    return Buffer.concat([decipher.update(bytes.subarray(0, -16)), decipher.final()]).toString(
      "utf8"
    );
  }
}
