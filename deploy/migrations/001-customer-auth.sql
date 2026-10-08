CREATE TABLE guests (
  tenant_id text NOT NULL,
  id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  login_id text NOT NULL CHECK (login_id ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
  contact text NOT NULL DEFAULT '' CHECK (char_length(contact) <= 256),
  password_hash text NOT NULL CHECK (password_hash LIKE '$argon2id$v=19$m=19456,t=2,p=1$%'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, login_id)
);
CREATE TABLE api_keys (
  tenant_id text NOT NULL,
  id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  key_hash text NOT NULL CHECK (key_hash ~ '^[a-f0-9]{64}$'),
  scopes text[] NOT NULL CHECK (cardinality(scopes) BETWEEN 1 AND 2 AND scopes <@ ARRAY['guest:read','guest:write']::text[]),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (key_hash)
);
CREATE TABLE login_limits (
  tenant_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('ip','guest')),
  subject_hash text NOT NULL CHECK (subject_hash ~ '^[a-f0-9]{64}$'),
  window_start timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, kind, subject_hash)
);
CREATE INDEX login_limits_expiry ON login_limits(expires_at);
REVOKE ALL ON guests, api_keys, login_limits FROM PUBLIC;
