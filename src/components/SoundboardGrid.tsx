import { useEffect, useMemo, useState } from "react";
import { Megaphone, Pause, Play, X } from "lucide-react";

import { TableButton, type TableStatus } from "./TableButton";
import {
  ANNOUNCEMENT_CATALOG,
  TABLE_AUDIO_IDS,
  type AnnouncementCategory,
  type AnnouncementId,
  type AudioId,
} from "../lib/remote-audio-domain";

type AnnouncementStatus = "idle" | "loading" | "playing" | "paused";

type SoundboardGridProps = {
  availableAudioIds: ReadonlySet<AudioId>;
  drawerDisabled: boolean;
  tableDisabled: (audioId: AudioId) => boolean;
  announcementDisabled: (audioId: AudioId) => boolean;
  tableStatus: (tableNumber: number) => TableStatus;
  announcementStatus: (announcementId: AnnouncementId) => AnnouncementStatus;
  onSelect: (audioId: AudioId) => void;
};

const categories: readonly AnnouncementCategory[] = ["INFO", "LARANGAN"];

export function SoundboardGrid({
  availableAudioIds,
  drawerDisabled,
  tableDisabled,
  announcementDisabled,
  tableStatus,
  announcementStatus,
  onSelect,
}: SoundboardGridProps) {
  const [announcementPanelOpen, setAnnouncementPanelOpen] = useState(false);
  const announcementGroups = useMemo(
    () =>
      categories.map((category) => ({
        category,
        items: ANNOUNCEMENT_CATALOG.filter((announcement) => announcement.category === category),
      })),
    [],
  );

  useEffect(() => {
    if (!announcementPanelOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAnnouncementPanelOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [announcementPanelOpen]);

  return (
    <>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 sm:gap-3 md:grid-cols-8 lg:grid-cols-10">
        {TABLE_AUDIO_IDS.map((audioId) => {
          const tableNumber = Number(audioId.slice("table:".length));
          return (
            <TableButton
              key={audioId}
              tableNumber={tableNumber}
              status={tableStatus(tableNumber)}
              disabled={tableDisabled(audioId) || !availableAudioIds.has(audioId)}
              onClick={() => onSelect(audioId)}
            />
          );
        })}
      </div>

      {!announcementPanelOpen && (
        <button
          type="button"
          onClick={() => setAnnouncementPanelOpen(true)}
          aria-haspopup="dialog"
          aria-expanded="false"
          disabled={drawerDisabled}
          className="brutal-border brutal-shadow-lg brutal-press fixed bottom-4 right-4 z-30 flex items-center gap-2 bg-primary px-4 py-3 font-display text-sm uppercase text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40 sm:px-5 sm:text-base"
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
                    {group.items.map((announcement) => {
                      const audioId = `announcement:${announcement.id}` as AudioId;
                      const status = announcementStatus(announcement.id);
                      return (
                        <button
                          key={announcement.id}
                          type="button"
                          onClick={() => onSelect(audioId)}
                          disabled={
                            announcementDisabled(audioId) || !availableAudioIds.has(audioId)
                          }
                          aria-label={`${status === "playing" ? "Jeda" : "Putar"} ${announcement.label.toLowerCase()}`}
                          className={`brutal-border brutal-press flex w-full items-center justify-between gap-3 px-4 py-3 text-left font-display text-sm uppercase leading-tight disabled:cursor-not-allowed disabled:opacity-40 sm:text-base ${
                            group.category === "INFO"
                              ? "bg-accent"
                              : "bg-destructive text-destructive-foreground"
                          }`}
                        >
                          <span>{announcement.label}</span>
                          {status === "playing" ? (
                            <Pause className="size-5 shrink-0 fill-current" aria-hidden="true" />
                          ) : (
                            <Play className="size-5 shrink-0 fill-current" aria-hidden="true" />
                          )}
                        </button>
                      );
                    })}
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
    </>
  );
}
