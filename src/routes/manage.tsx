import { useCallback, useRef } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Header } from "@/components/Header";
import { AuthGate } from "@/components/AuthGate";
import { getAuthStatus } from "@/lib/auth";
import { Footer } from "@/components/Footer";
import { BulkUploader } from "@/components/BulkUploader";
import { TableList } from "@/components/TableList";
import { TABLE_COUNT, getTableAudioUrl, listReadyTables } from "@/lib/audio-store";

export const Route = createFileRoute("/manage")({
  loader: () => getAuthStatus(),
  head: () => ({
    meta: [
      { title: "Kelola Audio — Table Talker" },
      {
        name: "description",
        content: "Upload dan atur file panggilan MP3 untuk 70 meja restoran.",
      },
      { property: "og:title", content: "Kelola Audio — Table Talker" },
      { property: "og:url", content: "/manage" },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "canonical", href: "/manage" }],
  }),
  component: ManageRoute,
});

function ManageRoute() {
  const auth = Route.useLoaderData();
  const router = useRouter();
  if (!auth.manage) {
    return <AuthGate role="manage" onSuccess={() => router.invalidate()} />;
  }
  return <ManagePage />;
}

function ManagePage() {
  const qc = useQueryClient();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const readyQuery = useQuery({
    queryKey: ["ready-tables"],
    queryFn: listReadyTables,
    refetchOnWindowFocus: false,
  });

  const readyTables = readyQuery.data ?? new Set<number>();

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["ready-tables"] });
    qc.invalidateQueries({ queryKey: ["signed-urls"] });
  }, [qc]);

  const preview = useCallback(async (tableNumber: number) => {
    const url = await getTableAudioUrl(tableNumber);
    if (!url) return;
    if (audioRef.current) audioRef.current.pause();
    const audio = new Audio(url);
    audioRef.current = audio;
    void audio.play().catch((err) => console.error(err));
  }, []);

  return (
    <div className="min-h-screen bg-background pb-16">
      <Header readyCount={readyTables.size} totalCount={TABLE_COUNT} />

      <main className="mx-auto max-w-4xl space-y-6 px-3 py-5 sm:px-6 sm:py-8">
        <div>
          <h1 className="font-display text-xl uppercase leading-tight sm:text-2xl">
            Kelola Audio Meja
          </h1>
          <p className="text-xs text-muted-foreground">
            Upload file MP3 panggilan untuk tiap meja. Nama file harus{" "}
            <span className="font-mono font-bold text-foreground">{"<nomor-meja>.mp3"}</span>.
          </p>
        </div>

        <BulkUploader onUploaded={refresh} />

        <TableList readyTables={readyTables} onChanged={refresh} onPreview={preview} />

        <div className="brutal-border bg-card p-4 text-xs">
          <div className="font-display uppercase">Tips</div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            <li>
              Contoh kalimat:{" "}
              <span className="italic">"Meja Nomor 10, Silakan Mengambil Pesanan"</span>.
            </li>
            <li>File yang di-upload akan menimpa audio meja lama secara otomatis.</li>
            <li>Audio disimpan permanen di Vercel Blob dan siap dipakai setelah upload selesai.</li>
          </ul>
        </div>
      </main>

      <Footer />
    </div>
  );
}
