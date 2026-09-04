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

  it("shows the first push immediately and clears after the interval", () => {
    const shown: Array<OccupancyNotice | null> = [];
    const queue = createNoticeQueue({ intervalMs: 2000, onShow: (n) => shown.push(n) });
    queue.push(notice(1));
    expect(shown).toEqual([notice(1)]);
    vi.advanceTimersByTime(2000);
    expect(shown.at(-1)).toBeNull();
  });

  it("plays a burst oldest-first, one at a time, dropping nothing", () => {
    const shown: Array<OccupancyNotice | null> = [];
    const queue = createNoticeQueue({ intervalMs: 2000, onShow: (n) => shown.push(n) });
    queue.push(notice(1));
    queue.push(notice(2));
    queue.push(notice(3));
    expect(shown).toEqual([notice(1)]);
    vi.advanceTimersByTime(2000);
    vi.advanceTimersByTime(2000);
    vi.advanceTimersByTime(2000);
    expect(shown).toEqual([notice(1), notice(2), notice(3), null]);
  });

  it("dispose stops further callbacks", () => {
    const shown: Array<OccupancyNotice | null> = [];
    const queue = createNoticeQueue({ intervalMs: 2000, onShow: (n) => shown.push(n) });
    queue.push(notice(1));
    queue.dispose();
    vi.advanceTimersByTime(2000);
    expect(shown).toEqual([notice(1)]);
  });
});
