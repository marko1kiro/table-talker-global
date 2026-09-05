import { cn } from "@/lib/utils";

interface FooterProps {
  className?: string;
  // "light" (default): TailAdmin footer untuk halaman publik/crew (mengikuti
  // .dark). "dark": halus untuk halaman berlatar gelap (login owner).
  variant?: "light" | "dark";
}

const footerLinks = [
  { to: "/about", label: "Tentang" },
  { to: "/faq", label: "FAQ" },
  { to: "/contact", label: "Kontak" },
  { to: "/privacy-policy", label: "Kebijakan Privasi" },
  { to: "/terms-of-use", label: "Syarat Penggunaan" },
];

export function Footer({ className, variant = "light" }: FooterProps) {
  const isDark = variant === "dark";
  return (
    <footer
      className={cn(
        "w-full border-t",
        isDark
          ? "border-white/10 bg-ta-gray-900 text-ta-gray-400"
          : "mt-10 border-ta-gray-200 bg-white dark:border-ta-gray-700 dark:bg-ta-gray-800",
        className,
      )}
    >
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 py-5 text-center">
        <nav
          aria-label="Tautan footer"
          className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1"
        >
          {footerLinks.map(({ to, label }) => (
            <a
              key={to}
              href={to}
              className="text-[10px] font-bold uppercase tracking-wide text-ta-gray-500 underline-offset-2 transition hover:text-brand-500 hover:underline dark:text-ta-gray-400"
            >
              {label}
            </a>
          ))}
        </nav>
        <p className="flex items-center justify-center gap-1 text-[11px] text-ta-gray-400">
          lihatmeja.com <span aria-label="copyright">©</span> {new Date().getFullYear()}
        </p>
        <p className="text-[11px] font-bold uppercase tracking-wide text-ta-gray-400 dark:text-ta-gray-500">
          XDIRGA LABS
        </p>
      </div>
    </footer>
  );
}
