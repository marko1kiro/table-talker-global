import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Download, QrCode, Save } from "lucide-react";
import {
  getRestaurantEsbAppId,
  listRestaurantsForEsbPanel,
  setRestaurantEsbAppId,
} from "@/lib/esb-app-id.server";
import { DEFAULT_QR_EXPORT_DOMAIN } from "@/lib/qr-export.server";
import {
  OwnerEmpty,
  OwnerField,
  OwnerLoading,
  OwnerNotice,
  OwnerPage,
  OwnerPageHeader,
  OwnerPanel,
  OwnerRetry,
  ownerControlClass,
  ownerPrimaryButtonClass,
  ownerSecondaryButtonClass,
} from "@/components/OwnerUi";

// ESB App ID Panel + QR Link Export -- see docs/superpowers/specs/
// 2026-08-30-esb-app-id-panel-qr-export-design.md. Decision 2 (UI
// placement = Option B): a dedicated new Super Admin route, not the
// existing restaurant detail page.

export const Route = createFileRoute("/super-admin/esb-export")({ component: EsbExport });

type RestaurantRow = { id: string; display_name: string; esb_app_id: string | null };

function EsbExport() {
  const queryClient = useQueryClient();
  const [restaurantId, setRestaurantId] = useState("");
  const [esbAppIdInput, setEsbAppIdInput] = useState("");
  const [domain, setDomain] = useState(DEFAULT_QR_EXPORT_DOMAIN);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [exportError, setExportError] = useState("");
  const [exportingFormat, setExportingFormat] = useState<"xlsx" | "csv" | null>(null);

  const restaurants = useQuery({
    queryKey: ["owner-esb-restaurants"],
    queryFn: listRestaurantsForEsbPanel,
  });

  const detail = useQuery({
    queryKey: ["owner-esb-app-id", restaurantId],
    queryFn: () => getRestaurantEsbAppId({ data: { restaurantId } }),
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

  const rows = restaurants.data?.ok ? (restaurants.data.restaurants as RestaurantRow[]) : [];

  function selectRestaurant(id: string) {
    setRestaurantId(id);
    setSaveError("");
    setSaveSuccess(false);
    setExportError("");
    const row = rows.find((r) => r.id === id);
    setEsbAppIdInput(row?.esb_app_id ?? "");
  }

  async function handleExport(format: "xlsx" | "csv") {
    if (!restaurantId) return;
    setExportError("");
    setExportingFormat(format);
    try {
      const url = `/api/super-admin/qr-export/${restaurantId}/${format}?domain=${encodeURIComponent(
        domain.trim() || DEFAULT_QR_EXPORT_DOMAIN,
      )}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error("EXPORT_FAILED");
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const fileName = match?.[1] ?? `qr-export.${format}`;
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      setExportError("Export gagal. Coba lagi.");
    } finally {
      setExportingFormat(null);
    }
  }

  return (
    <OwnerPage>
      <OwnerPageHeader
        eyebrow="Integrasi ESB"
        title="ESB App ID & Export QR"
        description="Atur ESB App ID per restoran, lalu export daftar link QR meja (.xlsx / .csv) untuk dicetak ulang."
      />

      {restaurants.isLoading && <OwnerLoading label="Memuat daftar restoran..." />}
      {(restaurants.isError || (restaurants.data && !restaurants.data.ok)) && (
        <OwnerPanel>
          <OwnerNotice role="alert" tone="danger">
            Daftar restoran tidak dapat dimuat.
          </OwnerNotice>
          <div className="mt-4">
            <OwnerRetry onClick={() => restaurants.refetch()} />
          </div>
        </OwnerPanel>
      )}
      {restaurants.data?.ok && !rows.length && (
        <OwnerPanel>
          <OwnerEmpty
            title="Belum ada restoran"
            description="Tambahkan restoran terlebih dahulu."
          />
        </OwnerPanel>
      )}

      {!!rows.length && (
        <OwnerPanel
          title="Pilih restoran"
          description="ESB App ID dan export QR berlaku per restoran."
        >
          <OwnerField label="Restoran">
            <select
              className={ownerControlClass}
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
          </OwnerField>
        </OwnerPanel>
      )}

      {restaurantId && (
        <OwnerPanel
          title="ESB App ID"
          description="Nilai ini berasal dari back-office ESB, dipetakan manual per restoran."
        >
          {detail.isLoading ? (
            <p className="text-sm text-slate-500">Memuat...</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <OwnerField label="ESB App ID" hint="Contoh: 1294">
                <input
                  className={ownerControlClass}
                  value={esbAppIdInput}
                  maxLength={40}
                  placeholder="Masukkan ESB App ID"
                  onChange={(event) => {
                    setEsbAppIdInput(event.target.value);
                    setSaveSuccess(false);
                  }}
                />
              </OwnerField>
              <button
                type="button"
                disabled={save.isPending || !esbAppIdInput.trim()}
                onClick={() => save.mutate()}
                className={ownerPrimaryButtonClass}
              >
                <Save className="size-4" />
                {save.isPending ? "Menyimpan..." : "Simpan"}
              </button>
            </div>
          )}
          {saveError && (
            <div className="mt-3">
              <OwnerNotice role="alert" tone="danger">
                {saveError}
              </OwnerNotice>
            </div>
          )}
          {saveSuccess && (
            <div className="mt-3">
              <OwnerNotice role="status" tone="success">
                ESB App ID berhasil disimpan.
              </OwnerNotice>
            </div>
          )}
        </OwnerPanel>
      )}

      {restaurantId && (
        <OwnerPanel
          title="Export Link QR (100 meja)"
          description="Domain di bawah ini hanya memengaruhi file export ini, tidak disimpan ke database."
        >
          <OwnerField label="Domain untuk link QR" hint="Default: qr.xdirga.xyz">
            <input
              className={ownerControlClass}
              value={domain}
              placeholder={DEFAULT_QR_EXPORT_DOMAIN}
              onChange={(event) => setDomain(event.target.value)}
            />
          </OwnerField>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={exportingFormat !== null}
              onClick={() => void handleExport("xlsx")}
              className={ownerPrimaryButtonClass}
            >
              <Download className="size-4" />
              {exportingFormat === "xlsx" ? "Mengunduh..." : "Export .xlsx"}
            </button>
            <button
              type="button"
              disabled={exportingFormat !== null}
              onClick={() => void handleExport("csv")}
              className={ownerSecondaryButtonClass}
            >
              <QrCode className="size-4" />
              {exportingFormat === "csv" ? "Mengunduh..." : "Export .csv"}
            </button>
          </div>
          {exportError && (
            <div className="mt-3">
              <OwnerNotice role="alert" tone="danger">
                {exportError}
              </OwnerNotice>
            </div>
          )}
        </OwnerPanel>
      )}
    </OwnerPage>
  );
}
