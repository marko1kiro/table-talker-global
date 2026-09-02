import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

export const Route = createFileRoute("/q/$token")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { handleOpaqueQrRequest } = await import("@/lib/dynamic-qr.server");
        return handleOpaqueQrRequest(params.token, request.headers);
      },
    },
  },
});
