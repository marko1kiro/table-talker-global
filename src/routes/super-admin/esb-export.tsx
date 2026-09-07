import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Download, QrCode, Save } from "lucide-react";
import {
  getRestaurantEsbAppId,
  listRestaurantsForEsbPanel,
  setRestaurantEsbAppId,
} from "@/lib/esb-app-id.server";
import {
  DEFAULT_QR_EXPORT_DOMAIN,
  generateQrExport,
  listQrExportHistory,
  type QrBatchHistoryRow,
} from "@/lib/qr-export.server";
import {
  TaEmpty,
  TaField,
  TaLoading,
  TaNotice,
  TaPage,
  TaPageHeader,
  TaCard,
  TaRetry,
  TaBadge,
  taControlClass,
  taPrimaryButtonClass,
  taSecondaryButtonClass,
} from "@/components/dashboard/ui";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/super-admin/esb-export")({ component: EsbExport });

type RestaurantRow = { id: string; display_name: string; esb_app_id: string | null };

function EsbExport() {
  const queryClient = useQueryClient();
  const [restaurantId, setRestaurantId] = useState("");
  const [esbAppIdInput, setEsbAppIdInput] = useState("");
  const [domain, setDomain] = useState(DEFAULT_QR_EXPORT_DOMAIN);
  const [realTableCount, setRealTableCount] = useState(100);
  const [superAdminPassword, setSuperAdminPassword] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [generateSuccess, setGenerateSuccess] = useState(false);

  const restaurants = useQuery({
    queryKey: ["owner-esb-restaurants"],
    queryFn: listRestaurantsForEsbPanel,
  });
  const detail = useQuery({
    queryKey: ["owner-esb-app-id", restaurantId],
    queryFn: () => getRestaurantEsbAppId({ data: { restaurantId } }),
    enabled: !!restaurantId,
  });
  const history = useQuery({
    queryKey: ["qr-export-history", restaurantId],
    queryFn: () => listQrExportHistory({ data: { restaurantId } }),
    enabled: !!restaurantId,
  });

  const save = useMutation({
    mutationFn: () =>
      setRestaurantEsbAppId({ data: { restaurantId, esbAppId: esbAppIdInput.trim() } }),
    onSuccess: async (result) => {
      if ("error" in result) {
        setSaveError(result.error ?? "ESB App ID tidak dapat disimpan.");
        setSaveSuccess(false);
        return;
      }
      setSaveError("");
      setSaveSuccess(true);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["owner-esb-restaurants"] }),
        queryClient.invalidateQueries({ queryKey: ["owner-esb-app-id", restaurantId] }),
      ]);
    },
    onError: () => {
      setSaveError("ESB App ID tidak dapat disimpan.");
      setSaveSuccess(false);
    },
  });

  const generate = useMutation({
    mutationFn: () => {
      const count = Math.max(1, Math.min(100, Math.floor(realTableCount) || 100));
      const tableNumbers = Array.from({ length: count }, (_, i) => i + 1);
      return generateQrExport({
        data: {
          restaurantId,
          domain: domain.trim() || DEFAULT_QR_EXPORT_DOMAIN,
          scope: count === 100 ? "all" : "selected",
          tableNumbers: count === 100 ? [] : tableNumbers,
          superAdminPassword,
        },
      });
    },
    onSuccess: async () => {
      setGenerateError("");
      setGenerateSuccess(true);
      setSuperAdminPassword("");
      await queryClient.invalidateQueries({ queryKey: ["qr-export-history", restaurantId] });
    },
    onError: () => {
      setGenerateSuccess(false);
      setGenerateError("Pembuatan file gagal. QR lama tetap aktif.");
    },
  });

  const rows = restaurants.data?.ok ? (restaurants.data.restaurants as RestaurantRow[]) : [];
  const batches = history.data?.ok ? (history.data.batches as QrBatchHistoryRow[]) : [];

  function selectRestaurant(id: string) {
    setRestaurantId(id);
    setSaveError("");
    setSaveSuccess(false);
    setGenerateError("");
    setGenerateSuccess(false);
    setRealTableCount(100);
    setEsbAppIdInput(rows.find((row) => row.id === id)?.esb_app_id ?? "");
  }

  function downloadBatch(batchId: string, format: "pdf" | "xlsx" | "docx" = "pdf") {
    window.location.assign(`/api/super-admin/qr-export/${batchId}/${format}`);
  }

  return (
    <TaPage>
      <TaPageHeader
        eyebrow="Integrasi ESB"
        title="ESB App ID & Generate QR"
        description="Atur ESB App ID, buat QR aman untuk semua atau meja tertentu, lalu unduh file cetaknya."
      />

      {restaurants.isLoading && <TaLoading label="Memuat daftar restoran..." />}
      {(restaurants.isError || (restaurants.data && !restaurants.data.ok)) && (
        <TaCard>
          <TaNotice role="alert" tone="danger">
            Daftar restoran tidak dapat dimuat.
          </TaNotice>
          <div className="mt-4">
            <TaRetry onClick={() => restaurants.refetch()} />
          </div>
        </TaCard>
      )}
      {restaurants.data?.ok && !rows.length && (
        <TaCard>
          <TaEmpty title="Belum ada restoran" description="Tambahkan restoran terlebih dahulu." />
        </TaCard>
      )}

      {!!rows.length && (
        <TaCard title="Pilih restoran" description="Pengaturan dan QR berlaku per restoran.">
          <TaField label="Restoran">
            <select
              className={taControlClass}
              value={restaurantId}
              onChange={(event) => selectRestaurant(event.target.value)}
            >
              <option value="">Pilih restoran...</option>
              {rows.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.display_name}{" "}
                  {row.esb_app_id ? `(ESB: ${row.esb_app_id})` : "(belum diatur)"}
                </option>
              ))}
            </select>
          </TaField>
        </TaCard>
      )}

      {restaurantId && (
        <TaCard title="ESB App ID" description="Nilai dari back-office ESB untuk tujuan pemesanan.">
          {detail.isLoading ? (
            <p className="text-sm text-slate-500">Memuat...</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <TaField label="ESB App ID" hint="Contoh: 1294">
                <input
                  className={taControlClass}
                  value={esbAppIdInput}
                  maxLength={40}
                  placeholder="Masukkan ESB App ID"
                  onChange={(event) => {
                    setEsbAppIdInput(event.target.value);
                    setSaveSuccess(false);
                  }}
                />
              </TaField>
              <button
                type="button"
                disabled={save.isPending || !esbAppIdInput.trim()}
                onClick={() => save.mutate()}
                className={taPrimaryButtonClass}
              >
                <Save className="size-4" />
                {save.isPending ? "Menyimpan..." : "Simpan"}
              </button>
            </div>
          )}
          {saveError && (
            <TaNotice role="alert" tone="danger">
              {saveError}
            </TaNotice>
          )}
          {saveSuccess && (
            <TaNotice role="status" tone="success">
              ESB App ID berhasil disimpan.
            </TaNotice>
          )}

          <div className="mt-6 border-t border-slate-100 pt-6">
            <h3 className="text-base font-extrabold text-slate-950">
              Generate QR (Kertas A2 Siap Cetak)
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Format lembar A2 (10×15 = 150 slot stiker 35×35mm dengan gap potong 3mm & badge nomor
              meja di tengah).
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <TaField label="Domain untuk link QR">
                <input
                  className={taControlClass}
                  value={domain}
                  placeholder={DEFAULT_QR_EXPORT_DOMAIN}
                  onChange={(event) => setDomain(event.target.value)}
                />
              </TaField>
              <TaField
                label="Jumlah Meja Real di Resto"
                hint="Misal isi 68 untuk cetak meja 1..68 (akan diulang round-robin sampai 150 slot A2 penuh)."
              >
                <input
                  type="number"
                  min={1}
                  max={100}
                  className={taControlClass}
                  value={realTableCount}
                  onChange={(event) => {
                    const val = parseInt(event.target.value, 10);
                    setRealTableCount(Number.isNaN(val) ? 1 : Math.max(1, Math.min(100, val)));
                  }}
                />
              </TaField>
            </div>

            <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50/50 p-3 text-xs leading-relaxed text-slate-700 dark:border-brand-900/50 dark:bg-brand-950/20 dark:text-slate-300">
              <p className="font-bold text-brand-700 dark:text-brand-400">
                Simulasi Lembar A2 (Total 150 Stiker):
              </p>
              <p className="mt-0.5">
                Meja 1 sampai {realTableCount} akan dicetak{" "}
                <strong>{Math.floor(150 / realTableCount)} lembar penuh</strong>
                {150 % realTableCount > 0 ? (
                  <>
                    {" "}
                    + sisa <strong>{150 % realTableCount} slot</strong> untuk Meja 1 sampai{" "}
                    {150 % realTableCount}.
                  </>
                ) : (
                  <> (pas 150 slot tanpa sisa).</>
                )}
              </p>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <TaField label="Konfirmasi password Super Admin">
                <input
                  className={taControlClass}
                  type="password"
                  autoComplete="current-password"
                  value={superAdminPassword}
                  onChange={(event) => setSuperAdminPassword(event.target.value)}
                />
              </TaField>
              <button
                type="button"
                className={taPrimaryButtonClass}
                disabled={generate.isPending || !superAdminPassword}
                onClick={() => generate.mutate()}
              >
                <QrCode className="size-4" />
                {generate.isPending
                  ? "Membuat PDF A2..."
                  : generateError
                    ? "COBA LAGI"
                    : "Generate PDF A2"}
              </button>
            </div>
            {generateError && (
              <TaNotice role="alert" tone="danger">
                {generateError}
              </TaNotice>
            )}
            {generateSuccess && (
              <TaNotice role="status" tone="success">
                File PDF A2 siap cetak berhasil dibuat dan tersimpan. Silakan unduh file PDF di
                tabel riwayat di bawah.
              </TaNotice>
            )}
          </div>
        </TaCard>
      )}

      {restaurantId && (
        <TaCard
          title="Riwayat QR"
          description="Riwayat dan file lama disimpan permanen untuk audit."
        >
          {history.isLoading && <TaLoading label="Memuat riwayat QR..." />}
          {(history.isError || (history.data && !history.data.ok)) && (
            <TaRetry onClick={() => history.refetch()} />
          )}
          {history.data?.ok && !batches.length && (
            <TaEmpty title="Belum ada riwayat QR" description="Lakukan Generate QR pertama." />
          )}
          {!!batches.length && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dibuat</TableHead>
                  <TableHead>Oleh</TableHead>
                  <TableHead>Cakupan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Unduhan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((batch) => (
                  <TableRow key={batch.id}>
                    <TableCell className="font-semibold">
                      {new Date(batch.created_at).toLocaleString("id-ID")}
                    </TableCell>
                    <TableCell className="text-slate-600">{batch.created_by}</TableCell>
                    <TableCell className="text-slate-600">
                      {batch.scope === "all" ? "100 meja" : `${batch.table_numbers.length} meja`}
                    </TableCell>
                    <TableCell>
                      <TaBadge tone={batch.status === "ACTIVE" ? "success" : "neutral"}>
                        {batch.status === "ACTIVE"
                          ? "ACTIVE"
                          : batch.status === "EXPIRED"
                            ? "EXPIRED"
                            : "SEBAGIAN AKTIF"}
                      </TaBadge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-2">
                        <button
                          type="button"
                          className={taPrimaryButtonClass}
                          onClick={() => downloadBatch(batch.id, "pdf")}
                        >
                          <Download className="size-4" /> Download PDF (A2)
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TaCard>
      )}
    </TaPage>
  );
}
