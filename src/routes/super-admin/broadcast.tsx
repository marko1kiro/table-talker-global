import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Eye,
  Megaphone,
  Radio,
  Send,
  ShieldAlert,
  Users,
  XCircle,
} from "lucide-react";
import {
  OwnerEmpty,
  OwnerField,
  OwnerNotice,
  OwnerPage,
  OwnerPageHeader,
  OwnerPanel,
  StatusBadge,
  ownerControlClass,
  ownerPrimaryButtonClass,
  ownerSecondaryButtonClass,
} from "@/components/OwnerUi";
import { CREW_MESSAGE_MAX_LENGTH } from "@/lib/crew-message-domain";
import { ALL_CONFIRMATION } from "@/lib/owner-broadcast-domain";
import { shouldResetBroadcastIdempotencyKey } from "@/lib/owner-broadcast-retry";
import { previewOwnerBroadcast, sendOwnerBroadcast } from "@/lib/owner-broadcast.server";
import { listOwnerRestaurants } from "@/lib/owner-restaurants.server";

export const Route = createFileRoute("/super-admin/broadcast")({ component: Broadcast });

function Broadcast() {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<"restaurant" | "all">("restaurant");
  const [restaurantId, setRestaurantId] = useState("");
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewOwnerBroadcast>> | null>(
    null,
  );
  const [result, setResult] = useState<Awaited<ReturnType<typeof sendOwnerBroadcast>> | null>(null);
  const [error, setError] = useState("");
  const idempotencyKey = useRef<string | null>(null);
  const previewRequestId = useRef(0);

  const resetRequest = () => {
    idempotencyKey.current = null;
    previewRequestId.current += 1;
    setPreview(null);
    setResult(null);
    setError("");
  };

  const restaurants = useQuery({
    queryKey: ["owner-restaurants"],
    queryFn: listOwnerRestaurants,
  });
  const previewMutation = useMutation({
    mutationFn: ({
      scope: requestScope,
      restaurantId: requestRestaurantId,
    }: {
      requestId: number;
      scope: "restaurant" | "all";
      restaurantId?: string;
    }) =>
      previewOwnerBroadcast({
        data: { scope: requestScope, restaurantId: requestRestaurantId },
      }),
    onSuccess: (data, { requestId }) => {
      if (requestId !== previewRequestId.current) return;
      setPreview(data);
      setResult(null);
      setError(data.ok ? "" : data.message);
    },
    onError: (_error, { requestId }) => {
      if (requestId === previewRequestId.current) setError("Preview broadcast gagal.");
    },
  });
  const sendMutation = useMutation({
    mutationFn: () =>
      sendOwnerBroadcast({
        data: {
          scope,
          restaurantId: scope === "restaurant" ? restaurantId : undefined,
          message,
          confirmation: scope === "all" ? confirmation : undefined,
          idempotencyKey: (idempotencyKey.current ??= crypto.randomUUID()),
        },
      }),
    onSuccess: async (data) => {
      setResult(data);
      setError(data.ok ? "" : data.message);
      if (shouldResetBroadcastIdempotencyKey(data)) idempotencyKey.current = null;
      if (data.ok) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["owner-dashboard"] }),
          queryClient.invalidateQueries({ queryKey: ["owner-history"] }),
        ]);
      }
    },
    onError: () => setError("Broadcast gagal dikirim."),
  });

  const canSend =
    preview?.ok &&
    message.trim().length > 0 &&
    message.length <= CREW_MESSAGE_MAX_LENGTH &&
    (scope !== "all" || confirmation === ALL_CONFIRMATION);
  const selectedRestaurant =
    restaurants.data?.ok &&
    restaurants.data.restaurants.find(
      (restaurant: { id: string; display_name: string }) => restaurant.id === restaurantId,
    );

  return (
    <OwnerPage>
      <OwnerPageHeader
        eyebrow="Komunikasi Operasional"
        title="Broadcast"
        description="Kirim pesan singkat ke perangkat crew yang aktif. Selalu periksa target sebelum mengirim."
        action={
          <Link to="/super-admin/history" className={ownerSecondaryButtonClass}>
            Lihat riwayat
            <ArrowRight className="size-4" />
          </Link>
        }
      />

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(19rem,0.8fr)]">
        <OwnerPanel
          title="Susun broadcast"
          description="Pilih cakupan, tulis pesan, lalu muat preview target aktif."
        >
          <div className="space-y-5">
            <fieldset>
              <legend className="text-sm font-bold text-slate-700">Target pengiriman</legend>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <ScopeOption
                  active={scope === "restaurant"}
                  icon={<Building2 className="size-5" />}
                  title="Satu restoran"
                  description="Kirim hanya ke crew aktif di restoran pilihan."
                  onClick={() => {
                    if (scope === "restaurant") return;
                    setScope("restaurant");
                    resetRequest();
                    setConfirmation("");
                  }}
                />
                <ScopeOption
                  active={scope === "all"}
                  icon={<Radio className="size-5" />}
                  title="Semua restoran"
                  description="Kirim ke seluruh restoran aktif sekaligus."
                  onClick={() => {
                    if (scope === "all") return;
                    setScope("all");
                    resetRequest();
                    setConfirmation("");
                  }}
                />
              </div>
            </fieldset>

            {scope === "restaurant" && (
              <OwnerField label="Restoran tujuan">
                <select
                  aria-label="Restoran tujuan"
                  className={ownerControlClass}
                  value={restaurantId}
                  disabled={restaurants.isLoading}
                  onChange={(event) => {
                    setRestaurantId(event.target.value);
                    resetRequest();
                  }}
                >
                  <option value="">
                    {restaurants.isLoading ? "Memuat restoran..." : "Pilih restoran"}
                  </option>
                  {restaurants.data?.ok &&
                    restaurants.data.restaurants.map(
                      (restaurant: { id: string; display_name: string }) => (
                        <option key={restaurant.id} value={restaurant.id}>
                          {restaurant.display_name}
                        </option>
                      ),
                    )}
                </select>
              </OwnerField>
            )}

            {restaurants.isError || (restaurants.data && !restaurants.data.ok) ? (
              <OwnerNotice role="alert" tone="danger">
                Daftar restoran tidak dapat dimuat. Muat ulang halaman lalu coba lagi.
              </OwnerNotice>
            ) : null}

            <OwnerField
              label="Pesan untuk crew"
              hint="Preview target akan direset saat pesan diubah agar penerima selalu diperiksa ulang."
            >
              <textarea
                aria-label="Pesan broadcast"
                className={`${ownerControlClass} min-h-36 resize-y`}
                value={message}
                maxLength={CREW_MESSAGE_MAX_LENGTH}
                placeholder="Contoh: Mohon cek kesiapan area layanan sebelum jam makan malam."
                onChange={(event) => {
                  setMessage(event.target.value);
                  resetRequest();
                }}
              />
              <span
                className={`mt-1.5 block text-right text-xs font-bold ${
                  message.length === CREW_MESSAGE_MAX_LENGTH ? "text-amber-700" : "text-slate-400"
                }`}
              >
                {message.length}/{CREW_MESSAGE_MAX_LENGTH} karakter
              </span>
            </OwnerField>

            <div className="flex flex-col gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-5 text-slate-500">
                Hanya perangkat connected, terlihat, dan audio-ready yang masuk preview.
              </p>
              <button
                type="button"
                disabled={previewMutation.isPending || (scope === "restaurant" && !restaurantId)}
                onClick={() => {
                  const requestId = ++previewRequestId.current;
                  previewMutation.mutate({
                    requestId,
                    scope,
                    restaurantId: scope === "restaurant" ? restaurantId : undefined,
                  });
                }}
                className={`${ownerSecondaryButtonClass} shrink-0`}
              >
                <Eye className="size-4" />
                {previewMutation.isPending ? "Memuat target..." : "Preview target"}
              </button>
            </div>
          </div>
        </OwnerPanel>

        <OwnerPanel
          title="Ringkasan target"
          description="Preview terbaru sebelum pesan dikirim."
          className="h-fit"
        >
          {preview?.ok ? (
            <div role="status" className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <SummaryMetric
                  icon={<Building2 className="size-4" />}
                  label="Restoran"
                  value={String(preview.restaurantCount)}
                />
                <SummaryMetric
                  icon={<Users className="size-4" />}
                  label="Perangkat aktif"
                  value={String(preview.deviceCount)}
                />
              </div>

              {preview.restaurants.length ? (
                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {preview.restaurants.map((restaurant) => (
                    <div
                      key={restaurant.restaurantId}
                      className="flex items-center justify-between gap-3 px-3.5 py-3"
                    >
                      <span className="min-w-0 truncate text-sm font-bold text-slate-700">
                        {restaurant.displayName}
                      </span>
                      <StatusBadge tone={restaurant.deviceCount ? "success" : "neutral"}>
                        {restaurant.deviceCount} perangkat
                      </StatusBadge>
                    </div>
                  ))}
                </div>
              ) : (
                <OwnerNotice tone="warning">
                  Tidak ada restoran aktif yang dapat menjadi target saat ini.
                </OwnerNotice>
              )}
            </div>
          ) : (
            <OwnerEmpty
              title="Target belum dipreview"
              description="Pilih cakupan dan klik Preview target untuk melihat penerima yang sedang aktif."
            />
          )}
        </OwnerPanel>
      </section>

      {scope === "all" && preview?.ok && (
        <OwnerPanel
          title="Konfirmasi pengiriman massal"
          description="Langkah tambahan ini mencegah broadcast ke semua restoran terkirim tanpa sengaja."
          className="border-amber-200"
        >
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)] lg:items-end">
            <OwnerNotice tone="warning">
              <div>
                <p className="font-extrabold">Tindakan berdampak luas</p>
                <p className="mt-1 font-normal leading-5">
                  Pesan akan dikirim ke {preview.deviceCount} perangkat aktif di{" "}
                  {preview.restaurantCount} restoran. Pastikan isi dan target sudah benar.
                </p>
              </div>
            </OwnerNotice>
            <OwnerField
              label={`Ketik ${ALL_CONFIRMATION}`}
              hint="Teks harus sama persis, termasuk huruf kapital."
            >
              <input
                aria-label="Konfirmasi broadcast semua restoran"
                className={ownerControlClass}
                value={confirmation}
                autoComplete="off"
                placeholder={ALL_CONFIRMATION}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </OwnerField>
          </div>
        </OwnerPanel>
      )}

      {preview?.ok && (
        <OwnerPanel className="border-slate-300 bg-slate-950 text-white">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/10 text-amber-300">
                <ShieldAlert className="size-5" />
              </span>
              <div>
                <p className="font-extrabold">Siap mengirim broadcast</p>
                <p className="mt-1 text-sm leading-5 text-slate-300">
                  {scope === "all"
                    ? `${preview.restaurantCount} restoran · ${preview.deviceCount} perangkat aktif`
                    : `${selectedRestaurant?.display_name ?? "Restoran terpilih"} · ${preview.deviceCount} perangkat aktif`}
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={!canSend || sendMutation.isPending}
              onClick={() => sendMutation.mutate()}
              className={`${ownerPrimaryButtonClass} bg-amber-400 text-slate-950 hover:bg-amber-300 md:min-w-44`}
            >
              <Send className="size-4" />
              {sendMutation.isPending ? "Mengirim..." : "Kirim broadcast"}
            </button>
          </div>
        </OwnerPanel>
      )}

      {error && (
        <OwnerNotice role="alert" tone="danger">
          {error}
        </OwnerNotice>
      )}

      {result?.ok && (
        <OwnerPanel
          title="Hasil per resto"
          description="Ringkasan status delivery dari broadcast terakhir."
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <ResultMetric
              label="Terkirim"
              value={result.totals.delivered}
              icon={<CheckCircle2 className="size-5" />}
              tone="success"
            />
            <ResultMetric
              label="Gagal"
              value={result.totals.failed}
              icon={<XCircle className="size-5" />}
              tone="danger"
            />
            <ResultMetric
              label="Ditolak"
              value={result.totals.rejected}
              icon={<CircleAlert className="size-5" />}
              tone="warning"
            />
            <ResultMetric
              label="Kedaluwarsa"
              value={result.totals.expired}
              icon={<Clock3 className="size-5" />}
              tone="neutral"
            />
          </div>

          {result.totals.partial && (
            <div className="mt-4">
              <OwnerNotice role="status" tone="warning">
                Sebagian target gagal. Periksa rincian per restoran dan tindak lanjuti bila perlu.
              </OwnerNotice>
            </div>
          )}

          <div className="mt-5 overflow-hidden rounded-xl border border-slate-200">
            <div className="hidden grid-cols-[minmax(0,1fr)_repeat(4,7rem)] bg-slate-50 px-4 py-3 text-xs font-extrabold uppercase tracking-wide text-slate-500 lg:grid">
              <span>Restoran</span>
              <span className="text-right">Terkirim</span>
              <span className="text-right">Gagal</span>
              <span className="text-right">Ditolak</span>
              <span className="text-right">Kedaluwarsa</span>
            </div>
            <div className="divide-y divide-slate-100">
              {result.results.map((row) => (
                <div
                  key={row.restaurantId}
                  className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_repeat(4,7rem)] lg:items-center"
                >
                  <p className="font-extrabold text-slate-900">{row.displayName}</p>
                  <ResultCount label="Terkirim" value={row.delivered} tone="success" />
                  <ResultCount label="Gagal" value={row.failed} tone="danger" />
                  <ResultCount label="Ditolak" value={row.rejected} tone="warning" />
                  <ResultCount label="Kedaluwarsa" value={row.expired} tone="neutral" />
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 flex justify-end">
            <Link to="/super-admin/history" className={ownerSecondaryButtonClass}>
              Lihat Riwayat Broadcast
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </OwnerPanel>
      )}
    </OwnerPage>
  );
}

