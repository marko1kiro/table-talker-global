import { describe, expect, it } from "vitest";
import {
  noticeCenterReducer,
  initialNoticeCenterState,
  NOTICE_FEED_CAP,
} from "../src/hooks/use-notification-center";
import type { OccupancyNotice } from "../src/lib/occupancy-notice";

const n = (line1: string): OccupancyNotice => ({ line1, roleLabel: "KASIR", actorName: null });

describe("noticeCenterReducer", () => {
  it("push prepends newest and increments unread", () => {
    const s1 = noticeCenterReducer(initialNoticeCenterState, { type: "push", notice: n("A") });
    const s2 = noticeCenterReducer(s1, { type: "push", notice: n("B") });
    expect(s2.items.map((i) => i.line1)).toEqual(["B", "A"]);
    expect(s2.unread).toBe(2);
  });
  it("read zeroes unread but keeps items", () => {
    let s = noticeCenterReducer(initialNoticeCenterState, { type: "push", notice: n("A") });
    s = noticeCenterReducer(s, { type: "read" });
    expect(s.unread).toBe(0);
    expect(s.items).toHaveLength(1);
  });
  it("caps items at the cap but unread keeps counting (FB model)", () => {
    let s = initialNoticeCenterState;
    for (let i = 0; i < NOTICE_FEED_CAP + 10; i++)
      s = noticeCenterReducer(s, { type: "push", notice: n(`M${i}`) });
    expect(s.items).toHaveLength(NOTICE_FEED_CAP);
    expect(s.unread).toBe(NOTICE_FEED_CAP + 10);
  });
});
