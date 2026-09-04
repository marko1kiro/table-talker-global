import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

export const Route = createFileRoute("/api/super-admin/qr-export/$batchId/$format")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { serveQrBatchDownload } = await import("@/lib/qr-export.server");
        return serveQrBatchDownload(params.batchId, params.format as "xlsx" | "docx" | "csv");
      },
    },
  },
});
