import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  FileAudio,
  Megaphone,
  PencilLine,
  Power,
  Search,
  Sparkles,
  Table2,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { listOwnerRestaurants } from "@/lib/owner-restaurants.server";
import {
  deleteManifestItem,
  listManifestItems,
  reorderManifestItem,
  toggleManifestItem,
  updateManifestMetadata,
  upsertManifestItem,
} from "@/lib/manifest.server";
import { requestR2Upload } from "@/lib/upload.server";
import { ANNOUNCEMENT_CATALOG } from "@/lib/remote-audio-domain";
import {
  OwnerEmpty,
  OwnerField,
  OwnerLoading,
  OwnerNotice,
  OwnerPage,
  OwnerPageHeader,
  OwnerPanel,
  StatusBadge,
  ownerControlClass,
  ownerDangerButtonClass,
  ownerPrimaryButtonClass,
  ownerSecondaryButtonClass,
} from "@/components/OwnerUi";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type ManifestItem = {
  audio_id: string;
  label: string;
  category: string;
  active: boolean;
  ordering: number;
};

type AudioGroup = "table" | "announcement" | "custom";
type AudioType = AudioGroup;

const MAX_TABLE_NUMBER = 100;
const TABLE_NUMBERS = Array.from({ length: MAX_TABLE_NUMBER }, (_, index) => index + 1);

const GROUP_META: Record<AudioGroup, { title: string; empty: string }> = {
  table: { title: "Sound Meja", empty: "Belum ada sound meja yang diunggah." },
  announcement: { title: "Sound Pengumuman", empty: "Belum ada sound pengumuman yang diunggah." },
  custom: { title: "Lainnya", empty: "Belum ada audio kustom yang diunggah." },
};

function classifyAudioId(audioId: string): AudioGroup {
  if (/^table:\d+$/.test(audioId)) return "table";
  if (/^announcement:/.test(audioId)) return "announcement";
  return "custom";
}

