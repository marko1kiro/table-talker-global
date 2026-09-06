import { cn } from "@/lib/utils";

interface FooterProps {
  className?: string;
  // "light" (default): TailAdmin footer untuk halaman publik/crew (mengikuti
  // .dark). "dark": halus untuk halaman berlatar gelap (login owner).
  variant?: "light" | "dark";
}

const footerLinks = [
  { to: "/about", label: "About" },
  { to: "/faq", label: "FAQ" },
  { to: "/contact", label: "Contact" },
  { to: "/privacy-policy", label: "Privacy Policy" },
  { to: "/terms-of-use", label: "Terms of Use" },
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
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-2.5 px-4 py-4 text-center">
        <nav
          aria-label="Tautan footer"
          className="flex max-w-xs flex-wrap items-center justify-center gap-x-3 gap-y-1 sm:max-w-sm"
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
        <div className="flex flex-col items-center justify-center gap-0.5 text-[11px] text-ta-gray-400">
          <p className="flex items-center justify-center gap-1">
            lihatmeja.com <span aria-label="copyright">©</span> {new Date().getFullYear()}
          </p>
          <p className="whitespace-nowrap font-bold uppercase tracking-wide text-ta-gray-400 dark:text-ta-gray-500">
            XDIRGA LABS <span className="font-normal not-italic">· SIMPLIFY YOUR MIND</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
