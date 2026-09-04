export function RoleEmblem({ label }: { label: string }) {
  return (
    <span className="rounded-md bg-brand-500 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
      {label}
    </span>
  );
}
