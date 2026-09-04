import { useEffect, useMemo, useState } from "react";
import { createNoticeQueue } from "../lib/notice-queue";
import type { OccupancyNotice } from "../lib/occupancy-notice";

export function useNoticeQueue() {
  const [current, setCurrent] = useState<OccupancyNotice | null>(null);
  const queue = useMemo(() => createNoticeQueue({ onShow: setCurrent }), []);
  useEffect(() => () => queue.dispose(), [queue]);
  return { push: queue.push, current };
}
