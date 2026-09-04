import type { OccupancyNotice } from "./occupancy-notice";

export type NoticeQueue = {
  push: (notice: OccupancyNotice) => void;
  dispose: () => void;
};

// FIFO ticker: shows one notice at a time for intervalMs, oldest first, never
// dropping. Mirrors the realtime controller's injectable-timer style so it is
// unit-testable without React.
export function createNoticeQueue({
  intervalMs = 2000,
  onShow,
  setIntervalFn = (handler: () => void, ms: number) => setTimeout(handler, ms),
  clearTimeoutFn = (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
}: {
  intervalMs?: number;
  onShow: (notice: OccupancyNotice | null) => void;
  setIntervalFn?: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void;
}): NoticeQueue {
  const queue: OccupancyNotice[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let showing = false;
  let disposed = false;

  function advance() {
    if (disposed) return;
    const next = queue.shift() ?? null;
    if (next) {
      showing = true;
      onShow(next);
      timer = setIntervalFn(advance, intervalMs);
    } else {
      showing = false;
      onShow(null);
      timer = null;
    }
  }

  return {
    push(notice) {
      if (disposed) return;
      queue.push(notice);
      if (!showing) advance();
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeoutFn(timer);
      timer = null;
    },
  };
}
