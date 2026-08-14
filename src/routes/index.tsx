import { useEffect, useRef, useState, useCallback } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Square } from "lucide-react";

import { Header } from "@/components/Header";
import { AuthGate } from "@/components/AuthGate";
import { getAuthStatus } from "@/lib/auth";
import { Footer } from "@/components/Footer";
import { SoundboardGrid } from "@/components/SoundboardGrid";
import {
  TABLE_COUNT,
  announcementAudioUrls,
  getBundledAudioUrl,
  getTableAudioUrl,
  createAudioPlaybackController,
  createPlaybackGeneration,
  getUnlockAudioUrl,
  runIfPlaybackCurrent,
  readyTables,
  unlockBundledAudio,
} from "@/lib/audio";
import { CrewIdentityDialog, type CrewIdentity } from "@/components/CrewIdentityDialog";
import { useRemoteCrew } from "@/hooks/use-remote-crew";
import { ANNOUNCEMENT_CATALOG, type AudioId } from "@/lib/remote-audio-domain";
import { announcementPlaybackId, announcementPlaybackStatus } from "@/lib/announcement-playback";
import {
  browserSessionStorage,
  readCrewSessionIdentity,
  removeCrewSessionIdentity,
  writeCrewSessionIdentity,
} from "@/lib/crew-session-identity";

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

function tableAudioId(tableNumber: number): AudioId {
  return `table:${tableNumber}`;
}

function announcementAudioId(announcementId: string): AudioId {
  return `announcement:${announcementId}` as AudioId;
}

