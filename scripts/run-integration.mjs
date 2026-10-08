import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
if (process.env.JGW_TEST_RUNTIME !== "isolated-cloud")
  throw new Error(
    "Actual isolated j-auth/Keycloak/PG integration environment required; no skip.",
  );
const cwd = fileURLToPath(new URL("../../j-groupware/", import.meta.url));
const child = spawn(
  process.execPath,
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "--config",
    "vitest.integration.config.ts",
    "tests/bff/customer-auth.integration.test.ts",
  ],
  { cwd, shell: false, stdio: "inherit", env: process.env },
);
child.once("error", () => {
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    child.kill(signal);
  });
