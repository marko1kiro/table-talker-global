import { loadRestoPick, resolveRestoPick, saveRestoPick } from "@/lib/am-resto-pick";

export function AmRestoTabs({
  menu,
  restos,
  value,
  onChange,
}: {
  menu: string;
  restos: { id: string; name: string }[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const stored = loadRestoPick(menu);
  const active = resolveRestoPick(value ?? stored, restos);
  if (restos.length <= 1) return null;
  return (
    <div role="group" aria-label="Pilih resto" className="flex flex-wrap gap-2">
      {restos.map((r) => (
        <button
          key={r.id}
          aria-pressed={active === r.id}
          type="button"
          onClick={() => {
            saveRestoPick(menu, r.id);
            onChange(r.id);
          }}
          className={
            active === r.id
              ? "rounded-full bg-slate-900 px-3.5 py-1.5 text-xs font-bold text-white"
              : "rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-500"
          }
        >
          {r.name}
        </button>
      ))}
    </div>
  );
}
