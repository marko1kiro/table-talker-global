/* eslint-disable react-refresh/only-export-components */
import type { InputHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Compact TailAdmin input: leading icon inside the field, no visible label row
// (accessibility via aria-label), optional trailing slot (e.g. show/hide eye).
export const taIconInputClass =
  "min-h-11 w-full rounded-lg border border-ta-gray-300 bg-white py-2.5 pl-11 pr-3.5 text-sm text-ta-gray-900 outline-none transition placeholder:text-ta-gray-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/12 dark:border-ta-gray-700 dark:bg-ta-gray-900 dark:text-ta-gray-100 dark:placeholder:text-ta-gray-500";

export function IconField({
  icon: Icon,
  trailing,
  className,
  ...inputProps
}: { icon: LucideIcon; trailing?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-ta-gray-400" />
      <input className={cn(taIconInputClass, trailing && "pr-12", className)} {...inputProps} />
      {trailing && (
        <div className="absolute inset-y-0 right-0 flex w-11 items-center justify-center">
          {trailing}
        </div>
      )}
    </div>
  );
}

export function AuthShell({
  logo,
  title,
  subtitle,
  children,
  footer,
}: {
  logo?: ReactNode;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-[100svh] items-center justify-center bg-ta-gray-50 px-4 py-10 font-outfit text-ta-gray-900">
      <div className="w-full max-w-md rounded-2xl border border-ta-gray-200 bg-white p-8 shadow-theme-md">
        {logo && (
          <div className="mx-auto mb-6 grid size-16 place-items-center rounded-2xl bg-brand-50">
            {logo}
          </div>
        )}
        <h1 className="text-center text-2xl font-bold tracking-tight text-ta-gray-900">{title}</h1>
        {subtitle && <p className="mt-1 text-center text-sm text-ta-gray-500">{subtitle}</p>}
        <div className="mt-6">{children}</div>
        {footer && <div className="mt-6 text-center text-sm">{footer}</div>}
      </div>
    </main>
  );
}

// TailAdmin split auth shell: form column (children) + branding panel (lg+).
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative z-10 flex min-h-[100svh] w-full flex-col bg-white lg:flex-row dark:bg-ta-gray-900">
      <div className="flex flex-1 flex-col justify-center px-6 py-12 sm:px-10">
        <div className="mx-auto w-full max-w-md">{children}</div>
      </div>
      <div className="relative hidden w-full items-center justify-center overflow-hidden bg-brand-950 lg:flex lg:w-1/2 dark:bg-white/5">
        <img
          src="/shape/grid-01.svg"
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute right-0 top-0 w-[250px] xl:w-[450px]"
        />
        <img
          src="/shape/grid-01.svg"
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 left-0 w-[250px] rotate-180 xl:w-[450px]"
        />
        <div className="relative z-10 flex max-w-xs flex-col items-center">
          <span className="mb-4 grid place-items-center rounded-2xl bg-white px-5 py-3">
            <img src="/lime-logo.webp" alt="LIME" className="h-10 w-auto" />
          </span>
          <p className="text-center text-sm text-ta-gray-400">
            Sistem Panggilan &amp; Status Meja Restoran
          </p>
        </div>
      </div>
    </div>
  );
}
