import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Megaphone, Pause, Play, Square, X } from "lucide-react";

import { Header } from "@/components/Header";
import { AuthGate } from "@/components/AuthGate";
import { getAuthStatus } from "@/lib/auth";
import { Footer } from "@/components/Footer";
import { TableButton, type TableStatus } from "@/components/TableButton";
import {
  TABLE_COUNT,
  announcementAudioUrls,
  getBundledAudioUrl,
  getTableAudioUrl,
  createAudioPlaybackController,
  getUnlockAudioUrl,
  readyTables,
  unlockBundledAudio,
} from "@/lib/audio";
import { CrewIdentityDialog, type CrewIdentity } from "@/components/CrewIdentityDialog";
import { useRemoteCrew } from "@/hooks/use-remote-crew";
import type { AudioId } from "@/lib/remote-audio-domain";

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
  const audioControllerRef = useRef<ReturnType<typeof createAudioPlaybackController> | null>(null);
  const activeAudioIdRef = useRef<number | string | null>(null);
  const [playing, setPlaying] = useState<number | string | null>(null);
  const [paused, setPaused] = useState<number | string | null>(null);
  const [loading, setLoading] = useState<number | string | null>(null);
  const [announcementPanelOpen, setAnnouncementPanelOpen] = useState(false);
  const [crewIdentity, setCrewIdentity] = useState<CrewIdentity | null>(null);
  const [duplicateName, setDuplicateName] = useState(false);

  useEffect(() => {
    return () => {
      audioControllerRef.current?.stop();
      audioControllerRef.current = null;
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!announcementPanelOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAnnouncementPanelOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [announcementPanelOpen]);

  const stop = useCallback(() => {
    audioControllerRef.current?.stop();
    activeAudioIdRef.current = null;
    setPlaying(null);
    setPaused(null);
    setLoading(null);
  }, []);

  const unlockAudio = useCallback(() => {
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    audioControllerRef.current ??= createAudioPlaybackController(audio);
    return unlockBundledAudio(audio, getUnlockAudioUrl());
  }, []);

  const playRemoteAudio = useCallback(
    async (audioId: AudioId) => {
      const url = getBundledAudioUrl(audioId);
      if (!url) throw new Error("Audio tidak tersedia.");
      stop();
      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;
      const controller = (audioControllerRef.current ??= createAudioPlaybackController(audio));
      activeAudioIdRef.current = audioId;
      setLoading(audioId);
      audio.addEventListener("ended", stop, { once: true });
      try {
        await controller.play(url);
        setLoading(null);
        setPlaying(audioId);
      } catch (error) {
        if ((error as Error).name !== "AbortError") stop();
        throw error;
      }
    },
    [stop],
  );

  const remoteCrew = useRemoteCrew({ registration: crewIdentity, playRemoteAudio });

  useEffect(() => {
    if (!remoteCrew.duplicateName) return;
    setDuplicateName(true);
    setCrewIdentity(null);
  }, [remoteCrew.duplicateName]);

  const play = useCallback(
    async (id: number | string, directUrl?: string | null) => {
      // Kunci sinkron mencegah dua klik cepat memulai audio secara bersamaan.
      if (activeAudioIdRef.current !== null) return;

      // Resume audio yang dijeda dari posisi terakhir.
      if (paused === id && audioRef.current) {
        const audio = audioRef.current;
        activeAudioIdRef.current = id;
        setLoading(id);
        try {
          await audio.play();
        } catch (err) {
          console.error(err);
          if (audioRef.current === audio) {
            activeAudioIdRef.current = null;
            setLoading(null);
            setPaused(null);
          }
        }
        return;
      }

      const url = directUrl ?? (typeof id === "number" ? getTableAudioUrl(id) : null);
      if (!url) return;

      activeAudioIdRef.current = id;
      setPaused(null);
      setLoading(id);
      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;
      audioControllerRef.current ??= createAudioPlaybackController(audio);
      audio.src = url;

      audio.addEventListener("playing", () => {
        if (audioRef.current !== audio) return;
        setLoading(null);
        setPaused(null);
        setPlaying(id);
      });
      audio.addEventListener("ended", () => {
        if (audioRef.current !== audio) return;
        activeAudioIdRef.current = null;
        setPlaying(null);
        setPaused(null);
        audioRef.current = null;
      });
      audio.addEventListener("error", () => {
        if (audioRef.current !== audio) return;
        activeAudioIdRef.current = null;
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
        if (audioRef.current === audio) {
          activeAudioIdRef.current = null;
          audioRef.current = null;
          setLoading(null);
          setPlaying(null);
        }
      }
    },
    [paused],
  );

  const toggleAnnouncement = useCallback(
    (id: string, url?: string | null) => {
      if (playing === id && audioRef.current) {
        audioRef.current.pause();
        activeAudioIdRef.current = null;
        setPlaying(null);
        setPaused(id);
        setLoading(null);
        return;
      }
      void play(id, url);
    },
    [play, playing],
  );

  const announcementGroups = [
    {
      category: "INFO",
      items: [
        {
          id: "Himbauan duduk sesuai nomor meja",
          title: "Himbauan Duduk Sesuai Nomor Meja",
          url: announcements.seating,
        },
        {
          id: "Himbauan barang bawaan pelanggan",
          title: "Himbauan Barang Bawaan Pelanggan",
          url: announcements["himbauan-barang-bawaan-pelanggan"],
        },
        {
          id: "Info jam buka",
          title: "Informasi Jam Buka Tutup Resto",
          url: announcements["jam-buka-resto"],
        },
      ],
    },
    {
      category: "LARANGAN",
      items: [
        {
          id: "Larangan makanan luar",
          title: "Dilarang Bawa Makanan Dari Luar",
          url: announcements["outside-food"],
        },
        {
          id: "Larangan merokok",
          title: "Dilarang Merokok di Area Lobby",
          url: announcements["no-smoking"],
        },
        {
          id: "Larangan gabungkan meja",
          title: "Dilarang Gabungkan Meja",
          url: announcements["larangan-gabung-meja"],
        },
      ],
    },
  ] as const;

  const activeAudioId = playing ?? loading ?? paused;

  return (
    <div className="min-h-screen bg-background pb-24">
      <CrewIdentityDialog
        open={!crewIdentity}
        duplicateName={duplicateName}
        unlockAudio={unlockAudio}
        onContinue={(identity) => {
          setDuplicateName(false);
          setCrewIdentity(identity);
        }}
      />
      {(remoteCrew.needsAudioRecovery || !crewIdentity?.audioReady) && crewIdentity && (
        <div className="fixed left-1/2 top-4 z-[60] -translate-x-1/2 brutal-border bg-card p-3 text-center">
          <p className="mb-2 text-sm">Remote audio diblokir browser.</p>
          <button
            type="button"
            className="brutal-border brutal-press bg-accent px-3 py-2 font-display"
            onClick={() => {
              void unlockAudio().then((audioReady) => {
                setCrewIdentity({ ...crewIdentity, audioReady });
                remoteCrew.retryAudioUnlock();
              });
            }}
          >
            Aktifkan Suara
          </button>
        </div>
      )}
      {remoteCrew.offline && crewIdentity && (
        <p className="mx-auto max-w-6xl px-3 pt-3 text-center text-sm text-muted-foreground">
          Remote control tidak tersedia. Soundboard tetap bisa dipakai.
        </p>
      )}
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

        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 sm:gap-3 md:grid-cols-8 lg:grid-cols-10">
          {tables.map((n) => {
            let status: TableStatus = "empty";
            if (playing === n) status = "playing";
            else if (loading === n) status = "loading";
            else if (readyTables.has(n)) status = "ready";
            return (
              <TableButton
                key={n}
                tableNumber={n}
                status={status}
                onClick={() => void play(n)}
                disabled={activeAudioId !== null}
              />
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

      {!announcementPanelOpen && (
        <button
          type="button"
          onClick={() => setAnnouncementPanelOpen(true)}
          aria-haspopup="dialog"
          aria-expanded="false"
          className={`brutal-border brutal-shadow-lg brutal-press fixed right-4 z-30 flex items-center gap-2 bg-primary px-4 py-3 font-display text-sm uppercase text-primary-foreground sm:px-5 sm:text-base ${
            activeAudioId !== null ? "bottom-24" : "bottom-4"
          }`}
        >
          <Megaphone className="size-5 shrink-0" aria-hidden="true" />
          Lihat Pengumuman
        </button>
      )}

      {announcementPanelOpen && (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-foreground/60"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setAnnouncementPanelOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="announcement-panel-title"
            className="h-full w-full overflow-y-auto border-l-4 border-foreground bg-background p-4 shadow-[-8px_0_0_0_hsl(var(--foreground))] sm:max-w-xl sm:p-6"
          >
            <div className="sticky top-0 z-10 -mx-4 -mt-4 mb-5 flex items-start justify-between gap-3 border-b-4 border-foreground bg-background p-4 sm:-mx-6 sm:-mt-6 sm:p-6">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center bg-primary text-primary-foreground">
                  <Megaphone className="size-5" aria-hidden="true" />
                </div>
                <div>
                  <h2
                    id="announcement-panel-title"
                    className="font-display text-lg uppercase leading-tight sm:text-xl"
                  >
                    Tombol Pengumuman
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
                    Pilih pengumuman yang ingin diputar.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAnnouncementPanelOpen(false)}
                aria-label="Tutup panel pengumuman"
                className="brutal-border brutal-press flex size-10 shrink-0 items-center justify-center bg-card"
              >
                <X className="size-5" strokeWidth={3} aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-5">
              {announcementGroups.map((group) => (
                <div
                  key={group.category}
                  aria-labelledby={`announcement-category-${group.category.toLowerCase()}`}
                >
                  <div className="mb-3 flex items-center gap-2">
                    <h3
                      id={`announcement-category-${group.category.toLowerCase()}`}
                      className={`border-2 border-foreground px-2.5 py-1 font-display text-xs uppercase ${
                        group.category === "INFO"
                          ? "bg-primary text-primary-foreground"
                          : "bg-destructive text-destructive-foreground"
                      }`}
                    >
                      {group.category}
                    </h3>
                    <span className="text-xs font-bold text-muted-foreground">
                      {group.items.length} pengumuman
                    </span>
                    <div className="h-0.5 flex-1 bg-foreground" aria-hidden="true" />
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {group.items.map((announcement) => (
                      <button
                        key={announcement.id}
                        type="button"
                        onClick={() => toggleAnnouncement(announcement.id, announcement.url)}
                        disabled={
                          !announcement.url ||
                          loading !== null ||
                          (activeAudioId !== null && activeAudioId !== announcement.id)
                        }
                        aria-label={`${
                          playing === announcement.id ? "Jeda" : "Putar"
                        } ${announcement.title.toLowerCase()}`}
                        className={`brutal-border brutal-press flex w-full items-center justify-between gap-3 px-4 py-3 text-left font-display text-sm uppercase leading-tight disabled:cursor-not-allowed disabled:opacity-40 sm:text-base ${
                          group.category === "INFO"
                            ? "bg-accent"
                            : "bg-destructive text-destructive-foreground"
                        }`}
                      >
                        <span>{announcement.title}</span>
                        {playing === announcement.id ? (
                          <Pause className="size-5 shrink-0 fill-current" aria-hidden="true" />
                        ) : (
                          <Play className="size-5 shrink-0 fill-current" aria-hidden="true" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <footer className="mt-8 border-t-2 border-foreground px-2 pb-2 pt-4 text-center text-xs leading-relaxed text-muted-foreground sm:text-sm">
              <p className="italic">
                - Gak ada orang yang terlahir bodoh, mereka hanya{" "}
                <strong className="font-bold text-foreground">Malas Belajar</strong>. -
              </p>
              <p className="mt-1 font-semibold text-foreground">Semoga Bermanfaat ya gaes!</p>
              <p className="mt-1 text-[11px] sm:text-xs">
                By <strong className="font-bold text-foreground">Bang Marko Ganteng</strong>
              </p>
            </footer>
          </section>
        </div>
      )}

      {activeAudioId !== null && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
          <button
            onClick={stop}
            className="brutal-border brutal-shadow-lg brutal-press flex items-center gap-2 bg-destructive px-5 py-3 font-display uppercase text-destructive-foreground"
          >
            <Square className="h-4 w-4" fill="currentColor" strokeWidth={3} />
            Stop {typeof activeAudioId === "number" ? `Meja ${activeAudioId}` : activeAudioId}
          </button>
        </div>
      )}
    </div>
  );
}
