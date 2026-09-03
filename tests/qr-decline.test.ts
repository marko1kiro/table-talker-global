import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const migration = () =>
  readFileSync(
    new URL("../supabase/migrations/20260903013000_decline_qr_scan.sql", import.meta.url),
    "utf8",
  );
const server = () =>
  readFileSync(new URL("../src/lib/dynamic-qr.server.ts", import.meta.url), "utf8");
const declineRoute = () =>
  readFileSync(new URL("../src/routes/q/decline.ts", import.meta.url), "utf8");

it("ships decline_qr_scan RPC: security definer, service-role only", () => {
  const sql = migration();
  expect(sql).toMatch(/create or replace function public\.decline_qr_scan\(p_scan_id uuid\)/i);
  expect(sql).toMatch(
    /revoke all on function public\.decline_qr_scan\(uuid\) from public, anon, authenticated/i,
  );
  expect(sql).toMatch(/grant execute on function public\.decline_qr_scan\(uuid\) to service_role/i);
  expect(sql).toMatch(/security definer/i);
});

it("decline guards: processed status, 10-minute window, latest scan, qr_scan source", () => {
  const sql = migration();
  expect(sql).toMatch(/status = 'processed'/i);
  expect(sql).toMatch(/created_at >= now\(\) - interval '10 minutes'/i);
  expect(sql).toMatch(
    /if exists \(\s*select 1 from public\.qr_scan_events[\s\S]*?scanned_at > v_scan\.processed_at/i,
  );
  expect(sql).toMatch(/occupied_source = 'qr_scan'/i);
  expect(sql).toMatch(/status = 'terisi'/i);
  expect(sql).toMatch(/terminal_reason = 'CUSTOMER_DECLINED'/i);
  expect(sql).toMatch(/bump_table_occupancy_revision/i);
  expect(sql).toMatch(/realtime\.send/i);
});

it("confirmation interstitial: big YA anchor to ESB, TIDAK form to /q/decline", () => {
  const src = server();
  expect(src).toContain("status: 200");
  expect(src).toContain("YA, SAYA MAU PESAN");
  // Tombol YA besar untuk demografi usia acak: 80px tinggi, teks 26px.
  expect(src).toContain("min-height:80px");
  expect(src).toContain("font-size:26px");
  expect(src).toContain("Saya pindah meja");
  expect(src).toContain('action="/q/decline"');
  expect(src).toContain('name="scan_id"');
  expect(src).toContain("form-action 'self'");
  expect(src).not.toMatch(/status: 302,\s*\n\s*headers: \{ Location/);
});

it("decline page uses the approved copy exactly", () => {
  const src = server();
  expect(src).toContain("Meja dibatalkan. Silakan scan QR di meja baru ya, Kak.");
});

it("decline route validates scan_id and calls the RPC", () => {
  const route = declineRoute();
  expect(route).toContain('createFileRoute("/q/decline")');
  expect(route).toMatch(/POST:\s*async/);
  expect(route).toContain("defaultDeclineQrScan");
  expect(route).toMatch(/scan_id/i);
  // RPC name lives in the server module the route delegates to.
  expect(server()).toContain('rpc("decline_qr_scan"');
});
