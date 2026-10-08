import { Pool } from "pg";
import { Agent, fetch as trustedFetch } from "undici";
import { loadConfig, readExternalFile } from "./config.js";
import { migrate } from "./db/migrate.js";
import { GuestSigner } from "./security.js";
import { createApp } from "./app.js";
async function main() {
  const config = loadConfig();
  const [cert, key, ca, signingKey] = await Promise.all([
    readExternalFile(config.tlsCertificate),
    readExternalFile(config.tlsKey, true),
    readExternalFile(config.caFile),
    readExternalFile(config.signingKey, true),
  ]);
  const signer = await GuestSigner.create(signingKey, config.publicOrigin),
    agent = new Agent({ connect: { ca } });
  const pool = new Pool(config.database);
  pool.on("error", () => {});
  let close: () => Promise<void> = async () => {
    await pool.end();
    await agent.close();
  };
  try {
    await migrate(pool);
    const fetch: typeof globalThis.fetch = async (input, init) =>
      (await trustedFetch(String(input), {
        ...init,
        dispatcher: agent,
      } as Parameters<typeof trustedFetch>[1])) as unknown as Response;
    const app = await createApp({
      pool,
      tenant: config.tenant,
      keycloakOrigin: config.keycloakOrigin,
      cursorKey: config.cursorKey,
      signer,
      fetch,
      https: { cert, key, minVersion: "TLSv1.2" },
      logger: {
        level: "info",
        serializers: {
          req: () => ({}),
          res: () => ({}),
          err: () => ({ type: "Error", message: "Request failed.", stack: "" }),
        },
      },
    });
    app.addHook("onClose", async () => {
      await pool.end();
      await agent.close();
    });
    close = () => app.close();
    let closing = false;
    for (const signal of ["SIGINT", "SIGTERM"])
      process.once(signal, () => {
        if (!closing) {
          closing = true;
          void close().catch(() => {
            process.exitCode = 1;
          });
        }
      });
    await app.listen({ host: "127.0.0.1", port: config.port });
  } catch {
    await close().catch(() => undefined);
    throw new Error("Customer-auth startup failed.");
  }
}
main().catch(() => {
  process.stderr.write(
    "Customer-auth startup failed. Sensitive configuration was not logged.\n",
  );
  process.exitCode = 1;
});
