import { Coffee } from "lucide-react";
import { cn } from "@/lib/utils";

interface FooterProps {
  className?: string;
}

export function Footer({ className }: FooterProps) {
  return (
    <footer className={cn("mt-10 border-t-[3px] border-foreground bg-brutal-bg", className)}>
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-4 py-5 text-center">
        <div className="brutal-border brutal-shadow-sm inline-flex items-center gap-2 bg-accent px-3 py-1.5">
          <span className="text-[11px] font-bold uppercase tracking-wide">JANGAN LUPA</span>
          <Coffee className="h-4 w-4" strokeWidth={3} aria-label="coffee" />
          <span className="text-[11px] font-bold uppercase tracking-wide">YA GAES! 😂</span>
        </div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          By 👉 <span className="font-display text-foreground">BANG MARKO GANTENG 😏</span>
        </p>
        <p className="text-[9px] font-bold uppercase text-muted-foreground">
          © {new Date().getFullYear()} Table Talker
        </p>
      </div>
    </footer>
  );
}
