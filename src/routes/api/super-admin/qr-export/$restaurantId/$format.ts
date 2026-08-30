import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

// ESB App ID Panel + QR Link Export -- see docs/superpowers/specs/
// 2026-08-30-esb-app-id-panel-qr-export-design.md, §6. Raw API route
// pattern, mirroring src/routes/api/audio/$audioId.ts: auth + business
// logic live entirely in src/lib/qr-export.server.ts, this file is just
// the thin routing shim. `?domain=` is optional -- serveQrExport falls
// back to DEFAULT_QR_EXPORT_DOMAIN when it is absent (decision 2: the
// domain is never persisted, only ever supplied per export request).
export const Route = createFileRoute("/api/super-admin/qr-export/$restaurantId/$format")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { serveQrExport } = await import("@/lib/qr-export.server");
        const domain = new URL(request.url).searchParams.get("domain") ?? undefined;
        return serveQrExport({
          restaurantId: params.restaurantId,
          format: params.format as "xlsx" | "csv",
          domain,
        });
      },
    },
  },
});
