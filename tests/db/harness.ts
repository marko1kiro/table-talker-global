// Disposable Postgres harness for staff-access integration tests.
// - Local runs: embedded-postgres (PG17 binaries, temp data dir, no service).
// - CI runs: TEST_DATABASE_URL pointing at a disposable Postgres service.
// Both paths replay the FULL supabase migration chain from an empty database
// (with a legacy-schema seed hook before the Poin 2 migrations) — production
// / staging remote databases are never touched.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes, scrypt as scryptCb } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import EmbeddedPostgres from "embedded-postgres";

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../supabase/migrations",
);

export const SEED_AFTER = "20260908195839_drop_super_admin_purge_restaurant_test_data.sql";
const SHIM = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "supabase-shim.sql"),
  "utf8",
);

export function migrationFiles(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export type LegacySeed = (client: Client) => Promise<void>;

export type TestDb = {
  name: string;
  connectionString: string;
  client: () => Promise<Client>;
  close: () => Promise<void>;
};

type EmbeddedHandle = {
  pg: import("pg").Pool | null;
  embedded: {
    createDatabase: (name: string) => Promise<void>;
    dropDatabase: (name: string) => Promise<void>;
    getPgClient: (name: string) => Client;
    stop: () => Promise<void>;
  };
  port: number;
};

let embeddedHandle: EmbeddedHandle | null = null;

/** Reserve an ephemeral free port so parallel test files each get their own
 * embedded Postgres instead of fighting over the hardcoded 54329. */
async function getFreePort(): Promise<number> {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error("no free port"))));
    });
    srv.on("error", reject);
  });
}

async function getEmbedded(): Promise<EmbeddedHandle> {
  if (!embeddedHandle) {
    const dataDir = path.join(os.tmpdir(), `lime-pg-staff-tests-${process.pid}-${Date.now()}`);
    const port = await getFreePort();
    const embedded = new EmbeddedPostgres({
      databaseDir: dataDir,
      user: "postgres",
      password: "postgres",
      port,
      persistent: false,
    });
    await embedded.initialise();
    await embedded.start();
    embeddedHandle = { pg: null, embedded, port };
    process.on("exit", () => {
      void embeddedHandle?.embedded.stop();
    });
  }
  return embeddedHandle;
}

async function adminClient(connectionString?: string): Promise<Client> {
  const fallback = `postgres://postgres:postgres@localhost:${embeddedHandle?.port ?? 54329}/postgres`;
  const c = new Client(connectionString ?? fallback);
  await c.connect();
  return c;
}

export async function createTestDb(
  name: string,
  opts?: { seedLegacy?: LegacySeed; seedPost?: LegacySeed },
): Promise<TestDb> {
  const external = process.env.TEST_DATABASE_URL;
  if (!external) await getEmbedded();
  const admin = await adminClient(external);
  await admin.query(`drop database if exists "${name}" with (force)`);
  await admin.query(
    `create database "${name}" template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C'`,
  );
  await admin.end();

  const connectionString = external
    ? external.replace(/\/postgres(\?|$)/, `/${name}$1`)
    : `postgres://postgres:postgres@localhost:${embeddedHandle?.port ?? 54329}/${name}`;

  const client = new Client({ connectionString });
  await client.connect();
  await client.query(SHIM);

  for (const file of migrationFiles()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    try {
      await client.query(sql);
    } catch (error) {
      await client.end();
      throw new Error(`migration ${file} failed: ${(error as Error).message}`);
    }
    if (file === SEED_AFTER && opts?.seedLegacy) {
      await opts.seedLegacy(client);
    }
  }
  // Seed data for tables CREATED by the migration chain itself (the legacy
  // hook above runs before Poin 2 — anything touching Poin 2 tables must go
  // here, after the full chain exists).
  if (opts?.seedPost) {
    await opts.seedPost(client);
  }

  return {
    name,
    connectionString,
    client: async () => client,
    close: async () => {
      await client.end().catch(() => undefined);
    },
  };
}

export async function connect(connectionString: string): Promise<Client> {
  const c = new Client({ connectionString });
  await c.connect();
  return c;
}

export async function stopAll(): Promise<void> {
  if (embeddedHandle) {
    await embeddedHandle.embedded.stop().catch(() => undefined);
    embeddedHandle = null;
  }
}

// Deterministic scrypt verifier in the same "salt:hash" hex format the Node
// server fns produce (manager-password.server.ts).
export async function scryptHash(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await new Promise<Buffer>((resolve, reject) =>
    scryptCb(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key))),
  );
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Raw 32-byte hex token — the format the production session mints use. */
export function rawHexToken(): string {
  return randomBytes(32).toString("hex");
}

/** Calls a public RPC with named-arg ordering preserved. */
export async function rpc<T = unknown>(
  client: Client,
  fn: string,
  params: Record<string, unknown>,
): Promise<{ data: T | null; error: string | null }> {
  const values = Object.values(params);
  const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
  try {
    const result = await client.query(`select public.${fn}(${placeholders}) as data`, values);
    return { data: (result.rows[0]?.data as T) ?? null, error: null };
  } catch (error) {
    return { data: null, error: (error as Error).message };
  }
}

/** Calls a public RPC with TRUE named notation — parameter NAMES are part of
 * the contract under test (review C14): a wrong/renamed parameter must fail. */
export async function rpcNamed<T = unknown>(
  client: Client,
  fn: string,
  params: Record<string, unknown>,
): Promise<{ data: T | null; error: string | null }> {
  const entries = Object.entries(params);
  const notation = entries.map(([name], i) => `${name} := $${i + 1}`).join(", ");
  try {
    const result = await client.query(
      `select public.${fn}(${notation}) as data`,
      entries.map(([, value]) => value),
    );
    return { data: (result.rows[0]?.data as T) ?? null, error: null };
  } catch (error) {
    return { data: null, error: (error as Error).message };
  }
}

/** Calls a public set-returning RPC and returns all rows. */
export async function rpcRows<T = Record<string, unknown>>(
  client: Client,
  fn: string,
  params: Record<string, unknown>,
): Promise<{ rows: T[]; error: string | null }> {
  const values = Object.values(params);
  const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
  try {
    const result = await client.query(`select * from public.${fn}(${placeholders})`, values);
    return { rows: result.rows as T[], error: null };
  } catch (error) {
    return { rows: [], error: (error as Error).message };
  }
}

/** Assert-style helper that surfaces the RPC error message verbatim. */
export async function rpcOk<T = unknown>(
  client: Client,
  fn: string,
  params: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await rpc<T>(client, fn, params);
  if (error) throw new Error(`rpc ${fn} failed: ${error}`);
  return data as T;
}

/** R6-A: mints a USABLE (active) manager session through the real pending ->
 * confirm handshake. Tests that need a live bearer must go through this, never
 * through the dropped legacy create_manager_session RPC. */
export async function mintActiveManagerSession(client: Client, managerId: string): Promise<string> {
  const token = await rpcOk<string>(client, "create_manager_session_pending", {
    p_manager_id: managerId,
  });
  const confirmed = await rpcOk<boolean>(client, "confirm_manager_session", { p_token: token });
  if (confirmed !== true) throw new Error("confirm_manager_session failed in test harness");
  return token;
}
