// Poin 6.1 S1: crew_auth_method verdicts + burst quota. Additive migration:
// must not remove or alter any protected asset object.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import type { Client } from "pg";
import { createTestDb, stopAll, type TestDb } from "./harness";

let db: TestDb;
let c: Client;

beforeAll(async () => {
  db = await createTestDb("lime_p61_crew_auth_method");
  c = await db.client();
}, 600_000);

afterAll(async () => {
  await db?.close();
  await stopAll();
});

afterEach(async () => {
  await c?.query("reset role").catch(() => undefined);
});

async function verdict(email: string): Promise<string> {
  const r = await c.query("select public.crew_auth_method($1) as v", [email]);
  return r.rows[0].v;
}

describe("crew_auth_method verdicts", () => {
  test("unknown email is otp (enumeration stays blurry)", async () => {
    expect(await verdict("tidakada@example.test")).toBe("otp");
  });

  test("user without password is otp; with password is password", async () => {
    await c.query(
      `insert into auth.users (email, encrypted_password) values
        ('lama@ex.test', ''), ('baru@ex.test', null), ('pakai@ex.test', 'xscrypt$abc')`,
    );
    expect(await verdict("lama@ex.test")).toBe("otp");
    expect(await verdict("baru@ex.test")).toBe("otp");
    expect(await verdict("pakai@ex.test")).toBe("password");
  });

  test("verdict ignores case and surrounding spaces", async () => {
    await c.query(`insert into auth.users (email, encrypted_password) values ('Trim@Ex.TEST', 'p')`);
    expect(await verdict("  trim@ex.test  ")).toBe("password");
    expect(await verdict("TRIM@EX.TEST")).toBe("password");
  });
});

describe("reserve_crew_auth_method quota", () => {
  test("allows 50 calls per 15-minute window per bucket, then blocks", async () => {
    const bucket = "t".repeat(64);
    let allowed = 0;
    for (let i = 0; i < 52; i += 1) {
      const r = await c.query("select public.reserve_crew_auth_method($1) as ok", [bucket]);
      if (r.rows[0].ok) allowed += 1;
    }
    expect(allowed).toBe(50);
  });

  test("buckets are independent per ip_hash", async () => {
    const a = "a".repeat(64);
    const b = "b".repeat(64);
    for (let i = 0; i < 52; i += 1) {
      await c.query("select public.reserve_crew_auth_method($1)", [a]);
    }
    const r = await c.query("select public.reserve_crew_auth_method($1) as ok", [b]);
    expect(r.rows[0].ok).toBe(true);
  });
});

describe("grants and shape", () => {
  test("both functions are SECURITY DEFINER with pinned search_path", async () => {
    const r = await c.query(
      `select p.proname, p.prosecdef,
              coalesce(nullif(array_to_string(p.proconfig, ','), ''), '(none)') as cfg
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('crew_auth_method', 'reserve_crew_auth_method')`,
    );
    expect(r.rows).toHaveLength(2);
    for (const row of r.rows) {
      expect(row.prosecdef).toBe(true);
      expect(row.cfg).toContain("search_path=public");
    }
  });

  test("anon and authenticated cannot execute; service_role can", async () => {
    for (const role of ["anon", "authenticated"]) {
      await c.query(`set role ${role}`);
      await expect(
        c.query("select public.crew_auth_method('x@ex.test')"),
      ).rejects.toThrow(/permission denied/i);
      await c.query("reset role");
    }
    await c.query("set role service_role");
    const r = await c.query("select public.crew_auth_method('x@ex.test') as v");
    expect(["otp", "password"]).toContain(r.rows[0].v);
    await c.query("reset role");
  });

  test("quota table is not readable by anon/authenticated", async () => {
    await c.query("set role anon");
    await expect(
      c.query("select 1 from public.crew_auth_method_limits"),
    ).rejects.toThrow(/permission denied/i);
    await c.query("reset role");
  });
});

describe("nothing is dropped (additive migration)", () => {
  test("protected asset tables all survive the replay", async () => {
    const rows = await c.query(
      `select count(*)::int as n from information_schema.tables
        where table_schema = 'public' and table_name = any($1::text[])`,
      [
        [
          "restaurants",
          "crew_accounts",
          "crew_role_sessions",
          "role_session_tokens",
          "manager_accounts",
          "area_manager_accounts",
          "crew_pairing_requests",
          "admin_audit_log",
          "table_occupancy_state",
          "table_occupancy_revisions",
          "lookup_rate_limits",
        ],
      ],
    );
    expect(rows.rows[0].n).toBe(11);
  });
});
