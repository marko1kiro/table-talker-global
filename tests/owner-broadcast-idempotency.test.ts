import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canonicalBroadcastPayload,
  fingerprintBroadcastPayload,
} from "../src/lib/owner-broadcast-idempotency.server";

const file = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("owner broadcast idempotency", () => {
  it("hashes canonical scope, restaurant, and trimmed message", () => {
    const payload = canonicalBroadcastPayload({
      actor: "super-admin",
      scope: "restaurant",
      restaurantId: "fe1b9465-bf18-416d-8909-f7c5aaa664ea",
      message: "  Tes broadcast  ",
    });
    expect(payload).toBe(
      '{"actor":"super-admin","scope":"restaurant","restaurantId":"fe1b9465-bf18-416d-8909-f7c5aaa664ea","message":"Tes broadcast"}',
    );
    expect(fingerprintBroadcastPayload(payload)).toBe(
      createHash("sha256").update(payload).digest("hex"),
    );
  });

  it("uses a migration RPC for atomic rate-limited create-or-replay", () => {
    const source = file("src/lib/owner-broadcast.server.ts");
    const migration = file("supabase/migrations/20260824009000_broadcast_idempotency.sql");
    expect(source).toContain("idempotencyKey: z.string().uuid()");
    expect(source).toContain('"create_or_get_owner_broadcast"');
    expect(source).not.toContain('"check_owner_broadcast_rate_limit"');
    expect(migration).toContain("create_or_get_owner_broadcast");
    expect(migration).toContain("IDEMPOTENCY_CONFLICT");
    expect(migration).toContain("payload_fingerprint");
    expect(migration).toContain("owner_broadcast_delivery_session_unique");
    expect(migration).toContain("where crew_session_id is not null");
    expect(file("src/routes/super-admin/broadcast.tsx")).toContain(
      "shouldResetBroadcastIdempotencyKey(data)",
    );
  });

  it("deduplicates existing delivery audit rows before adding session uniqueness", () => {
    const migration = file("supabase/migrations/20260824009000_broadcast_idempotency.sql");
    const dedupeStart = migration.indexOf("with ranked_deliveries as");
    const indexStart = migration.indexOf("owner_broadcast_delivery_session_unique");
    expect(dedupeStart).toBeGreaterThan(-1);
    expect(migration).toContain("row_number() over (");
    expect(migration).toContain("partition by broadcast_id, crew_session_id");
    expect(migration).toMatch(/status = 'delivered' and crew_message_id is not null\) desc/);
    expect(migration).toMatch(/created_at asc,\s*id asc/);
    expect(migration).toContain("delete from public.owner_broadcast_deliveries");
    expect(dedupeStart).toBeLessThan(indexStart);
  });

  it("persists exact target snapshots and does not replay creating broadcasts", () => {
    const source = file("src/lib/owner-broadcast.server.ts");
    const migration = file("supabase/migrations/20260824009000_broadcast_idempotency.sql");
    expect(migration).toContain("create table public.owner_broadcast_targets");
    expect(migration).toContain("primary key (broadcast_id, restaurant_id)");
    expect(migration).toContain(
      "display_name text not null check (char_length(display_name) between 1 and 200)",
    );
    expect(migration).toContain("record_owner_broadcast_snapshot");
    expect(migration).toContain("finalize_owner_broadcast");
    expect(migration).toContain(
      "status text not null default 'creating' check (status in ('creating', 'complete'))",
    );
    expect(migration).toContain("IN_PROGRESS");
    expect(migration).toContain("snapshot_created_at");
    expect(source).toContain("record_owner_broadcast_snapshot");
    expect(source).toContain("finalize_owner_broadcast");
    expect(source).toContain("owner_broadcast_targets");
    expect(source).toContain('broadcast.status === "creating"');
  });

  it("freezes original eligible recipients before fanout", () => {
    const source = file("src/lib/owner-broadcast.server.ts");
    const migration = file("supabase/migrations/20260824009000_broadcast_idempotency.sql");
    expect(migration).toContain("create table public.owner_broadcast_recipients");
    expect(migration).toContain("primary key (broadcast_id, crew_session_id)");
    expect(migration).toContain("record_owner_broadcast_snapshot");
    expect(migration).toContain("owner_broadcast_recipients enable row level security");
    expect(source).toContain('"record_owner_broadcast_snapshot"');
    expect(source).toContain('from("owner_broadcast_recipients")');
    expect(source.indexOf('"record_owner_broadcast_snapshot"')).toBeLessThan(
      source.indexOf('"create_owner_broadcast_delivery"'),
    );
    expect(source).toContain("broadcast.snapshotCreated");
  });

  it("blocks completion while any frozen recipient lacks a delivery", () => {
    const source = file("src/lib/owner-broadcast.server.ts");
    const migration = file("supabase/migrations/20260824009000_broadcast_idempotency.sql");
    expect(migration).toMatch(/into v_broadcast;[\s\S]*for update/);
    expect(migration).toContain("v_broadcast.snapshot_created_at is null");
    expect(migration).toContain("left join public.owner_broadcast_deliveries d");
    expect(migration).toContain("d.crew_session_id is null");
    expect(migration).toContain("BROADCAST_INCOMPLETE");
    expect(source).toContain('finalizeError?.message.includes("BROADCAST_INCOMPLETE")');
    expect(source).toContain("Broadcast belum selesai.");
  });

  it("rejects delivery requests outside frozen recipients", () => {
    const source = file("src/lib/owner-broadcast.server.ts");
    const migration = file("supabase/migrations/20260824009000_broadcast_idempotency.sql");
    const deliveryStart = migration.indexOf(
      "create or replace function public.create_owner_broadcast_delivery",
    );
    const recipientGate = migration.indexOf("RECIPIENT_NOT_SNAPSHOTTED");
    const eligibility = migration.indexOf("TARGET_NOT_ELIGIBLE");
    expect(recipientGate).toBeGreaterThan(deliveryStart);
    expect(recipientGate).toBeLessThan(eligibility);
    expect(migration).toContain("from public.owner_broadcast_recipients");
    expect(source).toContain('message.includes("RECIPIENT_NOT_SNAPSHOTTED")');
  });

  it("guards every mutation with current processing token", () => {
    const source = file("src/lib/owner-broadcast.server.ts");
    const migration = file("supabase/migrations/20260824009000_broadcast_idempotency.sql");
    expect(migration).toContain("add column processing_token uuid");
    expect(migration).toContain("p_processing_token uuid");
    expect(migration).toContain("LEASE_LOST");
    expect(migration).toContain(
      "snapshot_created_at is not null then raise exception 'SNAPSHOT_ALREADY_RECORDED'",
    );
    expect(source).toContain("p_processing_token: broadcast.processingToken");
    expect(source).toContain("broadcast.processingToken");
    expect(source).toContain("if (!broadcast.snapshotCreated)");
  });
});
