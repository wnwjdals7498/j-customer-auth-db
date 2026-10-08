import path from "node:path";
import { fileURLToPath } from "node:url";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import type { PoolConfig } from "pg";
import { assertCustomerTenantId } from "@j-auth/contracts";
const repository = fileURLToPath(new URL("../../../", import.meta.url));
function required(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name];
  if (!value || value.startsWith("__PLACEHOLDER_"))
    throw new Error("External customer-auth configuration required.");
  return value;
}
export function port(value: string): number {
  const parsed = Number(value);
  if (!/^[1-9][0-9]*$/.test(value) || parsed > 65535 || parsed === 3001)
    throw new Error("Invalid or reserved port.");
  return parsed;
}
function externalFile(value: string) {
  if (
    !path.isAbsolute(value) ||
    !path.relative(repository, value).startsWith(".." + path.sep)
  )
    throw new Error("External files required.");
  return value;
}
export async function readExternalFile(
  filename: string,
  secret = false,
): Promise<Buffer> {
  externalFile(filename);
  const uid = process.getuid?.();
  for (
    let parent = path.dirname(filename);
    parent !== "/";
    parent = path.dirname(parent)
  ) {
    const stat = await lstat(parent);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.mode & 0o022 ||
      (stat.uid !== uid && stat.uid !== 0)
    )
      throw new Error("Unsafe external file ancestry.");
  }
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.size === 0 ||
      stat.size > 65536 ||
      (stat.uid !== uid && stat.uid !== 0) ||
      (secret ? stat.mode & 0o077 : stat.mode & 0o022)
    )
      throw new Error("Unsafe external file.");
    const buffer = Buffer.alloc(65537);
    let size = 0;
    while (size <= 65536) {
      const result = await file.read(buffer, size, buffer.length - size, size);
      if (!result.bytesRead) return buffer.subarray(0, size);
      size += result.bytesRead;
    }
    throw new Error("External file too large.");
  } finally {
    await file.close();
  }
}
export function loadDatabaseConfig(
  env: NodeJS.ProcessEnv = process.env,
): PoolConfig {
  if (
    (env.JCADB_DB_NAME && env.JCADB_DB_NAME !== "jgw_customer_auth") ||
    (env.JCADB_DB_USER && env.JCADB_DB_USER !== "jgw_customer_auth") ||
    (env.JCADB_DB_HOST && env.JCADB_DB_HOST !== "127.0.0.1")
  )
    throw new Error("Dedicated local customer-auth database required.");
  return {
    host: "127.0.0.1",
    port: port(env.JCADB_DB_PORT ?? "55070"),
    database: "jgw_customer_auth",
    user: "jgw_customer_auth",
    password: required(env, "JCADB_DB_PASSWORD"),
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 5000,
    application_name: "j-customer-auth-db",
  };
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const tenant = required(env, "JCADB_TENANT");
  assertCustomerTenantId(tenant);
  const keycloak = new URL(required(env, "KC_PUBLIC_URL")),
    origin = new URL(required(env, "JCADB_PUBLIC_ORIGIN"));
  for (const url of [keycloak, origin]) {
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".jgw.test") ||
      url.port === "3001" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new Error("Registered HTTPS origins required.");
  }
  if (origin.hostname !== `gw.${tenant}.jgw.test`)
    throw new Error("Tenant public origin required.");
  const cursorKey = required(env, "JCADB_CURSOR_SIGNING_KEY");
  const serverPort = port(env.JCADB_PORT ?? "55071"),
    database = loadDatabaseConfig(env);
  if (serverPort === database.port) throw new Error("Distinct ports required.");
  return {
    tenant,
    keycloakOrigin: keycloak.origin,
    publicOrigin: origin.origin,
    cursorKey,
    port: serverPort,
    database,
    tlsCertificate: externalFile(required(env, "JCADB_TLS_CERTIFICATE")),
    tlsKey: externalFile(required(env, "JCADB_TLS_KEY")),
    caFile: externalFile(required(env, "JCADB_CA_CERTIFICATE")),
    signingKey: externalFile(required(env, "JCADB_GUEST_SIGNING_KEY")),
  };
}
