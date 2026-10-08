export const CUSTOMER_AUTH_PATHS = {
  guests: "/customer-auth/guests",
  apiKeys: "/customer-auth/api-keys",
  externalGuests: "/ext/customer-auth/v1/guests",
  login: "/ext/customer-auth/v1/login",
  jwks: "/ext/customer-auth/v1/jwks",
  openapi: "/ext/customer-auth/openapi.json",
} as const;
export const API_KEY_HEADER = "X-JCADB-API-Key";
export const API_KEY_PATTERN = "^jcadb_[A-Za-z0-9_-]{43}(?![\\s\\S])";
export const LOGIN_ID_PATTERN = "^[a-z0-9][a-z0-9._-]{2,63}(?![\\s\\S])";
export const GUEST_TOKEN_POLICY = {
  algorithm: "RS256",
  audience: "j-customer-auth-db-guest",
  issuerPath: "/ext/customer-auth",
  lifetimeSeconds: 300,
} as const;
export const LOGIN_LIMITS = {
  ip: { attempts: 60, seconds: 60 },
  guest: { attempts: 10, seconds: 300 },
  concurrentHashes: 4,
} as const;
export type ApiKeyScope = "guest:read" | "guest:write";
export interface Guest {
  id: string;
  name: string;
  loginId: string;
  contact: string;
  createdAt: string;
  updatedAt: string;
}
export interface GuestInput {
  name: string;
  loginId: string;
  contact?: string;
  password: string;
}
export type GuestUpdate = Partial<Pick<Guest, "name" | "loginId" | "contact">>;
export interface GuestPage {
  items: Guest[];
  next: string | null;
}
export interface ApiKey {
  id: string;
  name: string;
  scopes: ApiKeyScope[];
  createdAt: string;
  revokedAt: string | null;
}
export interface IssuedApiKey {
  apiKey: ApiKey;
  secret: string;
}
export interface ApiKeyInput {
  name: string;
  scopes: ApiKeyScope[];
}
export interface GuestLogin {
  loginId: string;
  password: string;
}
export interface GuestLoginResult {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: 300;
}
export interface GuestClaims {
  sub: string;
  tenant: string;
  typ: "Guest";
  iss: string;
  aud: "j-customer-auth-db-guest";
  iat: number;
  exp: number;
}
export interface ErrorResponse {
  error:
    | "invalid_request"
    | "unauthenticated"
    | "forbidden"
    | "not_found"
    | "conflict"
    | "invalid_credentials"
    | "rate_limited"
    | "unavailable";
  message: string;
}
const text = (maxLength: number) => ({
  type: "string",
  minLength: 1,
  maxLength,
});
const date = { type: "string", format: "date-time" };
const uuid = { type: "string", format: "uuid" };
export const SCHEMAS = {
  error: {
    type: "object",
    additionalProperties: false,
    required: ["error", "message"],
    properties: { error: { type: "string" }, message: { type: "string" } },
  },
  guest: {
    type: "object",
    additionalProperties: false,
    required: ["id", "name", "loginId", "contact", "createdAt", "updatedAt"],
    properties: {
      id: uuid,
      name: text(120),
      loginId: { type: "string", pattern: LOGIN_ID_PATTERN },
      contact: { type: "string", maxLength: 256 },
      createdAt: date,
      updatedAt: date,
    },
  },
  login: {
    type: "object",
    additionalProperties: false,
    required: ["loginId", "password"],
    properties: {
      loginId: { type: "string", pattern: LOGIN_ID_PATTERN },
      password: { type: "string", minLength: 12, maxLength: 128 },
    },
  },
  loginResult: {
    type: "object",
    additionalProperties: false,
    required: ["accessToken", "tokenType", "expiresIn"],
    properties: {
      accessToken: { type: "string" },
      tokenType: { type: "string", const: "Bearer" },
      expiresIn: { type: "integer", const: 300 },
    },
  },
  pageQuery: {
    type: "object",
    additionalProperties: false,
    properties: {
      q: { type: "string", maxLength: 120 },
      limit: { type: "string", pattern: "^(?:[1-9]|[1-9][0-9]|100)$" },
      cursor: { type: "string", maxLength: 1024 },
    },
  },
  id: {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: { id: uuid },
  },
} as const;
export const GUEST_PAGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items", "next"],
  properties: {
    items: { type: "array", items: SCHEMAS.guest },
    next: { type: ["string", "null"] },
  },
};
const guestInput = {
  type: "object",
  additionalProperties: false,
  required: ["name", "loginId", "password"],
  properties: {
    name: text(120),
    loginId: { type: "string", pattern: LOGIN_ID_PATTERN },
    contact: { type: "string", maxLength: 256 },
    password: SCHEMAS.login.properties.password,
  },
};
const apiKey = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "scopes", "createdAt", "revokedAt"],
  properties: {
    id: uuid,
    name: text(120),
    scopes: {
      type: "array",
      minItems: 1,
      maxItems: 2,
      uniqueItems: true,
      items: { type: "string", enum: ["guest:read", "guest:write"] },
    },
    createdAt: date,
    revokedAt: { type: ["string", "null"], format: "date-time" },
  },
};
export const MANAGEMENT_SCHEMAS = {
  guestInput,
  guestUpdate: {
    ...guestInput,
    required: [],
    minProperties: 1,
    properties: {
      name: guestInput.properties.name,
      loginId: guestInput.properties.loginId,
      contact: guestInput.properties.contact,
    },
  },
  apiKey,
  apiKeyInput: {
    type: "object",
    additionalProperties: false,
    required: ["name", "scopes"],
    properties: { name: text(120), scopes: apiKey.properties.scopes },
  },
  apiKeys: {
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: { items: { type: "array", items: apiKey } },
  },
  issuedApiKey: {
    type: "object",
    additionalProperties: false,
    required: ["apiKey", "secret"],
    properties: {
      apiKey,
      secret: { type: "string", pattern: API_KEY_PATTERN },
    },
  },
};
