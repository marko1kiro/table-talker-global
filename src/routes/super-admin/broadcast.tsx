import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/super-admin/broadcast")({ component: Placeholder });
function Placeholder() {
  return (
    <section className="brutal-border bg-card p-6">
      <h1 className="font-display text-2xl uppercase">Broadcast</h1>
      <p className="mt-3">Belum tersedia.</p>
    </section>
  );
}