function ScopeOption({
  active,
  icon,
  title,
  description,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex min-h-24 items-start gap-3 rounded-xl border-2 p-4 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-500/20 ${
        active
          ? "border-amber-400 bg-amber-50 text-slate-950"
          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      <span
        className={`grid size-9 shrink-0 place-items-center rounded-lg ${
          active ? "bg-amber-400 text-slate-950" : "bg-slate-100 text-slate-500"
        }`}
      >
        {icon}
      </span>
      <span>
        <span className="block text-sm font-extrabold">{title}</span>
        <span className="mt-1 block text-xs font-medium leading-5 text-slate-500">
          {description}
        </span>
      </span>
    </button>
  );
}

function SummaryMetric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-slate-50 p-3.5">
      <span className="flex items-center gap-2 text-xs font-bold text-slate-500">
        {icon}
        {label}
      </span>
      <p className="mt-2 text-2xl font-black text-slate-950">{value}</p>
    </div>
  );
}

function ResultMetric({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: "success" | "danger" | "warning" | "neutral";
}) {
  const toneClass = {
    success: "bg-emerald-50 text-emerald-700",
    danger: "bg-red-50 text-red-700",
    warning: "bg-amber-50 text-amber-800",
    neutral: "bg-slate-100 text-slate-600",
  }[tone];

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <span className={`grid size-9 place-items-center rounded-lg ${toneClass}`}>{icon}</span>
      <p className="mt-3 text-2xl font-black text-slate-950">{value}</p>
      <p className="mt-0.5 text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
    </div>
  );
}

function ResultCount({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "danger" | "warning" | "neutral";
}) {
  return (
    <div className="flex items-center justify-between gap-3 lg:justify-end">
      <span className="text-xs font-bold text-slate-400 lg:hidden">{label}</span>
      <StatusBadge tone={tone}>{value}</StatusBadge>
    </div>
  );
}
