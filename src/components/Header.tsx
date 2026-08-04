import { Link, useLocation } from "@tanstack/react-router";
import { Volume2, Upload } from "lucide-react";

interface HeaderProps {
  readyCount: number;
  totalCount: number;
}

export function Header({ readyCount, totalCount }: HeaderProps) {
  const location = useLocation();
  const pathname = location.pathname;

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
            <div className="mt-1 inline-block border-2 border-foreground bg-card px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider">
              <span className="text-destructive">◆</span> Mie Gacoan{" "}
              <span className="text-muted-foreground">·</span> Kampung Bulu
            </div>
          </div>
        </Link>

        <div className="flex items-center gap-2">
          <div className="brutal-border hidden bg-card px-3 py-1.5 sm:block">
            <div className="text-[9px] font-bold uppercase text-muted-foreground">Siap</div>
            <div className="font-display text-sm leading-none">
              {readyCount}
              <span className="text-muted-foreground">/{totalCount}</span>
            </div>
          </div>
          <NavButton
            to="/"
            active={pathname === "/"}
            label="Panggil"
            icon={<Volume2 className="h-4 w-4" strokeWidth={3} />}
          />
          <NavButton
            to="/manage"
            active={pathname === "/manage"}
            label="Kelola"
            icon={<Upload className="h-4 w-4" strokeWidth={3} />}
          />
        </div>
      </div>
      <div className="border-t-[3px] border-foreground bg-accent px-4 py-1.5 sm:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <span className="text-[10px] font-black uppercase tracking-wider">
            Semua Voice Meja Siap
          </span>
          <span className="font-display text-sm">
            {readyCount}
            <span className="opacity-60">/{totalCount}</span>
          </span>
        </div>
      </div>
    </header>
  );
}

function NavButton({
  to,
  active,
  label,
  icon,
}: {
  to: string;
  active: boolean;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className={`brutal-border brutal-press inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold uppercase ${
        active
          ? "brutal-shadow bg-foreground text-primary-foreground"
          : "brutal-shadow-sm bg-card text-foreground"
      }`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
}
