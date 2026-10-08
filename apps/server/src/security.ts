import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { exportJWK, SignJWT } from "jose";
import type { JWK } from "jose";
import {
  GUEST_TOKEN_POLICY,
  API_KEY_PATTERN,
  LOGIN_LIMITS,
} from "@j-customer-auth-db/contracts";
import { invalid, limited } from "./errors.js";
export const PASSWORD_POLICY = {
  algorithm: 2,
  version: 1,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const issueKey = () => "jcadb_" + randomBytes(32).toString("base64url");
export const validApiKey = (value: unknown): value is string =>
  typeof value === "string" && new RegExp(API_KEY_PATTERN).test(value);
export class Passwords {
  private active = 0;
  private dummy = "";
  async prepare() {
    this.dummy = await this.create(randomBytes(32).toString("base64url"));
  }
  private async bounded<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= LOGIN_LIMITS.concurrentHashes) throw limited();
    this.active++;
    try {
      return await work();
    } finally {
      this.active--;
    }
  }
  create(password: string) {
    return this.bounded(() => hash(password, PASSWORD_POLICY));
  }
  async check(password: string, encoded?: string) {
    if (!this.dummy) throw new Error("Password verifier not initialized.");
    const match = await this.bounded(() =>
      verify(encoded ?? this.dummy, password),
    );
    return encoded !== undefined && match;
  }
}
export class PageCursor {
  constructor(private readonly key: string) {
    if (
      !/^[A-Za-z0-9_-]{43}$/.test(key) ||
      Buffer.from(key, "base64url").toString("base64url") !== key
    )
      throw new Error("Invalid cursor signing key.");
  }
  private signature(data: string) {
    return createHmac("sha256", Buffer.from(this.key, "base64url"))
      .update(data)
      .digest();
  }
  encode(tenant: string, query: string, id: string) {
    const data = Buffer.from(
      JSON.stringify({ v: 1, t: tenant, q: digest(query), id }),
    ).toString("base64url");
    return data + "." + this.signature(data).toString("base64url");
  }
  decode(
    cursor: string | undefined,
    tenant: string,
    query: string,
  ): string | null {
    if (cursor === undefined) return null;
    try {
      if (
        cursor.length > 1024 ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(cursor)
      )
        throw invalid();
      const [data, sig] = cursor.split(".");
      const signature = Buffer.from(sig!, "base64url");
      if (
        signature.length !== 32 ||
        signature.toString("base64url") !== sig ||
        !timingSafeEqual(signature, this.signature(data!))
      )
        throw invalid();
      const decoded = Buffer.from(data!, "base64url");
      if (decoded.toString("base64url") !== data) throw invalid();
      const value = JSON.parse(decoded.toString("utf8")) as Record<
        string,
        unknown
      >;
      if (
        Object.keys(value).sort().join(",") !== "id,q,t,v" ||
        value.v !== 1 ||
        value.t !== tenant ||
        value.q !== digest(query) ||
        typeof value.id !== "string" ||
        !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value.id)
      )
        throw invalid();
      return value.id;
    } catch {
      throw invalid();
    }
  }
}
export class GuestSigner {
  readonly jwks: { keys: JWK[] };
  readonly issuer: string;
  private constructor(
    private readonly key: ReturnType<typeof createPrivateKey>,
    publicKey: JWK,
    publicOrigin: string,
    readonly kid: string,
  ) {
    this.jwks = {
      keys: [
        { ...publicKey, kid, use: "sig", alg: GUEST_TOKEN_POLICY.algorithm },
      ],
    };
    this.issuer = publicOrigin + GUEST_TOKEN_POLICY.issuerPath;
  }
  static async create(pem: string | Buffer, publicOrigin: string) {
    if (!/^-----BEGIN PRIVATE KEY-----/.test(pem.toString()))
      throw new Error("PKCS8 signing key required.");
    const key = createPrivateKey(pem);
    if (
      key.asymmetricKeyType !== "rsa" ||
      (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
    )
      throw new Error("RSA signing key too small.");
    const publicKey = createPublicKey(key);
    const kid = createHash("sha256")
      .update(publicKey.export({ type: "spki", format: "der" }))
      .digest("base64url");
    return new GuestSigner(key, await exportJWK(publicKey), publicOrigin, kid);
  }
  async sign(tenant: string, id: string, now = Math.floor(Date.now() / 1000)) {
    return new SignJWT({ tenant, typ: "Guest" })
      .setProtectedHeader({
        alg: GUEST_TOKEN_POLICY.algorithm,
        kid: this.kid,
        typ: "JWT",
      })
      .setIssuer(this.issuer)
      .setAudience(GUEST_TOKEN_POLICY.audience)
      .setSubject(id)
      .setIssuedAt(now)
      .setExpirationTime(now + GUEST_TOKEN_POLICY.lifetimeSeconds)
      .sign(this.key);
  }
}
