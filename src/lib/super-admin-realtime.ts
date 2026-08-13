export function realtimeIsReady(status: string) {
  return status === "SUBSCRIBED";
}

export function createInvalidationDebouncer(invalidate: () => void, now = Date.now) {
  let lastInvalidation = -1_000;
  return () => {
    if (now() - lastInvalidation < 1_000) return;
    lastInvalidation = now();
    invalidate();
  };
}
