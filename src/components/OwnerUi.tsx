/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from "react";
import { AlertTriangle, Inbox, LoaderCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export const ownerControlClass =
  "mt-1.5 min-h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-amber-500 focus:ring-4 focus:ring-amber-500/10 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";

export const ownerPrimaryButtonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-amber-500 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-500/25 disabled:pointer-events-none disabled:opacity-45";

export const ownerSecondaryButtonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border-2 border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-200 disabled:pointer-events-none disabled:opacity-45";

export const ownerDangerButtonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border-2 border-red-200 bg-red-50 px-4 py-2.5 text-sm font-bold text-red-700 transition hover:border-red-300 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-100 disabled:pointer-events-none disabled:opacity-45";

export function OwnerPage({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("space-y-6", className)}>{children}</div>;
}

export function OwnerPageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-3xl">
        {eyebrow && (
          <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.18em] text-amber-700">
            {eyebrow}
          </p>
        )}
        <h1 className="text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">{title}</h1>
        {description && (
          <p className="mt-2 text-sm leading-6 text-slate-500 sm:text-base">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

export function OwnerPanel({
  children,
  className,
  title,
  description,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  description?: string;
}) {
  return (
    <section className={cn("rounded-2xl border border-slate-200 bg-white shadow-sm", className)}>
      {(title || description) && (
        <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
          {title && <h2 className="text-base font-extrabold text-slate-950">{title}</h2>}
          {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
        </div>
      )}
      <div className="p-5 sm:p-6">{children}</div>
    </section>
  );
}

export function OwnerField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm font-bold text-slate-700">
      {label}
      {children}
      {hint && (
        <span className="mt-1.5 block text-xs font-normal leading-5 text-slate-500">{hint}</span>
      )}
    </label>
  );
}

export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "success" | "danger" | "warning" | "neutral" | "info";
}) {
  const toneClass = {
    success: "bg-emerald-50 text-emerald-700 ring-emerald-600/15",
    danger: "bg-red-50 text-red-700 ring-red-600/15",
    warning: "bg-amber-50 text-amber-800 ring-amber-600/20",
    info: "bg-sky-50 text-sky-700 ring-sky-600/15",
    neutral: "bg-slate-100 text-slate-600 ring-slate-500/10",
  }[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset",
        toneClass,
      )}
    >
      {children}
    </span>
  );
}

export function OwnerNotice({
  children,
  tone = "neutral",
  role,
}: {
  children: ReactNode;
  tone?: "danger" | "warning" | "success" | "neutral";
  role?: "alert" | "status";
}) {
  const classes = {
    danger: "border-red-200 bg-red-50 text-red-800",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    neutral: "border-slate-200 bg-slate-50 text-slate-600",
  }[tone];
  return (
    <div
      role={role}
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm font-medium",
        classes,
      )}
    >
      {tone === "danger" && <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
      <div>{children}</div>
    </div>
  );
}

export function OwnerLoading({ label = "Memuat data..." }: { label?: string }) {
  return (
    <OwnerPanel>
      <div
        role="status"
        className="flex min-h-48 flex-col items-center justify-center gap-3 text-slate-500"
      >
        <LoaderCircle className="size-6 animate-spin text-amber-500" />
        <p className="text-sm font-semibold">{label}</p>
      </div>
    </OwnerPanel>
  );
}

export function OwnerEmpty({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-6 text-center">
      <span className="mb-3 grid size-10 place-items-center rounded-xl bg-white text-slate-400 shadow-sm ring-1 ring-slate-200">
        <Inbox className="size-5" />
      </span>
      <p className="font-extrabold text-slate-800">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>
    </div>
  );
}

export function OwnerRetry({
  onClick,
  label = "Coba lagi",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button type="button" onClick={onClick} className={ownerSecondaryButtonClass}>
      <RefreshCw className="size-4" />
      {label}
    </button>
  );
}

export function OwnerPagination({
  page,
  hasNext,
  onPrevious,
  onNext,
  previousLabel = "Sebelumnya",
  nextLabel = "Berikutnya",
}: {
  page: number;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  previousLabel?: string;
  nextLabel?: string;
}) {
  return (
    <nav
      aria-label="Paginasi"
      className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <button
        type="button"
        disabled={page === 1}
        onClick={onPrevious}
        className={ownerSecondaryButtonClass}
      >
        {previousLabel}
      </button>
      <span className="text-center text-sm font-bold text-slate-600">Halaman {page}</span>
      <button
        type="button"
        disabled={!hasNext}
        onClick={onNext}
        className={ownerSecondaryButtonClass}
      >
        {nextLabel}
      </button>
    </nav>
  );
}

export function formatOwnerDate(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
