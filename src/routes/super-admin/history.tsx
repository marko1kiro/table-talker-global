import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/super-admin/history")({ component: Placeholder });
function Placeholder() {
  return (
    <section className="brutal-border bg-card p-6">
      <h1 className="font-display text-2xl uppercase">Riwayat</h1>
      <p className="mt-3">Belum tersedia.</p>
    </section>
  );
}
