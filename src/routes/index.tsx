import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Megaphone, Pause, Play, Square } from "lucide-react";

import { Header } from "@/components/Header";
import { AuthGate } from "@/components/AuthGate";
import { getAuthStatus } from "@/lib/auth";
import { Footer } from "@/components/Footer";
import { TableButton, type TableStatus } from "@/components/TableButton";
import { TABLE_COUNT, announcementAudioUrls, getTableAudioUrl, readyTables } from "@/lib/audio";

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
    return <AuthGate onSuccess={() => router.invalidate()} />;
  }
  return <SoundboardPage />;
}

function SoundboardPage() {
  const tables = useMemo(() => Array.from({ length: TABLE_COUNT }, (_, i) => i + 1), []);

  // Audio ikut di-bundle bersama deployment: daftar & URL-nya sudah tersedia
  // sejak render pertama, tanpa fetch, tanpa loading, tanpa panggilan API.
  const announcements = announcementAudioUrls;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<number | string | null>(null);
  const [paused, setPaused] = useState<number | string | null>(null);
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
    setPaused(null);
    setLoading(null);
  }, []);

  const play = useCallback(
    async (id: number | string, directUrl?: string | null) => {
      // Resume audio yang dijeda dari posisi terakhir.
      if (paused === id && audioRef.current) {
        setLoading(id);
        try {
          await audioRef.current.play();
        } catch (err) {
          console.error(err);
          setLoading(null);
          setPaused(null);
        }
        return;
      }

      const url = directUrl ?? (typeof id === "number" ? getTableAudioUrl(id) : null);
      if (!url) return;

      // Stop audio lain sebelum memulai yang baru.
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }

      setPaused(null);
      setLoading(id);
      const audio = new Audio(url);
      audioRef.current = audio;

      audio.addEventListener("playing", () => {
        setLoading(null);
        setPaused(null);
        setPlaying(id);
      });
      audio.addEventListener("ended", () => {
        setPlaying(null);
        setPaused(null);
        audioRef.current = null;
      });
      audio.addEventListener("error", () => {
        setLoading(null);
        setPlaying(null);
        setPaused(null);
        audioRef.current = null;
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
    [paused],
  );

  const toggleAnnouncement = useCallback(
    (id: string, url?: string | null) => {
      if (playing === id && audioRef.current) {
        audioRef.current.pause();
        setPlaying(null);
        setPaused(id);
        setLoading(null);
        return;
      }
      void play(id, url);
    },
    [play, playing],
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
              onClick={() => toggleAnnouncement("Himbauan", announcements.seating)}
              disabled={!announcements.seating}
              aria-label={playing === "Himbauan" ? "Jeda himbauan" : "Putar himbauan"}
              className="brutal-border brutal-press flex w-full items-center justify-between gap-3 bg-accent px-4 py-3 text-left font-display text-sm uppercase leading-tight sm:text-base"
            >
              <span>
                <span className="mr-2 inline-block bg-primary px-2 py-0.5 text-[10px] text-primary-foreground">
                  Info
                </span>
                Himbauan Duduk Sesuai Nomor Meja
              </span>
              {playing === "Himbauan" ? (
                <Pause className="size-5 shrink-0 fill-current" aria-hidden="true" />
              ) : (
                <Play className="size-5 shrink-0 fill-current" aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              onClick={() =>
                toggleAnnouncement("Larangan makanan luar", announcements["outside-food"])
              }
              disabled={!announcements["outside-food"]}
              aria-label={
                playing === "Larangan makanan luar"
                  ? "Jeda larangan makanan luar"
                  : "Putar larangan makanan luar"
              }
              className="brutal-border brutal-press flex w-full items-center justify-between gap-3 bg-destructive px-4 py-3 text-left font-display text-sm uppercase leading-tight text-destructive-foreground sm:text-base"
            >
              <span>
                <span className="mr-2 inline-block bg-primary px-2 py-0.5 text-[10px] text-primary-foreground">
                  Larangan
                </span>
                Dilarang Bawa Makanan Dari Luar
              </span>
              {playing === "Larangan makanan luar" ? (
                <Pause className="size-5 shrink-0 fill-current" aria-hidden="true" />
              ) : (
                <Play className="size-5 shrink-0 fill-current" aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              onClick={() => toggleAnnouncement("Larangan merokok", announcements["no-smoking"])}
              disabled={!announcements["no-smoking"]}
              aria-label={
                playing === "Larangan merokok" ? "Jeda larangan merokok" : "Putar larangan merokok"
              }
              className="brutal-border brutal-press flex w-full items-center justify-between gap-3 bg-destructive px-4 py-3 text-left font-display text-sm uppercase leading-tight text-destructive-foreground sm:text-base"
            >
              <span>
                <span className="mr-2 inline-block bg-primary px-2 py-0.5 text-[10px] text-primary-foreground">
                  Larangan
                </span>
                Dilarang Merokok di Area Lobby
              </span>
              {playing === "Larangan merokok" ? (
                <Pause className="size-5 shrink-0 fill-current" aria-hidden="true" />
              ) : (
                <Play className="size-5 shrink-0 fill-current" aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              onClick={() =>
                toggleAnnouncement("Larangan gabungkan meja", announcements["larangan-gabung-meja"])
              }
              disabled={!announcements["larangan-gabung-meja"]}
              aria-label={
                playing === "Larangan gabungkan meja"
                  ? "Jeda larangan gabungkan meja"
                  : "Putar larangan gabungkan meja"
              }
              className="brutal-border brutal-press flex w-full items-center justify-between gap-3 bg-destructive px-4 py-3 text-left font-display text-sm uppercase leading-tight text-destructive-foreground sm:text-base"
            >
              <span>
                <span className="mr-2 inline-block bg-primary px-2 py-0.5 text-[10px] text-primary-foreground">
                  Larangan
                </span>
                Dilarang Gabungkan Meja
              </span>
              {playing === "Larangan gabungkan meja" ? (
                <Pause className="size-5 shrink-0 fill-current" aria-hidden="true" />
              ) : (
                <Play className="size-5 shrink-0 fill-current" aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              onClick={() => toggleAnnouncement("Info jam buka", announcements["jam-buka-resto"])}
              disabled={!announcements["jam-buka-resto"]}
              aria-label={
                playing === "Info jam buka" ? "Jeda info jam buka" : "Putar info jam buka"
              }
              className="brutal-border brutal-press flex w-full items-center justify-between gap-3 bg-accent px-4 py-3 text-left font-display text-sm uppercase leading-tight sm:text-base"
            >
              <span>
                <span className="mr-2 inline-block bg-primary px-2 py-0.5 text-[10px] text-primary-foreground">
                  Info
                </span>
                Informasi Jam Buka Tutup Resto
              </span>
              {playing === "Info jam buka" ? (
                <Pause className="size-5 shrink-0 fill-current" aria-hidden="true" />
              ) : (
                <Play className="size-5 shrink-0 fill-current" aria-hidden="true" />
              )}
            </button>
          </div>
        </section>

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

        {readyTables.size === 0 && (
          <div className="brutal-border brutal-shadow mt-6 bg-card p-6 text-center">
            <p className="font-display uppercase">Belum ada audio</p>
            <p className="mt-1 text-xs text-muted-foreground">
              File audio meja belum ada di dalam aplikasi. Tambahkan{" "}
              <span className="font-mono font-bold text-foreground">1.mp3 – 70.mp3</span> di{" "}
              <span className="font-mono font-bold text-foreground">src/assets/audio/tables/</span>{" "}
              lalu deploy ulang.
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
