import { Link } from "@tanstack/react-router";
import { LifeBuoy, LogOut } from "lucide-react";

interface HeaderProps {
  readyCount: number;
  totalCount: number;
  restaurantDisplayName?: string;
  userName?: string;
  onLogout: () => void;
}

// SS station header. Kept neo-brutalist (unlike the plain shadcn
// CrewHeader used by Kasir/Satgas/Clear Up) but restructured so the top
// area is uniform with the other crew dashboards: logo + role badge +
// logged-in user name on one row (sign-out at the far right), then the
// resto name on its own line below. The Soundboard grid/table-number
// style below this header is untouched.
export function Header({
  readyCount,
  totalCount,
  restaurantDisplayName,
  userName,
  onLogout,
}: HeaderProps) {
  const restoLabel = restaurantDisplayName?.trim() || "Restoran";
  return (
    <header className="sticky top-0 z-40 border-b-[3px] border-foreground bg-brutal-bg">
      <div className="mx-auto max-w-6xl px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <Link to="/" className="group flex min-w-0 shrink-0 items-center gap-2.5">
            <div className="brutal-border brutal-shadow-sm flex h-11 w-11 shrink-0 items-center justify-center bg-card p-1.5 transition-transform group-hover:-rotate-6">
              <img src="/lime-logo.webp" alt="LIME" className="h-full w-full object-contain" />
            </div>
            <span className="brutal-border shrink-0 bg-foreground px-2 py-1 text-[10px] font-black uppercase tracking-wider text-primary-foreground">
              SS
            </span>
          </Link>

          <div className="flex min-w-0 shrink-0 items-center gap-2">
            <div className="brutal-border hidden bg-card px-3 py-1.5 sm:block">
              <div className="text-[9px] font-bold uppercase text-muted-foreground">Siap</div>
              <div className="font-display text-sm leading-none">
                {readyCount}
                <span className="text-muted-foreground">/{totalCount}</span>
              </div>
            </div>
            <Link
              to="/help"
              aria-label="Butuh bantuan?"
              className="brutal-border brutal-shadow-sm brutal-press hidden h-11 w-11 items-center justify-center bg-card sm:flex"
            >
              <LifeBuoy className="h-5 w-5" strokeWidth={3} />
            </Link>
            {userName && (
              <span className="max-w-[6rem] truncate text-[10px] font-black uppercase tracking-wider sm:max-w-[10rem] sm:text-[11px]">
                {userName}
              </span>
            )}
            <button
              type="button"
              onClick={onLogout}
              aria-label="Keluar"
              title="Keluar"
              className="brutal-border brutal-shadow-sm brutal-press flex h-11 w-11 shrink-0 items-center justify-center bg-card text-destructive"
            >
              <LogOut className="h-5 w-5" strokeWidth={3} />
            </button>
          </div>
        </div>

        <div className="mt-2 flex items-start">
          <div className="inline-block max-w-full truncate border-2 border-foreground bg-card px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider">
            <span className="text-destructive">◆</span> {restoLabel}
          </div>
        </div>
      </div>
      <div className="border-t-[3px] border-foreground bg-accent px-4 py-1.5 sm:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2">
          <Link
            to="/help"
            className="brutal-press flex min-w-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider"
          >
            <span className="brutal-border brutal-shadow-sm inline-flex shrink-0 items-center gap-1 bg-foreground px-1.5 py-0.5 font-black text-primary-foreground">
              <LifeBuoy className="h-3.5 w-3.5" strokeWidth={3} />
              KLIK DISINI
            </span>
            <span className="truncate normal-case tracking-normal opacity-80">
              Jika kamu butuh bantuan atau ada Error
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <span className="font-display text-sm">
              {readyCount}
              <span className="opacity-60">/{totalCount}</span>
            </span>
            <button
              type="button"
              onClick={onLogout}
              aria-label="Keluar"
              className="brutal-press flex h-6 w-6 items-center justify-center text-destructive"
            >
              <LogOut className="h-4 w-4" strokeWidth={3} />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