function tableNumberOf(audioId: string): number {
  const match = /^table:(\d+)$/.exec(audioId);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function matchesSearch(item: ManifestItem, query: string): boolean {
  if (!query) return true;
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return item.label.toLowerCase().includes(needle) || item.audio_id.toLowerCase().includes(needle);
}

export const Route = createFileRoute("/super-admin/audio")({
  validateSearch: (search: Record<string, unknown>) => ({
    restaurantId: typeof search.restaurantId === "string" ? search.restaurantId : "",
  }),
  component: Audio,
});

function Audio() {
  const { restaurantId } = Route.useSearch();
  const navigate = Route.useNavigate();
  const qc = useQueryClient();
  const [audioType, setAudioType] = useState<AudioType>("table");
  const [audioId, setAudioId] = useState("table:1");
  const [label, setLabel] = useState("Meja 1");
  const [category, setCategory] = useState("BASE");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [pendingItem, setPendingItem] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [activeGroup, setActiveGroup] = useState<AudioGroup>("table");
  const [search, setSearch] = useState("");
  const restaurants = useQuery({ queryKey: ["owner-restaurants"], queryFn: listOwnerRestaurants });
  const manifest = useQuery({
    queryKey: ["owner-manifest", restaurantId],
    queryFn: () => listManifestItems({ data: { restaurantId } }),
    enabled: !!restaurantId,
  });
  const selectedRestaurant = restaurants.data?.ok
    ? (restaurants.data.restaurants as Array<{ id: string; display_name: string }>).find(
        (restaurant) => restaurant.id === restaurantId,
      )
    : undefined;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["owner-manifest", restaurantId] });
    void qc.invalidateQueries({ queryKey: ["owner-restaurants"] });
    void qc.invalidateQueries({ queryKey: ["owner-restaurant", restaurantId] });
    void qc.invalidateQueries({ queryKey: ["owner-dashboard"] });
  };
  const mutate = async (key: string, action: () => Promise<{ ok: boolean; message?: string }>) => {
    setPendingItem(key);
    setMutationError("");
    try {
      const result = await action();
      if (result.ok) refresh();
      else setMutationError(result.message ?? "Mutasi katalog gagal.");
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : "Mutasi katalog gagal.");
    } finally {
      setPendingItem("");
    }
  };
  const selectAudioType = (next: AudioType) => {
    setAudioType(next);
    if (next === "table") {
      setAudioId("table:1");
      setLabel("Meja 1");
      setCategory("BASE");
    } else if (next === "announcement") {
      const first = ANNOUNCEMENT_CATALOG[0];
      setAudioId(`announcement:${first.id}`);
      setLabel(first.label);
      setCategory(first.category);
    } else {
      setAudioId("custom:");
      setLabel("");
      setCategory("CUSTOM");
    }
  };
  const selectTableNumber = (value: string) => {
    const n = Math.min(MAX_TABLE_NUMBER, Math.max(1, Number(value) || 1));
    setAudioId(`table:${n}`);
    setLabel(`Meja ${n}`);
  };
  const selectAnnouncement = (id: string) => {
    const item = ANNOUNCEMENT_CATALOG.find((entry) => entry.id === id);
    if (!item) return;
    setAudioId(`announcement:${item.id}`);
    setLabel(item.label);
    setCategory(item.category);
  };
  const upload = async () => {
    if (
      !file ||
      file.type !== "audio/mpeg" ||
      file.size < 1024 * 1024 ||
      file.size > 10 * 1024 * 1024
    )
      return setError("Pilih MP3 1-10 MB.");
    setPending(true);
    setError("");
    try {
      const hash = [
        ...new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())),
      ]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      const signed = await requestR2Upload({
        data: {
          restaurantId,
          audioId,
          contentType: "audio/mpeg",
          byteSize: file.size,
          contentHash: hash,
        },
      });
      if (!("ok" in signed) || !signed.ok) throw new Error("Upload tidak tersedia.");
      const put = await fetch(signed.putUrl, {
        method: "PUT",
        headers: signed.headers,
        body: file,
      });
      if (!put.ok) throw new Error("Upload gagal.");
      const saved = await upsertManifestItem({
        data: {
          restaurantId,
          audioId,
          label,
          category,
          r2Url: signed.url,
          contentHash: hash,
          byteSize: file.size,
          ordering: 0,
        },
      });
      if (!("ok" in saved) || !saved.ok) throw new Error("Katalog tidak tersimpan.");
      setFile(null);
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload gagal.");
    } finally {
      setPending(false);
    }
  };

  const items = useMemo(
    () =>
      manifest.data && "items" in manifest.data ? (manifest.data.items as ManifestItem[]) : [],
    [manifest.data],
  );
  const activeCount = items.filter((item) => item.active).length;

  const groups = useMemo(() => {
    const table = items
      .filter((item) => classifyAudioId(item.audio_id) === "table")
      .sort((a, b) => tableNumberOf(a.audio_id) - tableNumberOf(b.audio_id));
    const announcement = items.filter((item) => classifyAudioId(item.audio_id) === "announcement");
    const custom = items.filter((item) => classifyAudioId(item.audio_id) === "custom");
    return { table, announcement, custom };
  }, [items]);

  const visibleItems = groups[activeGroup].filter((item) => matchesSearch(item, search));

  return (
    <OwnerPage>
      <OwnerPageHeader
        eyebrow="Katalog Konten"
        title="Audio"
        description="Unggah, susun, dan aktifkan audio yang tersedia untuk setiap restoran."
      />

      <OwnerPanel
        title="Pilih restoran"
        description="Katalog audio dikelola secara terpisah untuk setiap restoran."
      >
        <OwnerField label="Restoran">
          <select
            aria-label="Resto"
            className={ownerControlClass}
            value={restaurantId}
            onChange={(event) => void navigate({ search: { restaurantId: event.target.value } })}
          >
            <option value="">Pilih restoran</option>
            {restaurants.data?.ok &&
              (restaurants.data.restaurants as Array<{ id: string; display_name: string }>).map(
                (restaurant) => (
                  <option key={restaurant.id} value={restaurant.id}>
                    {restaurant.display_name}
                  </option>
                ),
              )}
          </select>
        </OwnerField>
      </OwnerPanel>

      {!restaurantId ? (
        <OwnerPanel>
          <OwnerEmpty
            title="Pilih restoran terlebih dahulu"
            description="Setelah restoran dipilih, form upload dan katalog audionya akan muncul di sini."
          />
        </OwnerPanel>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Restoran" value={selectedRestaurant?.display_name ?? "Terpilih"} />
            <Metric
              label="Sound meja"
              value={
                manifest.isLoading
                  ? "—"
                  : `${groups.table.filter((i) => i.active).length}/${groups.table.length}`
              }
              icon={<Table2 className="size-4" />}
            />
            <Metric
              label="Sound pengumuman"
              value={
                manifest.isLoading
                  ? "—"
                  : `${groups.announcement.filter((i) => i.active).length}/${groups.announcement.length}`
              }
              icon={<Megaphone className="size-4" />}
            />
            <Metric
              label="Total audio aktif"
              value={manifest.isLoading ? "—" : `${activeCount}/${items.length}`}
            />
          </section>

          <OwnerPanel
            title="Tambah atau ganti audio"
            description="Pilih tipe audio untuk mengisi ID dan label secara otomatis. ID yang sama akan memperbarui mapping tanpa mengubah riwayat objek lama."
          >
            <div className="grid gap-4 md:grid-cols-3">
              <OwnerField label="Tipe audio" hint="Menentukan grup katalog di bawah.">
                <select
                  aria-label="Tipe audio"
                  className={ownerControlClass}
                  value={audioType}
                  onChange={(event) => selectAudioType(event.target.value as AudioType)}
                >
                  <option value="table">Sound Meja</option>
                  <option value="announcement">Sound Pengumuman</option>
                  <option value="custom">Lainnya (custom)</option>
                </select>
              </OwnerField>

              {audioType === "table" && (
                <OwnerField label="Nomor meja">
                  <select
                    aria-label="Nomor meja"
                    className={ownerControlClass}
                    value={String(tableNumberOf(audioId))}
                    onChange={(event) => selectTableNumber(event.target.value)}
                  >
                    {TABLE_NUMBERS.map((n) => (
                      <option key={n} value={n}>
                        Meja {n}
                      </option>
                    ))}
                  </select>
                </OwnerField>
              )}

              {audioType === "announcement" && (
                <OwnerField label="Pilih pengumuman">
                  <select
                    aria-label="Pilih pengumuman"
                    className={ownerControlClass}
                    value={
                      audioId.startsWith("announcement:")
                        ? audioId.slice("announcement:".length)
                        : ""
                    }
                    onChange={(event) => selectAnnouncement(event.target.value)}
                  >
                    {ANNOUNCEMENT_CATALOG.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </OwnerField>
              )}

              {audioType === "custom" && (
                <OwnerField label="Audio ID" hint="Contoh: custom:promo-sore">
                  <input
                    aria-label="Audio ID"
                    className={ownerControlClass}
                    value={audioId}
                    onChange={(event) => setAudioId(event.target.value)}
                  />
                </OwnerField>
              )}

              <OwnerField label="Label audio">
                <input
                  aria-label="Label audio"
                  className={ownerControlClass}
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                />
              </OwnerField>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-3">
              {audioType !== "custom" && (
                <OwnerField label="Audio ID" hint="Terisi otomatis, dapat disalin bila diperlukan.">
                  <input
                    aria-label="Audio ID"
                    className={`${ownerControlClass} bg-slate-50 text-slate-500`}
                    value={audioId}
                    readOnly
                  />
                </OwnerField>
              )}
              <OwnerField label="Kategori">
                <input
                  aria-label="Kategori audio"
                  className={ownerControlClass}
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                />
              </OwnerField>
            </div>

            <label className="mt-5 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center transition hover:border-amber-400 hover:bg-amber-50/40">
              <span className="grid size-11 place-items-center rounded-xl bg-white text-slate-600 shadow-sm ring-1 ring-slate-200">
                <UploadCloud className="size-5" />
              </span>
              <span className="mt-3 text-sm font-extrabold text-slate-800">
                {file ? file.name : "Pilih file MP3"}
              </span>
              <span className="mt-1 text-xs text-slate-500">
                {file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "Ukuran file 1–10 MB"}
              </span>
              <input
                aria-label="File MP3"
                className="sr-only"
                type="file"
                accept="audio/mpeg,.mp3"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </label>

            {error && (
              <div className="mt-4">
                <OwnerNotice role="alert" tone="danger">
                  {error}
                </OwnerNotice>
              </div>
            )}
            <button
              type="button"
              disabled={pending || !file}
              onClick={() => void upload()}
              className={`${ownerPrimaryButtonClass} mt-5 w-full sm:w-auto`}
            >
              <UploadCloud className="size-4" />
              {pending ? "Mengunggah..." : "Simpan MP3"}
            </button>
          </OwnerPanel>

          {manifest.isLoading ? (
            <OwnerLoading label="Memuat katalog audio..." />
          ) : manifest.data && "items" in manifest.data ? (
            <OwnerPanel
              title="Katalog audio"
              description="Sound meja dan sound pengumuman dikelompokkan agar lebih mudah dicari dan dikelola."
            >
              <Tabs
                value={activeGroup}
                onValueChange={(value) => setActiveGroup(value as AudioGroup)}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <TabsList>
                    <TabsTrigger value="table" className="gap-1.5">
                      <Table2 className="size-4" /> Sound Meja
                      <StatusBadge tone={activeGroup === "table" ? "info" : "neutral"}>
                        {groups.table.length}
                      </StatusBadge>
                    </TabsTrigger>
                    <TabsTrigger value="announcement" className="gap-1.5">
                      <Megaphone className="size-4" /> Sound Pengumuman
                      <StatusBadge tone={activeGroup === "announcement" ? "info" : "neutral"}>
                        {groups.announcement.length}
                      </StatusBadge>
                    </TabsTrigger>
                    <TabsTrigger value="custom" className="gap-1.5">
                      <Sparkles className="size-4" /> Lainnya
                      <StatusBadge tone={activeGroup === "custom" ? "info" : "neutral"}>
                        {groups.custom.length}
                      </StatusBadge>
                    </TabsTrigger>
                  </TabsList>
                  <div className="relative sm:w-64">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 mt-0.5 size-4 -translate-y-1/2 text-slate-400" />
                    <input
                      aria-label="Cari audio"
                      className={`${ownerControlClass} pl-10`}
                      value={search}
                      placeholder="Cari label atau ID..."
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </div>
                </div>

                {(["table", "announcement", "custom"] as const).map((group) => (
                  <TabsContent key={group} value={group} className="mt-4">
                    {visibleItems.length && activeGroup === group ? (
                      <div className="space-y-3">
                        {visibleItems.map((item) => (
                          <AudioItem
                            key={item.audio_id}
                            item={item}
                            pendingItem={pendingItem}
                            onMutate={(action) => void mutate(item.audio_id, action)}
                            restaurantId={restaurantId}
                          />
                        ))}
                      </div>
                    ) : (
                      <OwnerEmpty
                        title={groups[group].length ? "Tidak ada hasil" : GROUP_META[group].title}
                        description={
                          groups[group].length
                            ? "Tidak ada audio yang cocok dengan pencarian ini."
                            : GROUP_META[group].empty
                        }
                      />
                    )}
                  </TabsContent>
                ))}
              </Tabs>
            </OwnerPanel>
          ) : (
            <OwnerNotice role="alert" tone="danger">
              Katalog tidak dapat dimuat.
            </OwnerNotice>
          )}
          {mutationError && (
            <OwnerNotice role="alert" tone="danger">
              {mutationError}
            </OwnerNotice>
          )}
        </>
      )}
    </OwnerPage>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
        {icon}
        {label}
      </p>
      <p className="mt-2 truncate text-xl font-black text-slate-950">{value}</p>
    </div>
  );
}

