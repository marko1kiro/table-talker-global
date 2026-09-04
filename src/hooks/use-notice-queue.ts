import { useEffect, useMemo, useState } from "react";
import { createNoticeQueue } from "../lib/notice-queue";
import type { OccupancyNotice } from "../lib/occupancy-notice";

export function useNoticeQueue(intervalMs = 2000) {
  const [current, setCurrent] = useState<OccupancyNotice | null>(null);
  const queue = useMemo(
    () => createNoticeQueue({ intervalMs, onShow: setCurrent }),
    [intervalMs],
  );
  useEffect(() => () => queue.dispose(), [queue]);
  return { push: queue.push, current };
}
