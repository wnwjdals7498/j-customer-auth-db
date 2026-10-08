import { describe, it, expect } from "vitest";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { createLocalJWKSet, jwtVerify } from "jose";
import {
  PageCursor,
  GuestSigner,
  Passwords,
  digest,
  issueKey,
  validApiKey,
} from "../../apps/server/src/security.js";
import {
  normalizeGuest,
  validatePassword,
} from "../../apps/server/src/validation.js";
import { loadConfig, port } from "../../apps/server/src/config.js";
import { GUEST_TOKEN_POLICY } from "@j-customer-auth-db/contracts";
const rsa = () =>
  generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({
    type: "pkcs8",
    format: "pem",
  });
describe("customer-auth credentials and contracts", () => {
  it("bounds concurrent password hashing before allocating more Argon2 work", async () => {
    const passwords = new Passwords();
    const pending = Array.from({ length: 4 }, () =>
      passwords.create("initial-password-7498"),
    );
    await expect(
      passwords.create("initial-password-7498"),
    ).rejects.toMatchObject({ status: 429, code: "rate_limited" });
    expect(await Promise.all(pending)).toHaveLength(4);
    expect(await passwords.create("initial-password-7498")).toMatch(
      /^\$argon2id\$/,
    );
  });
  it("uses salted Argon2id 19MiB/2/1 and verifies both real and missing identities", async () => {
    const passwords = new Passwords();
    await passwords.prepare();
    const first = await passwords.create("initial-password-7498"),
      second = await passwords.create("initial-password-7498");
    expect(first).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(first).not.toBe(second);
    expect(await passwords.check("initial-password-7498", first)).toBe(true);
    expect(await passwords.check("another-password-7498", first)).toBe(false);
    expect(await passwords.check("initial-password-7498")).toBe(false);
  });
  it("binds opaque cursor to tenant and exact query and rejects tampering", () => {
    const cursor = new PageCursor(randomBytes(32).toString("base64url")),
      id = randomUUID(),
      value = cursor.encode("customer-a", "%_", id);
    expect(cursor.decode(value, "customer-a", "%_")).toBe(id);
    for (const args of [
      [value, "customer-b", "%_"],
      [value, "customer-a", ""],
      [value + "x", "customer-a", "%_"],
      ["", "customer-a", ""],
    ])
      expect(() => cursor.decode(args[0], args[1]!, args[2]!)).toThrow();
    expect(() => new PageCursor("a".repeat(42))).toThrow();
  });
  it("produces random 256-bit API keys and one-way hashes", () => {
    const values = Array.from({ length: 20 }, issueKey);
    expect(new Set(values).size).toBe(20);
    expect(values.every(validApiKey)).toBe(true);
    expect(validApiKey([values[0]])).toBe(false);
    expect(validApiKey(values[0] + "\n")).toBe(false);
    expect(digest(values[0]!)).toMatch(/^[a-f0-9]{64}$/);
  });
  it("publishes only RSA public material and rejects expired and wrong-signed JWTs", async () => {
    const signer = await GuestSigner.create(
        rsa(),
        "https://gw.customer-a.jgw.test",
      ),
      other = await GuestSigner.create(rsa(), "https://gw.customer-a.jgw.test");
    expect(signer.jwks.keys[0]).not.toHaveProperty("d");
    expect(signer.jwks.keys[0]).not.toHaveProperty("p");
    const resolver = createLocalJWKSet(signer.jwks);
    const token = await signer.sign("customer-a", randomUUID());
    const verified = await jwtVerify(token, resolver, {
      issuer: signer.issuer,
      audience: GUEST_TOKEN_POLICY.audience,
      algorithms: ["RS256"],
    });
    expect(verified.payload).toMatchObject({
      tenant: "customer-a",
      typ: "Guest",
    });
    expect(Number(verified.payload.exp) - Number(verified.payload.iat)).toBe(
      300,
    );
    await expect(
      jwtVerify(await signer.sign("customer-a", randomUUID(), 1), resolver),
    ).rejects.toThrow();
    await expect(
      jwtVerify(await other.sign("customer-a", randomUUID()), resolver),
    ).rejects.toThrow();
    const short = generateKeyPairSync("rsa", {
      modulusLength: 1024,
    }).privateKey.export({ type: "pkcs8", format: "pem" });
    await expect(
      GuestSigner.create(short, "https://gw.customer-a.jgw.test"),
    ).rejects.toThrow();
  });
  it("normalizes display fields while preserving permanent password bytes", () => {
    expect(
      normalizeGuest({
        name: " 손님 ",
        loginId: "guest.7498",
        contact: " 010 ",
        password: "  password-7498 ",
      }),
    ).toEqual({
      name: "손님",
      loginId: "guest.7498",
      contact: "010",
      password: "  password-7498 ",
    });
    for (const loginId of ["UPPER", "ab", "../guest", "guest space", "guest\n"])
      expect(() => normalizeGuest({ loginId })).toThrow();
    expect(() => normalizeGuest({ name: "\u0000" })).toThrow();
    expect(() => validatePassword("short")).toThrow();
    expect(() => validatePassword("x".repeat(129))).toThrow();
  });
  it("refuses reserved ports and foreign database/user/host configuration", () => {
    for (const value of ["3001", "0", "65536", "1e3", "050070"])
      expect(() => port(value)).toThrow();
    const env = {
      JCADB_TENANT: "customer-a",
      KC_PUBLIC_URL: "https://auth.jgw.test:58443",
      JCADB_PUBLIC_ORIGIN: "https://gw.customer-a.jgw.test",
      JCADB_CURSOR_SIGNING_KEY: randomBytes(32).toString("base64url"),
      JCADB_DB_PASSWORD: "fixture-only",
      JCADB_TLS_CERTIFICATE: "/workspace/.suite-runtime/customer/tls.crt",
      JCADB_TLS_KEY: "/workspace/.suite-runtime/customer/tls.key",
      JCADB_CA_CERTIFICATE: "/workspace/.suite-runtime/customer/ca.crt",
      JCADB_GUEST_SIGNING_KEY: "/workspace/.suite-runtime/customer/signing.key",
    };
    expect(loadConfig(env).database.user).toBe("jgw_customer_auth");
    for (const extra of [
      { JCADB_DB_USER: "postgres" },
      { JCADB_DB_NAME: "postgres" },
      { JCADB_DB_HOST: "db.example" },
      { JCADB_PORT: "3001" },
      { JCADB_PUBLIC_ORIGIN: "https://gw.customer-b.jgw.test" },
    ])
      expect(() => loadConfig({ ...env, ...extra })).toThrow();
  });
});