function AudioItem({
  item,
  pendingItem,
  onMutate,
  restaurantId,
}: {
  item: ManifestItem;
  pendingItem: string;
  onMutate: (action: () => Promise<{ ok: boolean; message?: string }>) => void;
  restaurantId: string;
}) {
  const pending = pendingItem === item.audio_id;
  const group = classifyAudioId(item.audio_id);

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-700">
          {group === "announcement" ? (
            <Megaphone className="size-5" />
          ) : group === "table" ? (
            <Table2 className="size-5" />
          ) : (
            <FileAudio className="size-5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-extrabold text-slate-950">{item.label}</h3>
            <StatusBadge tone={item.active ? "success" : "neutral"}>
              {item.active ? "Aktif" : "Nonaktif"}
            </StatusBadge>
          </div>
          <p className="mt-1 break-all font-mono text-xs text-slate-500">{item.audio_id}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-slate-500">
            <span className="rounded-lg bg-slate-100 px-2.5 py-1">{item.category}</span>
            <span className="rounded-lg bg-slate-100 px-2.5 py-1">Urutan {item.ordering}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            title={item.active ? "Nonaktifkan" : "Aktifkan"}
            disabled={pending}
            onClick={() =>
              onMutate(() =>
                toggleManifestItem({
                  data: { restaurantId, audioId: item.audio_id, active: !item.active },
                }),
              )
            }
            className={ownerSecondaryButtonClass}
          >
            <Power className="size-4" /> {item.active ? "Nonaktifkan" : "Aktifkan"}
          </button>
          <button
            type="button"
            aria-label={`Naikkan ${item.label}`}
            disabled={pending || item.ordering === 0}
            onClick={() =>
              onMutate(() =>
                reorderManifestItem({
                  data: { restaurantId, audioId: item.audio_id, ordering: item.ordering - 1 },
                }),
              )
            }
            className={ownerSecondaryButtonClass}
          >
            <ArrowUp className="size-4" />
          </button>
          <button
            type="button"
            aria-label={`Turunkan ${item.label}`}
            disabled={pending}
            onClick={() =>
              onMutate(() =>
                reorderManifestItem({
                  data: { restaurantId, audioId: item.audio_id, ordering: item.ordering + 1 },
                }),
              )
            }
            className={ownerSecondaryButtonClass}
          >
            <ArrowDown className="size-4" />
          </button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                disabled={pendingItem === item.audio_id}
                className={ownerDangerButtonClass}
              >
                <Trash2 className="size-4" /> Hapus
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogTitle>Hapus audio?</AlertDialogTitle>
              <AlertDialogDescription>
                Mapping audio akan dihapus. Objek R2 tetap dipertahankan untuk riwayat immutable.
              </AlertDialogDescription>
              <AlertDialogAction
                disabled={pendingItem === item.audio_id}
                onClick={() =>
                  onMutate(() =>
                    deleteManifestItem({ data: { restaurantId, audioId: item.audio_id } }),
                  )
                }
              >
                Hapus
              </AlertDialogAction>
              <AlertDialogCancel>Batal</AlertDialogCancel>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <details className="mt-4 rounded-xl bg-slate-50 open:ring-1 open:ring-slate-200">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-bold text-slate-700">
          <PencilLine className="size-4" /> Edit metadata
        </summary>
        <div className="grid gap-4 border-t border-slate-200 p-4 sm:grid-cols-2">
          <OwnerField label="Label">
            <input
              className={ownerControlClass}
              aria-label={`Label ${item.audio_id}`}
              defaultValue={item.label}
              onBlur={(event) =>
                onMutate(() =>
                  updateManifestMetadata({
                    data: {
                      restaurantId,
                      audioId: item.audio_id,
                      label: event.target.value,
                      category: item.category,
                      active: item.active,
                      ordering: item.ordering,
                    },
                  }),
                )
              }
            />
          </OwnerField>
          <OwnerField label="Kategori">
            <input
              className={ownerControlClass}
              aria-label={`Kategori ${item.audio_id}`}
              defaultValue={item.category}
              onBlur={(event) =>
                onMutate(() =>
                  updateManifestMetadata({
                    data: {
                      restaurantId,
                      audioId: item.audio_id,
                      label: item.label,
                      category: event.target.value,
                      active: item.active,
                      ordering: item.ordering,
                    },
                  }),
                )
              }
            />
          </OwnerField>
        </div>
      </details>
    </article>
  );
}
