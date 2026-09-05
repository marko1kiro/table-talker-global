import { useEffect, useMemo, useState } from "react";
import { Megaphone, Pause, Play, X } from "lucide-react";

import { TableButton, type TableStatus } from "./TableButton";
import {
  ANNOUNCEMENT_CATALOG,
  TABLE_AUDIO_IDS,
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
      ANNOUNCEMENT_CATALOG.reduce<
        Array<{
          category: (typeof ANNOUNCEMENT_CATALOG)[number]["category"];
          items: Array<(typeof ANNOUNCEMENT_CATALOG)[number]>;
        }>
      >((groups, announcement) => {
        const group = groups.find(({ category }) => category === announcement.category);
        if (group) group.items.push(announcement);
        else groups.push({ category: announcement.category, items: [announcement] });
        return groups;
      }, []),
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
          className="fixed bottom-4 right-4 z-30 flex items-center gap-2 rounded-full bg-brand-500 px-4 py-3 text-sm font-bold uppercase text-white shadow-theme-md transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 sm:px-5 sm:text-base"
        >
          <Megaphone className="size-5 shrink-0" aria-hidden="true" />
          Lihat Pengumuman
        </button>
      )}

      {announcementPanelOpen && (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-black/50"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setAnnouncementPanelOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="announcement-panel-title"
            className="h-full w-full overflow-y-auto border-l border-ta-gray-200 bg-white p-4 sm:max-w-xl sm:p-6 dark:border-ta-gray-700 dark:bg-ta-gray-800"
          >
            <div className="sticky top-0 z-10 -mx-4 -mt-4 mb-5 flex items-start justify-between gap-3 border-b border-ta-gray-200 bg-white p-4 sm:-mx-6 sm:-mt-6 sm:p-6 dark:border-ta-gray-700 dark:bg-ta-gray-800">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-white">
                  <Megaphone className="size-5" aria-hidden="true" />
                </div>
                <div>
                  <h2
                    id="announcement-panel-title"
                    className="text-lg font-bold leading-tight sm:text-xl"
                  >
                    Tombol Pengumuman
                  </h2>
                  <p className="mt-1 text-xs text-ta-gray-500 sm:text-sm dark:text-ta-gray-400">
                    Pilih pengumuman yang ingin diputar.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAnnouncementPanelOpen(false)}
                aria-label="Tutup panel pengumuman"
                className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-ta-gray-200 text-ta-gray-600 transition hover:bg-ta-gray-100 dark:border-ta-gray-700 dark:text-ta-gray-300 dark:hover:bg-ta-gray-700"
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
                      className={`rounded-md px-2.5 py-1 text-xs font-bold uppercase ${
                        group.category === "INFO"
                          ? "bg-brand-500 text-white"
                          : group.category === "LARANGAN"
                            ? "bg-ta-error text-white"
                            : "bg-ta-gray-100 text-ta-gray-700 dark:bg-ta-gray-700 dark:text-ta-gray-200"
                      }`}
                    >
                      {group.category}
                    </h3>
                    <span className="text-xs font-bold text-ta-gray-500 dark:text-ta-gray-400">
                      {group.items.length} pengumuman
                    </span>
                    <div
                      className="h-0.5 flex-1 bg-ta-gray-200 dark:bg-ta-gray-700"
                      aria-hidden="true"
                    />
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
                          className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left text-sm font-semibold leading-tight transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 sm:text-base ${
                            group.category === "INFO"
                              ? "border-brand-500 bg-brand-500 text-white"
                              : group.category === "LARANGAN"
                                ? "border-ta-error bg-ta-error text-white"
                                : "border-ta-gray-200 bg-white text-ta-gray-900 dark:border-ta-gray-700 dark:bg-ta-gray-800 dark:text-white"
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

            <footer className="mt-8 border-t border-ta-gray-200 px-2 pb-2 pt-4 text-center text-xs leading-relaxed text-ta-gray-500 sm:text-sm dark:border-ta-gray-700 dark:text-ta-gray-400">
              <p className="flex items-center justify-center gap-1">
                lihatmeja.com <span aria-label="copyright">©</span> {new Date().getFullYear()}
              </p>
              <p className="mt-1 text-[11px] font-bold uppercase tracking-wide">XDIRGA LABS</p>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
