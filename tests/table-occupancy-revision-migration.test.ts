import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../supabase/migrations/20260902051000_table_occupancy_revision_resilience.sql",
    import.meta.url,
  ),
  "utf8",
);

function functionBlock(name: string): string {
  const pattern = new RegExp(`create (?:or replace )?function public\\.${name}\\(`, "i");
  const match = pattern.exec(sql);
  expect(match, `${name} must be defined`).not.toBeNull();
  const start = match!.index;
  const rest = sql.slice(start + match![0].length);
  const next = rest.search(/create (?:or replace )?function public\./i);
  return next === -1 ? sql.slice(start) : sql.slice(start, start + match![0].length + next);
}

function expectVersionedBroadcast(name: string): void {
  const block = functionBlock(name);
  expect(block).toMatch(/v_revision\s*:=\s*public\.bump_table_occupancy_revision\(/i);
  expect(block).toMatch(
    /jsonb_build_object\([\s\S]*?'revision'\s*,\s*v_revision[\s\S]*?\)[\s\S]*?'invalidate'/i,
  );
  expect(block.indexOf("bump_table_occupancy_revision")).toBeLessThan(
    block.indexOf("realtime.send"),
  );
}

describe("table occupancy revision migration", () => {
  it("stores one monotonic revision per restaurant behind an internal atomic bump helper", () => {
    expect(sql).toMatch(/create table public\.table_occupancy_revisions/i);
    expect(sql).toMatch(
      /restaurant_id uuid primary key[\s\S]*?references public\.restaurants\(id\)/i,
    );
    expect(sql).toMatch(/revision bigint not null default 0/i);

    const helper = functionBlock("bump_table_occupancy_revision");
    expect(helper).toMatch(
      /on conflict \(restaurant_id\)[\s\S]*?revision\s*=\s*table_occupancy_revisions\.revision\s*\+\s*1/i,
    );
    expect(helper).toMatch(/returning revision into/i);
    expect(sql).toMatch(
      /revoke all on function public\.bump_table_occupancy_revision\(uuid\) from public, anon, authenticated, service_role/i,
    );
  });

  it("returns revision and tables from one authenticated versioned snapshot", () => {
    const block = functionBlock("get_table_occupancy_snapshot_versioned");
    expect(block).toMatch(/returns jsonb/i);
    expect(block).toMatch(/jsonb_build_object\(\s*'revision'/i);
    expect(block).toMatch(/'tables'/i);
    expect(block).toMatch(/join public\.restaurants r on r\.id = rst\.restaurant_id/i);
    expect(block).toMatch(/r\.is_active/i);
    expect(block).toMatch(/rst\.code_version = r\.code_version/i);
    expect(sql).toMatch(
      /grant execute on function public\.get_table_occupancy_snapshot_versioned\(uuid, text\) to authenticated/i,
    );
  });

  for (const name of [
    "set_table_occupied_kasir",
    "set_table_empty_cleanup",
    "create_escort_intent",
    "confirm_escort_intent",
    "record_qr_scan",
  ]) {
    it(`${name} bumps and broadcasts the committed snapshot revision`, () => {
      expectVersionedBroadcast(name);
    });
  }

  it.each(["create_escort_intent", "get_table_occupancy_snapshot"])(
    "restores active-restaurant and code-version validation in %s",
    (name) => {
      const block = functionBlock(name);
      expect(block).toMatch(/join public\.restaurants r on r\.id = rst\.restaurant_id/i);
      expect(block).toMatch(/r\.is_active/i);
      expect(block).toMatch(/rst\.code_version = r\.code_version/i);
    },
  );

  it("keeps record_qr_scan service-role-only and rejects inactive restaurants", () => {
    const block = functionBlock("record_qr_scan");
    expect(block).toMatch(/from public\.restaurants[\s\S]*?is_active/i);
    expect(block).toMatch(/raise exception 'RESTAURANT_NOT_FOUND'/i);
    expect(sql).toMatch(
      /revoke all on function public\.record_qr_scan\(uuid, integer\) from public, anon, authenticated/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_qr_scan\(uuid, integer\) to service_role/i,
    );
  });
});
