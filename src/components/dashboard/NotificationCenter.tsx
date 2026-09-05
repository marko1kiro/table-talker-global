import { useEffect, useRef, useState } from "react";
import { Bell, Clock } from "lucide-react";
import type { StaleNotice } from "@/lib/manager-reminder";
import type { OccupancyNotice } from "@/lib/occupancy-notice";

export function NotificationCenter({
  stale,
  feed,
  unread,
  onOpen,
}: {
  stale: StaleNotice[];
  feed: OccupancyNotice[];
  unread: number;
  onOpen: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const toggle = () =>
    setOpen((o) => {
      const next = !o;
      if (next) onOpen();
      return next;
    });
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Notifikasi"
        aria-expanded={open}
        onClick={toggle}
        className="relative grid size-10 place-items-center rounded-lg border border-ta-gray-200 bg-white text-ta-gray-600 transition hover:bg-ta-gray-100 dark:border-ta-gray-700 dark:bg-ta-gray-800 dark:text-ta-gray-300 dark:hover:bg-ta-gray-700"
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-ta-error px-1 text-[10px] font-bold text-white">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-ta-gray-200 bg-white shadow-theme-md dark:border-ta-gray-700 dark:bg-ta-gray-800">
          {stale.length > 0 && (
            <div className="border-b border-ta-gray-100 dark:border-ta-gray-700">
              <p className="px-4 py-2 text-[11px] font-bold text-ta-gray-500 uppercase dark:text-ta-gray-400">
                Perlu Dicek
              </p>
              <ul className="max-h-48 divide-y divide-ta-gray-100 overflow-y-auto dark:divide-ta-gray-700">
                {stale.map((it) => (
                  <li key={it.table} className="flex items-center gap-3 px-4 py-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ta-warning/10 text-ta-warning">
                      <Clock className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="font-semibold">Meja {it.table} perlu dicek</span>
                      <span className="block text-xs text-ta-gray-400">&gt;{it.duration}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="px-4 py-2 text-[11px] font-bold text-ta-gray-500 uppercase dark:text-ta-gray-400">
            Aktivitas
          </p>
          {feed.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ta-gray-400">
              Belum ada perubahan status meja
            </p>
          ) : (
            <ul className="max-h-64 divide-y divide-ta-gray-100 overflow-y-auto dark:divide-ta-gray-700">
              {feed.map((item, i) => (
                <li
                  key={`${item.line1}-${i}`}
                  className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate font-semibold text-ta-gray-800 dark:text-ta-gray-100">
                    {item.line1}
                  </span>
                  <span className="shrink-0 rounded-full bg-brand-500 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                    {item.roleLabel}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
