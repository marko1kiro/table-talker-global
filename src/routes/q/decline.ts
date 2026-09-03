import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { declinedPageResponse, defaultDeclineQrScan } from "@/lib/dynamic-qr.server";

export const Route = createFileRoute("/q/decline")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const contentType = request.headers.get("content-type") ?? "";
        if (!contentType.includes("application/x-www-form-urlencoded")) {
          return declinedPageResponse();
        }
        let scanId = "";
        try {
          const form = await request.formData();
          scanId = String(form.get("scan_id") ?? "");
        } catch {
          return declinedPageResponse();
        }
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scanId)) {
          return declinedPageResponse();
        }
        try {
          await defaultDeclineQrScan(scanId);
        } catch {
          // Idempoten: kegagalan DB tetap menayangkan halaman konfirmasi;
          // crew tetap backstop. Tidak ada informasi bocor ke pelanggan.
        }
        return declinedPageResponse();
      },
    },
  },
});