function SoundboardPage() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioControllerRef = useRef<ReturnType<typeof createAudioPlaybackController> | null>(null);
  const activeAudioIdRef = useRef<number | AudioId | null>(null);
  const playbackGenerationRef = useRef(createPlaybackGeneration());
  const [playing, setPlaying] = useState<number | AudioId | null>(null);
  const [paused, setPaused] = useState<number | AudioId | null>(null);
  const [loading, setLoading] = useState<number | AudioId | null>(null);
  const [crewIdentity, setCrewIdentity] = useState<CrewIdentity | null>(null);
  const [identityHydrated, setIdentityHydrated] = useState(false);
  const [duplicateName, setDuplicateName] = useState(false);

  useEffect(() => {
    const identity = readCrewSessionIdentity(browserSessionStorage());
    setCrewIdentity(identity && { ...identity, audioReady: false });
    setIdentityHydrated(true);
  }, []);

  useEffect(() => {
    return () => {
      audioControllerRef.current?.stop();
      audioControllerRef.current = null;
      audioRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    playbackGenerationRef.current.next();
    audioControllerRef.current?.stop();
    activeAudioIdRef.current = null;
    setPlaying(null);
    setPaused(null);
    setLoading(null);
  }, []);

  const getAudioController = useCallback(() => {
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    audioControllerRef.current ??= createAudioPlaybackController(audio, (token) => {
      if (!playbackGenerationRef.current.isCurrent(token)) return;
      activeAudioIdRef.current = null;
      setPlaying(null);
      setPaused(null);
      setLoading(null);
    });
    return { audio, controller: audioControllerRef.current };
  }, []);

  const unlockAudio = useCallback(() => {
    const { audio } = getAudioController();
    return unlockBundledAudio(audio, getUnlockAudioUrl());
  }, [getAudioController]);

  const playRemoteAudio = useCallback(
    async (audioId: AudioId) => {
      const url = getBundledAudioUrl(audioId);
      if (!url) throw new Error("Audio tidak tersedia.");
      stop();
      const { controller } = getAudioController();
      const token = playbackGenerationRef.current.next();
      activeAudioIdRef.current = audioId;
      setLoading(audioId);
      try {
        await controller.play(url, token);
        if (playbackGenerationRef.current.isCurrent(token)) {
          setLoading(null);
          setPlaying(audioId);
        }
      } catch (error) {
        if (
          playbackGenerationRef.current.isCurrent(token) &&
          (error as Error).name !== "AbortError"
        )
          stop();
        throw error;
      }
    },
    [getAudioController, stop],
  );

  const remoteCrew = useRemoteCrew({
    registration: identityHydrated ? crewIdentity : null,
    playRemoteAudio,
  });

  useEffect(() => {
    if (!remoteCrew.duplicateName) return;
    setDuplicateName(true);
    removeCrewSessionIdentity(browserSessionStorage());
    setCrewIdentity(null);
  }, [remoteCrew.duplicateName]);

  const play = useCallback(
    async (id: number | AudioId, directUrl?: string | null) => {
      // Kunci sinkron mencegah dua klik cepat memulai audio secara bersamaan.
      if (activeAudioIdRef.current !== null) return;

      // Resume audio yang dijeda dari posisi terakhir.
      if (paused === id && audioRef.current) {
        const audio = audioRef.current;
        const token = playbackGenerationRef.current.next();
        activeAudioIdRef.current = id;
        setLoading(id);
        try {
          await audio.play();
          runIfPlaybackCurrent(playbackGenerationRef.current, token, () => {
            setLoading(null);
            setPaused(null);
            setPlaying(id);
          });
        } catch (error) {
          runIfPlaybackCurrent(playbackGenerationRef.current, token, () => {
            console.error(error);
            activeAudioIdRef.current = null;
            setLoading(null);
            setPaused(null);
          });
        }
        return;
      }

      const url = directUrl ?? (typeof id === "number" ? getTableAudioUrl(id) : null);
      if (!url) return;

      const token = playbackGenerationRef.current.next();
      activeAudioIdRef.current = id;
      setPaused(null);
      setLoading(id);
      const { controller } = getAudioController();
      try {
        await controller.play(url, token);
        if (!playbackGenerationRef.current.isCurrent(token)) return;
        setLoading(null);
        setPaused(null);
        setPlaying(id);
      } catch (error) {
        if (!playbackGenerationRef.current.isCurrent(token)) return;
        if ((error as Error).name !== "AbortError") console.error(error);
        activeAudioIdRef.current = null;
        setLoading(null);
        setPlaying(null);
        setPaused(null);
      }
    },
    [getAudioController, paused],
  );

  const toggleAnnouncement = useCallback(
    (id: AudioId, url?: string | null) => {
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

  const activeAudioId = playing ?? loading ?? paused;
  const activeAnnouncement =
    typeof activeAudioId === "string"
      ? ANNOUNCEMENT_CATALOG.find(({ id }) => announcementPlaybackId(id) === activeAudioId)
      : undefined;
  const activeAudioLabel = activeAnnouncement?.label ?? activeAudioId;

  return (
    <div className="min-h-screen bg-background pb-24">
      {identityHydrated && (
        <CrewIdentityDialog
          open={!crewIdentity}
          duplicateName={duplicateName}
          unlockAudio={unlockAudio}
          onContinue={(identity) => {
            setDuplicateName(false);
            const saved = writeCrewSessionIdentity(browserSessionStorage(), identity);
            setCrewIdentity({ ...(saved ?? identity), audioReady: identity.audioReady });
          }}
        />
      )}
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

        <SoundboardGrid
          availableAudioIds={
            new Set<AudioId>([
              ...[...readyTables].map(tableAudioId),
              ...ANNOUNCEMENT_CATALOG.filter(
                (announcement) => announcementAudioUrls[announcement.id],
              ).map((announcement) => announcementAudioId(announcement.id)),
            ])
          }
          drawerDisabled={false}
          announcementTriggerElevated={activeAudioId !== null}
          tableDisabled={() => activeAudioId !== null}
          announcementDisabled={(audioId) =>
            loading !== null || (activeAudioId !== null && activeAudioId !== audioId)
          }
          tableStatus={(tableNumber) => {
            if (playing === tableNumber) return "playing";
            if (loading === tableNumber) return "loading";
            return readyTables.has(tableNumber) ? "ready" : "empty";
          }}
          announcementStatus={(announcementId) =>
            announcementPlaybackStatus(
              announcementPlaybackId(announcementId),
              playing,
              loading,
              paused,
            )
          }
          onSelect={(audioId) => {
            if (audioId.startsWith("table:")) {
              void play(Number(audioId.slice("table:".length)));
              return;
            }
            const announcement = ANNOUNCEMENT_CATALOG.find(
              ({ id }) => announcementPlaybackId(id) === audioId,
            );
            if (announcement) toggleAnnouncement(audioId, announcementAudioUrls[announcement.id]);
          }}
        />

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

      {activeAudioId !== null && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
          <button
            onClick={stop}
            className="brutal-border brutal-shadow-lg brutal-press flex items-center gap-2 bg-destructive px-5 py-3 font-display uppercase text-destructive-foreground"
          >
            <Square className="h-4 w-4" fill="currentColor" strokeWidth={3} />
            Stop {typeof activeAudioId === "number" ? `Meja ${activeAudioId}` : activeAudioLabel}
          </button>
        </div>
      )}
    </div>
  );
}
