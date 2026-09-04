import { useEffect, useRef, useState } from "react";
import { Bell, Clock } from "lucide-react";

export type BellNotice = { table: number; duration: string };

export function NotificationBell({ items }: { items: BellNotice[] }) {
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
  const count = items.length;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Notifikasi"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative grid size-10 place-items-center rounded-lg border border-ta-gray-200 bg-white text-ta-gray-600 transition hover:bg-ta-gray-100 dark:border-ta-gray-700 dark:bg-ta-gray-800 dark:text-ta-gray-300 dark:hover:bg-ta-gray-700"
      >
        <Bell className="size-5" />
        {count > 0 && (
          <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-ta-error px-1 text-[10px] font-bold text-white">
            {count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-xl border border-ta-gray-200 bg-white shadow-theme-md dark:border-ta-gray-700 dark:bg-ta-gray-800">
          <div className="border-b border-ta-gray-100 px-4 py-3 text-sm font-semibold dark:border-ta-gray-700">
            Notifikasi ({count})
          </div>
          {count === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ta-gray-400">
              Tidak ada meja perlu dicek
            </p>
          ) : (
            <ul className="max-h-80 divide-y divide-ta-gray-100 overflow-y-auto dark:divide-ta-gray-700">
              {items.map((it) => (
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
          )}
        </div>
      )}
    </div>
  );
}
