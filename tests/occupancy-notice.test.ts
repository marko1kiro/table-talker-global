import { describe, expect, it } from "vitest";
import { formatOccupancyNotice, parseOccupancyBroadcast } from "../src/lib/occupancy-notice";

const FULL = {
  payload: {
    table_number: 5,
    revision: 9,
    kind: "occupied",
    actor_role: "kasir",
    actor_name: "Budi",
    actor_role_session_id: "sess-budi",
  },
};

describe("parseOccupancyBroadcast", () => {
  it("accepts a full enriched payload", () => {
    expect(parseOccupancyBroadcast(FULL)).toEqual({
      table_number: 5,
      revision: 9,
      kind: "occupied",
      actor_role: "kasir",
      actor_name: "Budi",
      actor_role_session_id: "sess-budi",
    });
  });
  it("rejects a legacy invalidate hint (no kind)", () => {
    expect(parseOccupancyBroadcast({ payload: { table_number: 5, revision: 9 } })).toBeNull();
  });
  it("rejects malformed fields", () => {
    expect(parseOccupancyBroadcast(null)).toBeNull();
    expect(parseOccupancyBroadcast({ payload: { ...FULL.payload, kind: "nope" } })).toBeNull();
    expect(parseOccupancyBroadcast({ payload: { ...FULL.payload, table_number: "5" } })).toBeNull();
  });
  it("treats missing actor name/session as null (customer scan)", () => {
    const parsed = parseOccupancyBroadcast({
      payload: {
        ...FULL.payload,
        actor_role: "qr_scan",
        actor_name: null,
        actor_role_session_id: null,
      },
    });
    expect(parsed?.actor_name).toBeNull();
    expect(parsed?.actor_role_session_id).toBeNull();
  });
});

describe("formatOccupancyNotice", () => {
  const b = parseOccupancyBroadcast(FULL)!;
  it("kasir occupy", () => {
    expect(formatOccupancyNotice(b)).toEqual({
      line1: "MEJA 5 TERISI",
      roleLabel: "KASIR",
      actorName: "Budi",
    });
  });
  it("clear up cleaned", () => {
    expect(
      formatOccupancyNotice({ ...b, kind: "cleared", actor_role: "clear_up", actor_name: "Sari" }),
    ).toEqual({ line1: "MEJA 5 SUDAH DIBERSIHKAN", roleLabel: "CLEAR UP", actorName: "Sari" });
  });
  it("satgas escorted", () => {
    expect(
      formatOccupancyNotice({ ...b, kind: "escorted", actor_role: "satgas", actor_name: "Andi" }),
    ).toEqual({ line1: "MEJA 5 DIESCORT", roleLabel: "SATGAS", actorName: "Andi" });
  });
  it("customer decline has no actor name", () => {
    expect(
      formatOccupancyNotice({
        ...b,
        kind: "cancelled",
        actor_role: "qr_scan",
        actor_name: null,
        actor_role_session_id: null,
      }),
    ).toEqual({ line1: "MEJA 5 DIBATALKAN", roleLabel: "SCAN QR", actorName: null });
  });
});
