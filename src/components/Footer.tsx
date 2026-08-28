import { Coffee } from "lucide-react";
import { cn } from "@/lib/utils";

interface FooterProps {
  className?: string;
}

const footerLinks = [
  { to: "/about", label: "Tentang" },
  { to: "/faq", label: "FAQ" },
  { to: "/contact", label: "Kontak" },
  { to: "/privacy-policy", label: "Kebijakan Privasi" },
  { to: "/terms-of-use", label: "Syarat Penggunaan" },
];

export function Footer({ className }: FooterProps) {
  return (
    <footer className={cn("mt-10 border-t-[3px] border-foreground bg-brutal-bg", className)}>
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 py-5 text-center">
        <nav
          aria-label="Tautan footer"
          className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1"
        >
          {footerLinks.map(({ to, label }) => (
            <a
              key={to}
              href={to}
              className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {label}
            </a>
          ))}
        </nav>
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
