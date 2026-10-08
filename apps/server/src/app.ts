import Fastify, { LogController } from "fastify";
import type { FastifyHttpOptions, FastifyRequest } from "fastify";
import swagger from "@fastify/swagger";
import type { Server } from "node:http";
import type { ServerOptions } from "node:https";
import type { Pool } from "pg";
import type { TokenVerifier } from "@j-auth/token-verifier";
import {
  CUSTOMER_AUTH_PATHS as paths,
  API_KEY_HEADER,
  SCHEMAS,
  GUEST_PAGE_SCHEMA,
  LOGIN_ID_PATTERN,
} from "@j-customer-auth-db/contracts";
import type {
  GuestInput,
  GuestUpdate,
  GuestLogin,
  ApiKeyScope,
} from "@j-customer-auth-db/contracts";
import { memberGate } from "./auth.js";
import {
  ApiError,
  invalid,
  limited,
  unavailable,
  unauthenticated,
  wrongCredentials,
} from "./errors.js";
import type { GuestSigner } from "./security.js";
import { PageCursor, Passwords, validApiKey } from "./security.js";
import { CustomerStore } from "./store.js";
import { cleanText, normalizeGuest, validatePassword } from "./validation.js";

const errors = Object.fromEntries(
  [400, 401, 403, 404, 409, 429, 503].map((status) => [status, SCHEMAS.error]),
);
const hidden = { hide: true };
const external = { security: [{ apiKey: [] }] };
const guestInput = {
  type: "object",
  additionalProperties: false,
  required: ["name", "loginId", "password"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
    loginId: { type: "string", pattern: LOGIN_ID_PATTERN },
    contact: { type: "string", maxLength: 256 },
    password: SCHEMAS.login.properties.password,
  },
};
const guestUpdate = {
  ...guestInput,
  required: [],
  minProperties: 1,
  properties: {
    name: guestInput.properties.name,
    loginId: guestInput.properties.loginId,
    contact: guestInput.properties.contact,
  },
};
const keySchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "scopes", "createdAt", "revokedAt"],
  properties: {
    id: { type: "string", format: "uuid" },
    name: { type: "string" },
    scopes: {
      type: "array",
      items: { type: "string", enum: ["guest:read", "guest:write"] },
    },
    createdAt: { type: "string", format: "date-time" },
    revokedAt: { type: ["string", "null"], format: "date-time" },
  },
};
const issuedKeySchema = {
  type: "object",
  additionalProperties: false,
  required: ["apiKey", "secret"],
  properties: { apiKey: keySchema, secret: { type: "string" } },
};
export async function createApp(options: {
  pool: Pool;
  tenant: string;
  keycloakOrigin: string;
  cursorKey: string;
  signer: GuestSigner;
  fetch?: typeof globalThis.fetch;
  verifier?: TokenVerifier;
  https?: ServerOptions;
  logger?: FastifyHttpOptions<Server>["logger"];
}) {
  const app = Fastify({
    logger: options.logger ?? false,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 16384,
    trustProxy: false,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
    ...(options.https ? { https: options.https } : {}),
  });
  const store = new CustomerStore(
      options.pool,
      options.tenant,
      new PageCursor(options.cursorKey),
    ),
    passwords = new Passwords();
  await passwords.prepare();
  const member = memberGate({
    tenant: options.tenant,
    keycloakOrigin: options.keycloakOrigin,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.verifier ? { verifier: options.verifier } : {}),
  });
  await app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "Customer-auth server API",
        version: "0.1.0",
        description:
          "For customer site servers. Keep API keys on the server; guest JWTs do not authenticate these API routes.",
      },
      components: {
        securitySchemes: {
          apiKey: { type: "apiKey", in: "header", name: API_KEY_HEADER },
        },
      },
    },
  });
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
  });
  app.setErrorHandler((error, _request, reply) => {
    const api =
      error instanceof ApiError
        ? error
        : (error as { validation?: unknown }).validation ||
            (error as { statusCode?: number }).statusCode === 400 ||
            (error as { statusCode?: number }).statusCode === 413
          ? invalid()
          : unavailable();
    if (api.status === 429) reply.header("Retry-After", "300");
    void reply.code(api.status).send({ error: api.code, message: api.message });
  });
  app.setNotFoundHandler((_request, reply) => {
    void reply
      .code(404)
      .send({ error: "not_found", message: "Resource not found." });
  });
  const key = (request: FastifyRequest) => {
    const value = request.headers[API_KEY_HEADER.toLowerCase()];
    if (
      !validApiKey(value) ||
      request.headers.cookie !== undefined ||
      request.headers.authorization !== undefined
    )
      throw unauthenticated();
    return value;
  };
  type PageQuery = { q?: string; limit?: string; cursor?: string };
  app.get<{ Querystring: PageQuery }>(
    paths.guests,
    {
      schema: {
        ...hidden,
        querystring: SCHEMAS.pageQuery,
        response: { 200: GUEST_PAGE_SCHEMA, ...errors },
      },
      preHandler: async (request) => {
        await member(request, "guest:read");
      },
    },
    async (request) => store.guests(request.query),
  );
  app.get<{ Params: { id: string } }>(
    paths.guests + "/:id",
    {
      schema: {
        ...hidden,
        params: SCHEMAS.id,
        response: { 200: SCHEMAS.guest, ...errors },
      },
      preHandler: async (request) => {
        await member(request, "guest:read");
      },
    },
    async (request) => store.guest(request.params.id),
  );
  app.post<{ Body: GuestInput }>(
    paths.guests,
    {
      schema: {
        ...hidden,
        body: guestInput,
        response: { 201: SCHEMAS.guest, ...errors },
      },
      preHandler: async (request) => {
        await member(request, "guest:write");
      },
    },
    async (request, reply) => {
      const input = normalizeGuest(request.body);
      return reply
        .code(201)
        .send(
          await store.createGuest(
            input,
            await passwords.create(input.password),
          ),
        );
    },
  );
  app.patch<{ Params: { id: string }; Body: GuestUpdate }>(
    paths.guests + "/:id",
    {
      schema: {
        ...hidden,
        params: SCHEMAS.id,
        body: guestUpdate,
        response: { 200: SCHEMAS.guest, ...errors },
      },
      preHandler: async (request) => {
        await member(request, "guest:write");
      },
    },
    async (request) =>
      store.updateGuest(request.params.id, normalizeGuest(request.body)),
  );
  app.delete<{ Params: { id: string } }>(
    paths.guests + "/:id",
    {
      schema: { ...hidden, params: SCHEMAS.id, response: errors },
      preHandler: async (request) => {
        await member(request, "guest:write");
      },
    },
    async (request, reply) => {
      await store.deleteGuest(request.params.id);
      return reply.code(204).send();
    },
  );
  app.post<{ Body: { name: string; scopes: ApiKeyScope[] } }>(
    paths.apiKeys,
    {
      schema: {
        ...hidden,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["name", "scopes"],
          properties: {
            name: guestInput.properties.name,
            scopes: {
              type: "array",
              minItems: 1,
              maxItems: 2,
              uniqueItems: true,
              items: keySchema.properties.scopes.items,
            },
          },
        },
        response: { 201: issuedKeySchema, ...errors },
      },
      preHandler: async (request) => {
        await member(request, "guest:write");
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await store.issueApiKey(
            cleanText(request.body.name, 120),
            request.body.scopes,
          ),
        ),
  );
  app.get(
    paths.apiKeys,
    {
      schema: {
        ...hidden,
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["items"],
            properties: { items: { type: "array", items: keySchema } },
          },
          ...errors,
        },
      },
      preHandler: async (request) => {
        await member(request, "guest:write");
      },
    },
    async () => store.apiKeys(),
  );
  app.delete<{ Params: { id: string } }>(
    paths.apiKeys + "/:id",
    {
      schema: {
        ...hidden,
        params: SCHEMAS.id,
        response: { 200: keySchema, ...errors },
      },
      preHandler: async (request) => {
        await member(request, "guest:write");
      },
    },
    async (request) => store.revokeApiKey(request.params.id),
  );
  app.get<{ Querystring: PageQuery }>(
    paths.externalGuests,
    {
      schema: {
        ...external,
        querystring: SCHEMAS.pageQuery,
        response: { 200: GUEST_PAGE_SCHEMA, ...errors },
      },
    },
    async (request) =>
      store.withApiKey(key(request), (db) => store.guests(request.query, db)),
  );
  app.post<{ Body: GuestLogin }>(
    paths.login,
    {
      schema: {
        ...external,
        body: SCHEMAS.login,
        response: { 200: SCHEMAS.loginResult, ...errors },
      },
    },
    async (request) => {
      validatePassword(request.body.password);
      const outcome = await store.withApiKey(key(request), async (db) => {
        if (
          !(await store.consumeLoginLimits(
            db,
            request.ip,
            request.body.loginId,
          ))
        )
          return limited();
        const guest = await store.loginHash(db, request.body.loginId);
        try {
          if (
            !(await passwords.check(
              request.body.password,
              guest?.password_hash,
            ))
          )
            return wrongCredentials();
        } catch (error) {
          if (error instanceof ApiError && error.status === 429) return error;
          throw error;
        }
        return {
          accessToken: await options.signer.sign(options.tenant, guest!.id),
          tokenType: "Bearer",
          expiresIn: 300,
        };
      });
      if (outcome instanceof ApiError) throw outcome;
      return outcome;
    },
  );
  const jwkSchema = {
    type: "object",
    additionalProperties: false,
    required: ["kty", "n", "e", "kid", "use", "alg"],
    properties: Object.fromEntries(
      ["kty", "n", "e", "kid", "use", "alg"].map((field) => [
        field,
        { type: "string" },
      ]),
    ),
  };
  app.get(
    paths.jwks,
    {
      schema: {
        security: [],
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["keys"],
            properties: { keys: { type: "array", items: jwkSchema } },
          },
        },
      },
    },
    async (_request, reply) => {
      reply.header("Cache-Control", "public, max-age=300");
      return options.signer.jwks;
    },
  );
  app.get(paths.openapi, { schema: hidden }, async () => app.swagger());
  app.get("/health/ready", { schema: hidden }, async () => {
    await options.pool.query("SELECT 1");
    return { ready: true };
  });
  return app;
}
