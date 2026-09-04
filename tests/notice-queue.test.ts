import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNoticeQueue } from "../src/lib/notice-queue";
import type { OccupancyNotice } from "../src/lib/occupancy-notice";

const notice = (n: number): OccupancyNotice => ({
  line1: `MEJA ${n} TERISI`,
  roleLabel: "KASIR",
  actorName: "Budi",
});

describe("createNoticeQueue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("holds each toast 5s while the backlog is 10 or fewer", () => {
    const shown: Array<OccupancyNotice | null> = [];
    const queue = createNoticeQueue({ onShow: (n) => shown.push(n) });
    queue.push(notice(1));
    expect(shown).toEqual([notice(1)]);
    vi.advanceTimersByTime(3500);
    expect(shown).toEqual([notice(1)]); // not advanced yet (5s cadence)
    vi.advanceTimersByTime(1500);
    expect(shown.at(-1)).toBeNull();
  });

  it("speeds to 3.5s per toast while more than 10 are queued", () => {
    const shown: Array<OccupancyNotice | null> = [];
    const queue = createNoticeQueue({ onShow: (n) => shown.push(n) });
    queue.push(notice(1)); // first toast, backlog 0 -> 5s cadence
    for (let i = 2; i <= 13; i++) queue.push(notice(i)); // build a 12-deep backlog
    vi.advanceTimersByTime(5000); // toast 1 ends; toast 2 pops leaving 11 waiting
    expect(shown).toEqual([notice(1), notice(2)]);
    vi.advanceTimersByTime(3500); // >10 waiting -> fast cadence advances to toast 3
    expect(shown).toEqual([notice(1), notice(2), notice(3)]);
  });

  it("plays a burst oldest-first, one at a time, dropping nothing", () => {
    const shown: Array<OccupancyNotice | null> = [];
    const queue = createNoticeQueue({ onShow: (n) => shown.push(n) });
    queue.push(notice(1));
    queue.push(notice(2));
    queue.push(notice(3));
    expect(shown).toEqual([notice(1)]);
    vi.advanceTimersByTime(5000);
    vi.advanceTimersByTime(5000);
    vi.advanceTimersByTime(5000);
    expect(shown).toEqual([notice(1), notice(2), notice(3), null]);
  });

  it("dispose stops further callbacks", () => {
    const shown: Array<OccupancyNotice | null> = [];
    const queue = createNoticeQueue({ onShow: (n) => shown.push(n) });
    queue.push(notice(1));
    queue.dispose();
    vi.advanceTimersByTime(5000);
    expect(shown).toEqual([notice(1)]);
  });
});
