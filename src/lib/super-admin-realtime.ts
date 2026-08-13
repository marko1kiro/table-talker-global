export function realtimeIsReady(status: string) {
  return status === "SUBSCRIBED";
}

export function createInvalidationDebouncer(invalidate: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const debouncer = () => {
    if (!timer) {
      invalidate();
      timer = setTimeout(() => {
        timer = undefined;
      }, 1_000);
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      invalidate();
    }, 1_000);
  };
  debouncer.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  return debouncer;
}
