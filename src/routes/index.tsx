import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Megaphone, Play, Square } from "lucide-react";

import { Header } from "@/components/Header";
import { AuthGate } from "@/components/AuthGate";
import { getAuthStatus } from "@/lib/auth";
import { Footer } from "@/components/Footer";
import { TableButton, type TableStatus } from "@/components/TableButton";
import {
  TABLE_COUNT,
  getAnnouncementAudioUrls,
  getTableAudioUrls,
  listReadyTables,
} from "@/lib/audio-store";

export const Route = createFileRoute("/")({
  loader: () => getAuthStatus(),
  head: () => ({
    meta: [
      { title: "Table Talker — Panggilan Meja" },
      {
        name: "description",
        content:
          "Tap nomor meja untuk memutar panggilan pesanan otomatis. Mie Gacoan Kampung Bulu.",
      },
      { property: "og:title", content: "Table Talker — Panggilan Meja" },
      { property: "og:url", content: "/" },
    ],
    links: [{ rel: "canonical", href: "/" }],
  }),
  component: SoundboardRoute,
});

function SoundboardRoute() {
  const auth = Route.useLoaderData();
  const router = useRouter();
  if (!auth.dashboard) {
    return <AuthGate role="dashboard" onSuccess={() => router.invalidate()} />;
  }
  return <SoundboardPage />;
}

