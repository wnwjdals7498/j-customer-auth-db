import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  Guest,
  GuestInput,
  GuestUpdate,
  GuestPage,
  ApiKey,
  ApiKeyScope,
} from "@j-customer-auth-db/contracts";
import { LOGIN_LIMITS } from "@j-customer-auth-db/contracts";
import { ApiError, invalid, missing, unauthenticated } from "./errors.js";
import { cleanText } from "./validation.js";
import type { PageCursor } from "./security.js";
import { digest, issueKey } from "./security.js";

interface GuestRow {
  id: string;
  name: string;
  login_id: string;
  contact: string;
  created_at: Date;
  updated_at: Date;
}
interface KeyRow {
  id: string;
  name: string;
  scopes: ApiKeyScope[];
  created_at: Date;
  revoked_at: Date | null;
}
const guestColumns = "id, name, login_id, contact, created_at, updated_at";
const keyColumns = "id, name, scopes, created_at, revoked_at";
const guestDto = (row: GuestRow): Guest => ({
  id: row.id,
  name: row.name,
  loginId: row.login_id,
  contact: row.contact,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});
const keyDto = (row: KeyRow): ApiKey => ({
  id: row.id,
  name: row.name,
  scopes: row.scopes,
  createdAt: row.created_at.toISOString(),
  revokedAt: row.revoked_at?.toISOString() ?? null,
});
export class CustomerStore {
  constructor(
    readonly pool: Pool,
    readonly tenant: string,
    private readonly cursor: PageCursor,
  ) {}
  async transaction<T>(work: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '5s'");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  async guests(
    query: { q?: string; limit?: string; cursor?: string },
    db: Pool | PoolClient = this.pool,
  ): Promise<GuestPage> {
    const q = cleanText(query.q ?? "", 120, true),
      limit = Number(query.limit ?? 50);
    const after = this.cursor.decode(query.cursor, this.tenant, q);
    const pattern = "%" + q.replace(/[\\%_]/g, "\\$&") + "%";
    const result = await db.query<GuestRow>(
      `SELECT ${guestColumns} FROM guests WHERE tenant_id=$1 AND ($2::uuid IS NULL OR id > $2) AND (name ILIKE $3 OR login_id ILIKE $3 OR contact ILIKE $3) ORDER BY id LIMIT $4`,
      [this.tenant, after, pattern, limit + 1],
    );
    const rows = result.rows.slice(0, limit);
    return {
      items: rows.map(guestDto),
      next:
        result.rows.length > limit
          ? this.cursor.encode(this.tenant, q, rows.at(-1)!.id)
          : null,
    };
  }
  async guest(id: string): Promise<Guest> {
    const result = await this.pool.query<GuestRow>(
      `SELECT ${guestColumns} FROM guests WHERE tenant_id=$1 AND id=$2`,
      [this.tenant, id],
    );
    if (!result.rows[0]) throw missing();
    return guestDto(result.rows[0]);
  }
  async createGuest(input: GuestInput, passwordHash: string): Promise<Guest> {
    try {
      const result = await this.pool.query<GuestRow>(
        `INSERT INTO guests(tenant_id,id,name,login_id,contact,password_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING ${guestColumns}`,
        [
          this.tenant,
          randomUUID(),
          input.name,
          input.loginId,
          input.contact ?? "",
          passwordHash,
        ],
      );
      return guestDto(result.rows[0]!);
    } catch (error) {
      if (
        (error as { code?: string; constraint?: string }).code === "23505" &&
        (error as { constraint?: string }).constraint ===
          "guests_tenant_id_login_id_key"
      )
        throw new ApiError(409, "conflict", "Login ID already exists.");
      throw error;
    }
  }
  async updateGuest(id: string, input: GuestUpdate) {
    const assignments: string[] = [],
      values: string[] = [this.tenant, id];
    for (const [key, column] of [
      ["name", "name"],
      ["loginId", "login_id"],
      ["contact", "contact"],
    ] as const) {
      if (input[key] !== undefined) {
        values.push(input[key]);
        assignments.push(`${column}=$${values.length}`);
      }
    }
    if (!assignments.length) throw invalid();
    try {
      const result = await this.pool.query<GuestRow>(
        `UPDATE guests SET ${assignments.join(",")},updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING ${guestColumns}`,
        values,
      );
      if (!result.rows[0]) throw missing();
      return guestDto(result.rows[0]);
    } catch (error) {
      if (
        (error as { code?: string; constraint?: string }).code === "23505" &&
        (error as { constraint?: string }).constraint ===
          "guests_tenant_id_login_id_key"
      )
        throw new ApiError(409, "conflict", "Login ID already exists.");
      throw error;
    }
  }
  async deleteGuest(id: string) {
    const result = await this.pool.query(
      "DELETE FROM guests WHERE tenant_id=$1 AND id=$2",
      [this.tenant, id],
    );
    if (!result.rowCount) throw missing();
  }
  async issueApiKey(name: string, scopes: ApiKeyScope[]) {
    const secret = issueKey();
    const result = await this.pool.query<KeyRow>(
      `INSERT INTO api_keys(tenant_id,id,name,key_hash,scopes) VALUES($1,$2,$3,$4,$5) RETURNING ${keyColumns}`,
      [
        this.tenant,
        randomUUID(),
        name,
        digest(secret),
        [...new Set(scopes)].sort(),
      ],
    );
    return { apiKey: keyDto(result.rows[0]!), secret };
  }
  async apiKeys() {
    const result = await this.pool.query<KeyRow>(
      `SELECT ${keyColumns} FROM api_keys WHERE tenant_id=$1 ORDER BY created_at,id`,
      [this.tenant],
    );
    return { items: result.rows.map(keyDto) };
  }
  async revokeApiKey(id: string) {
    const result = await this.pool.query<KeyRow>(
      `UPDATE api_keys SET revoked_at=COALESCE(revoked_at,now()) WHERE tenant_id=$1 AND id=$2 RETURNING ${keyColumns}`,
      [this.tenant, id],
    );
    if (!result.rows[0]) throw missing();
    return keyDto(result.rows[0]);
  }
  async withApiKey<T>(
    secret: string,
    work: (db: PoolClient) => Promise<T>,
  ): Promise<T> {
    // A revocation waits for in-flight operations; after it returns no new use can succeed.
    return this.transaction(async (client) => {
      const result = await client.query<KeyRow>(
        `SELECT ${keyColumns} FROM api_keys WHERE tenant_id=$1 AND key_hash=$2 AND revoked_at IS NULL FOR SHARE`,
        [this.tenant, digest(secret)],
      );
      const row = result.rows[0];
      if (
        !row ||
        !row.scopes.some(
          (scope) => scope === "guest:read" || scope === "guest:write",
        )
      )
        throw unauthenticated();
      return work(client);
    });
  }
  async loginHash(client: PoolClient, loginId: string) {
    const result = await client.query<{ id: string; password_hash: string }>(
      "SELECT id,password_hash FROM guests WHERE tenant_id=$1 AND login_id=$2 FOR SHARE",
      [this.tenant, loginId],
    );
    return result.rows[0];
  }
  async consumeLoginLimits(
    client: PoolClient,
    ip: string,
    loginId: string,
  ): Promise<boolean> {
    // Caller commits expected authentication failures so counters survive retry/restart.
    await client.query("DELETE FROM login_limits WHERE expires_at < now()");
    let permitted = true;
    for (const [kind, subject] of [
      ["ip", ip],
      ["guest", loginId],
    ] as const) {
      const rule = LOGIN_LIMITS[kind];
      const result = await client.query<{ attempts: number }>(
        `INSERT INTO login_limits(tenant_id,kind,subject_hash,window_start,attempts,expires_at)
          VALUES($1,$2,$3,to_timestamp(floor(extract(epoch FROM now())/$4)*$4),1,to_timestamp((floor(extract(epoch FROM now())/$4)+1)*$4))
          ON CONFLICT(tenant_id,kind,subject_hash) DO UPDATE SET
            attempts=CASE WHEN login_limits.expires_at <= now() THEN 1 ELSE LEAST(login_limits.attempts+1,1000000) END,
            window_start=EXCLUDED.window_start,expires_at=EXCLUDED.expires_at RETURNING attempts`,
        [this.tenant, kind, digest(subject), rule.seconds],
      );
      if (result.rows[0]!.attempts > rule.attempts) permitted = false;
    }
    return permitted;
  }
}
