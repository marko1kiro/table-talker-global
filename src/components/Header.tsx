import { Link } from "@tanstack/react-router";
import { LifeBuoy, Volume2 } from "lucide-react";

interface HeaderProps {
  readyCount: number;
  totalCount: number;
  restaurantDisplayName?: string;
}

export function Header({ readyCount, totalCount, restaurantDisplayName }: HeaderProps) {
  const restoLabel = restaurantDisplayName?.trim() || "Table Talker";
  return (
    <header className="sticky top-0 z-40 border-b-[3px] border-foreground bg-brutal-bg">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <Link to="/" className="group flex items-center gap-2.5">
          <div className="brutal-border brutal-shadow-sm relative flex h-11 w-11 items-center justify-center bg-accent transition-transform group-hover:-rotate-6">
            <Volume2 className="h-5 w-5" strokeWidth={3} />
            <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-foreground bg-destructive" />
          </div>
          <div className="leading-none">
            <div className="font-display text-lg uppercase tracking-tight sm:text-xl">
              <span className="bg-foreground px-1.5 py-0.5 text-primary-foreground">Table</span>
              <span className="ml-1 bg-accent px-1.5 py-0.5 text-accent-foreground [text-shadow:2px_2px_0_var(--brutal-fg)]">
                Talker
              </span>
            </div>
            <div className="mt-1 inline-block max-w-[220px] truncate border-2 border-foreground bg-card px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider">
              <span className="text-destructive">◆</span> {restoLabel}
            </div>
          </div>
        </Link>

        <div className="flex items-center gap-2">
          <Link
            to="/help"
            aria-label="Butuh bantuan?"
            className="brutal-border brutal-shadow-sm brutal-press hidden h-11 w-11 items-center justify-center bg-card sm:flex"
          >
            <LifeBuoy className="h-5 w-5" strokeWidth={3} />
          </Link>
          <div className="brutal-border hidden bg-card px-3 py-1.5 sm:block">
            <div className="text-[9px] font-bold uppercase text-muted-foreground">Siap</div>
            <div className="font-display text-sm leading-none">
              {readyCount}
              <span className="text-muted-foreground">/{totalCount}</span>
            </div>
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
          <span className="font-display shrink-0 text-sm">
            {readyCount}
            <span className="opacity-60">/{totalCount}</span>
          </span>
        </div>
      </div>
    </header>
  );
}