function SoundboardPage() {
  const tables = useMemo(() => Array.from({ length: TABLE_COUNT }, (_, i) => i + 1), []);

  const readyQuery = useQuery({
    queryKey: ["ready-tables"],
    queryFn: listReadyTables,
    refetchOnWindowFocus: false,
  });

  const readyTables = readyQuery.data ?? new Set<number>();

  const urlsQuery = useQuery({
    queryKey: ["signed-urls", Array.from(readyTables).sort().join(",")],
    queryFn: () => getTableAudioUrls(Array.from(readyTables)),
    enabled: readyTables.size > 0,
    staleTime: 1000 * 60 * 60 * 6, // 6h
    refetchOnWindowFocus: false,
  });

  const urls = useMemo(() => urlsQuery.data ?? new Map<number, string>(), [urlsQuery.data]);

  const announcementQuery = useQuery({
    queryKey: ["announcement-urls"],
    queryFn: getAnnouncementAudioUrls,
    staleTime: 1000 * 60 * 60 * 6,
    refetchOnWindowFocus: false,
  });
  const announcements = announcementQuery.data;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<number | string | null>(null);
  const [loading, setLoading] = useState<number | string | null>(null);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setPlaying(null);
    setLoading(null);
  }, []);

  const play = useCallback(
    async (id: number | string, directUrl?: string | null) => {
      const url = directUrl ?? (typeof id === "number" ? urls.get(id) : null);
      if (!url) return;

      // Stop any current playback
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }

      setLoading(id);
      const audio = new Audio(url);
      audioRef.current = audio;

      audio.addEventListener("playing", () => {
        setLoading(null);
        setPlaying(id);
      });
      audio.addEventListener("ended", () => {
        setPlaying(null);
      });
      audio.addEventListener("error", () => {
        setLoading(null);
        setPlaying(null);
        console.error("Audio playback error", id);
      });

      try {
        await audio.play();
      } catch (err) {
        console.error(err);
        setLoading(null);
        setPlaying(null);
      }
    },
    [urls],
  );

  return (
    <div className="min-h-screen bg-background pb-24">
      <Header readyCount={readyTables.size} totalCount={TABLE_COUNT} />

      <main className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-xl uppercase leading-tight sm:text-2xl">
              Pilih Nomor Meja
            </h1>
            <p className="text-xs text-muted-foreground">
              Tap tombol untuk memanggil pelanggan mengambil pesanan.
            </p>
          </div>
        </div>

        <section className="brutal-border brutal-shadow mb-5 bg-card p-3 sm:p-4">
          <div className="mb-3 flex items-start gap-2.5 border-b-2 border-foreground pb-3">
            <div className="flex size-9 shrink-0 items-center justify-center bg-primary text-primary-foreground">
              <Megaphone className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-display text-base uppercase leading-tight sm:text-lg">
                Tombol Pengumuman
              </h2>
              <p className="text-xs text-muted-foreground sm:text-sm">
                Tekan salah satu tombol di bawah untuk memutar pengumuman.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => void play("Himbauan", announcements?.seating)}
              disabled={!announcements?.seating}
              className="brutal-border brutal-press flex w-full items-center justify-between gap-3 bg-accent px-4 py-3 text-left font-display text-sm uppercase leading-tight sm:text-base"
            >
              <span>
                <span className="mr-2 inline-block bg-primary px-2 py-0.5 text-[10px] text-primary-foreground">
                  Info
                </span>
                Himbauan Duduk Sesuai Nomor Meja
              </span>
              <Play className="size-5 shrink-0 fill-current" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => void play("Larangan makanan luar", announcements?.["outside-food"])}
              disabled={!announcements?.["outside-food"]}
              className="brutal-border brutal-press flex w-full items-center justify-between gap-3 bg-destructive px-4 py-3 text-left font-display text-sm uppercase leading-tight text-destructive-foreground sm:text-base"
            >
              <span>
                <span className="mr-2 inline-block bg-primary px-2 py-0.5 text-[10px] text-primary-foreground">
                  Larangan
                </span>
                Dilarang Bawa Makanan Dari Luar
              </span>
              <Play className="size-5 shrink-0 fill-current" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => void play("Larangan merokok", announcements?.["no-smoking"])}
              disabled={!announcements?.["no-smoking"]}
              className="brutal-border brutal-press flex w-full items-center justify-between gap-3 bg-destructive px-4 py-3 text-left font-display text-sm uppercase leading-tight text-destructive-foreground sm:text-base"
            >
              <span>
                <span className="mr-2 inline-block bg-primary px-2 py-0.5 text-[10px] text-primary-foreground">
                  Larangan
                </span>
                Dilarang Merokok di Area Lobby
              </span>
              <Play className="size-5 shrink-0 fill-current" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => void play("Info jam buka", announcements?.["jam-buka-resto"])}
              disabled={!announcements?.["jam-buka-resto"]}
              className="brutal-border brutal-press flex w-full items-center justify-between gap-3 bg-accent px-4 py-3 text-left font-display text-sm uppercase leading-tight sm:text-base"
            >
              <span>
                <span className="mr-2 inline-block bg-primary px-2 py-0.5 text-[10px] text-primary-foreground">
                  Info
                </span>
                Informasi Jam Buka Tutup Resto
              </span>
              <Play className="size-5 shrink-0 fill-current" aria-hidden="true" />
            </button>
          </div>
        </section>

        {readyQuery.isLoading ? (
          <div className="brutal-border brutal-shadow bg-card p-6 text-center font-display uppercase">
            Memuat data meja…
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 sm:gap-3 md:grid-cols-8 lg:grid-cols-10">
            {tables.map((n) => {
              let status: TableStatus = "empty";
              if (playing === n) status = "playing";
              else if (loading === n) status = "loading";
              else if (readyTables.has(n)) status = "ready";
              return (
                <TableButton key={n} tableNumber={n} status={status} onClick={() => void play(n)} />
              );
            })}
          </div>
        )}

        {readyTables.size === 0 && !readyQuery.isLoading && (
          <div className="brutal-border brutal-shadow mt-6 bg-card p-6 text-center">
            <p className="font-display uppercase">Belum ada audio</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Buka menu <span className="font-bold uppercase">Kelola</span> untuk upload file
              panggilan (1.mp3 – 70.mp3).
            </p>
          </div>
        )}
      </main>

      <Footer />

      {playing !== null && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
          <button
            onClick={stop}
            className="brutal-border brutal-shadow-lg brutal-press flex items-center gap-2 bg-destructive px-5 py-3 font-display uppercase text-destructive-foreground"
          >
            <Square className="h-4 w-4" fill="currentColor" strokeWidth={3} />
            Stop {typeof playing === "number" ? `Meja ${playing}` : playing}
          </button>
        </div>
      )}
    </div>
  );
}
