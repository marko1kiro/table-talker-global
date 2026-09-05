import { useEffect, useRef, useState } from "react";
import { ChevronDown, KeyRound, LogOut, UserRound } from "lucide-react";

export function ProfileMenu({
  name,
  idManager,
  onLogout,
}: {
  name: string;
  idManager: string;
  onLogout: () => void;
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
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Menu profil"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-ta-gray-200 bg-white py-1 pl-1 pr-2 transition hover:bg-ta-gray-100 dark:border-ta-gray-700 dark:bg-ta-gray-800 dark:hover:bg-ta-gray-700"
      >
        <span className="grid size-8 place-items-center rounded-full bg-ta-gray-100 text-ta-gray-400 dark:bg-ta-gray-700 dark:text-ta-gray-300">
          <UserRound className="size-5" />
        </span>
        <span className="hidden max-w-[8rem] truncate text-sm font-semibold sm:block">{name}</span>
        <ChevronDown className="size-4 text-ta-gray-400" />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-ta-gray-200 bg-white py-1 shadow-theme-md dark:border-ta-gray-700 dark:bg-ta-gray-800">
          <div className="border-b border-ta-gray-100 px-4 py-2 dark:border-ta-gray-700">
            <p className="truncate text-sm font-semibold">{name}</p>
            <p className="truncate text-xs text-ta-gray-500 dark:text-ta-gray-400">
              ID: {idManager}
            </p>
          </div>
          <button
            type="button"
            disabled
            className="flex w-full cursor-not-allowed items-center gap-2 px-4 py-2 text-left text-sm text-ta-gray-400 dark:text-ta-gray-500"
          >
            <KeyRound className="size-4" /> Ganti password
            <span className="ml-auto text-[10px] font-semibold uppercase">Segera hadir</span>
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm font-semibold text-ta-error hover:bg-ta-error/10"
          >
            <LogOut className="size-4" /> Keluar
          </button>
        </div>
      )}
    </div>
  );
}
