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
const TABLES = Array.from({ length: 100 }, (_, index) => index + 1);

function EsbExport() {
  const queryClient = useQueryClient();
  const [restaurantId, setRestaurantId] = useState("");
  const [esbAppIdInput, setEsbAppIdInput] = useState("");
  const [domain, setDomain] = useState(DEFAULT_QR_EXPORT_DOMAIN);
  const [scope, setScope] = useState<"all" | "selected">("all");
  const [selectedTables, setSelectedTables] = useState<number[]>([]);
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
    mutationFn: () =>
      generateQrExport({
        data: {
          restaurantId,
          domain: domain.trim() || DEFAULT_QR_EXPORT_DOMAIN,
          scope,
          tableNumbers: scope === "all" ? [] : selectedTables,
          superAdminPassword,
        },
      }),
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
    setSelectedTables([]);
    setEsbAppIdInput(rows.find((row) => row.id === id)?.esb_app_id ?? "");
  }

  function toggleTable(tableNumber: number) {
    setSelectedTables((current) =>
      current.includes(tableNumber)
        ? current.filter((value) => value !== tableNumber)
        : [...current, tableNumber].sort((a, b) => a - b),
    );
  }

  function downloadBatch(batchId: string, format: "xlsx" | "docx") {
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
            <h3 className="text-base font-extrabold text-slate-950">Generate QR</h3>
            <p className="mt-1 text-sm text-slate-500">
              QR lama baru dinonaktifkan setelah file XLSX dan DOCX baru berhasil disimpan.
            </p>
            <TaField label="Domain untuk link QR">
              <input
                className={taControlClass}
                value={domain}
                placeholder={DEFAULT_QR_EXPORT_DOMAIN}
                onChange={(event) => setDomain(event.target.value)}
              />
            </TaField>

            <fieldset className="mt-5">
              <legend className="text-sm font-bold text-slate-900">Cakupan meja</legend>
              <div className="mt-2 flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <input type="radio" checked={scope === "all"} onChange={() => setScope("all")} />
                  Semua meja
                </label>
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <input
                    type="radio"
                    checked={scope === "selected"}
                    onChange={() => setScope("selected")}
                  />
                  Meja tertentu
                </label>
              </div>
            </fieldset>

            {scope === "selected" && (
              <div className="mt-4 grid max-h-64 grid-cols-4 gap-2 overflow-y-auto rounded-xl border p-3 sm:grid-cols-10">
                {TABLES.map((tableNumber) => (
                  <label key={tableNumber} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedTables.includes(tableNumber)}
                      onChange={() => toggleTable(tableNumber)}
                    />
                    {tableNumber}
                  </label>
                ))}
              </div>
            )}

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
                disabled={
                  generate.isPending ||
                  !superAdminPassword ||
                  (scope === "selected" && selectedTables.length === 0)
                }
                onClick={() => generate.mutate()}
              >
                <QrCode className="size-4" />
                {generate.isPending ? "Membuat..." : generateError ? "COBA LAGI" : "Generate QR"}
              </button>
            </div>
            {generateError && (
              <TaNotice role="alert" tone="danger">
                {generateError}
              </TaNotice>
            )}
            {generateSuccess && (
              <TaNotice role="status" tone="success">
                QR dan kedua file berhasil dibuat. Silakan ganti stiker meja yang dipilih.
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
                      {batch.scope === "all" ? "Semua meja" : `${batch.table_numbers.length} meja`}
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
                          className={taSecondaryButtonClass}
                          onClick={() => downloadBatch(batch.id, "xlsx")}
                        >
                          <Download className="size-4" /> XLSX
                        </button>
                        <button
                          type="button"
                          className={taSecondaryButtonClass}
                          onClick={() => downloadBatch(batch.id, "docx")}
                        >
                          <Download className="size-4" /> DOCX
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
