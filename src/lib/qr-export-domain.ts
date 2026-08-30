import { TABLE_COUNT } from "./remote-audio-domain";

// ESB App ID Panel + QR Link Export -- see docs/superpowers/specs/
// 2026-08-30-esb-app-id-panel-qr-export-design.md, decision 1 & 6.
//
// Pure, dependency-free core (Core-fn convention): builds the fixed
// 100-row table of QR Interceptor URLs for a single restaurant, so it can
// be unit tested without any DB/network call and reused identically by
// both the .xlsx and the .csv export wrappers.

export type QrExportRow = { tableNumber: number; url: string };

/**
 * Builds all TABLE_COUNT (100) QR Interceptor URLs for a restaurant, in
 * the `{domain}/r/{restaurantId}/t/{n}` shape confirmed by Task 7's
 * `src/routes/r/$restaurantId/t/$tableNumber.ts`. Every restaurant always
 * gets exactly 100 rows -- decision 1 of the spec -- regardless of how
 * many tables it physically has.
 */
export function buildQrExportRows(restaurantId: string, domain: string): QrExportRow[] {
  const normalizedDomain = domain.replace(/\/+$/, "");
  return Array.from({ length: TABLE_COUNT }, (_, index) => {
    const tableNumber = index + 1;
    return {
      tableNumber,
      url: `${normalizedDomain}/r/${restaurantId}/t/${tableNumber}`,
    };
  });
}
