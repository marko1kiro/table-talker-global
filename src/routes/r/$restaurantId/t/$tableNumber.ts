import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

// Task 7: QR Interceptor. Route shape follows the spec's confirmed
// `qr.xdirga.xyz/r/{restaurant}/t/{table}` path (docs/superpowers/specs/
// 2026-08-29-table-occupancy-tracking-design.md, "QR Interceptor" section)
// -- this app itself is deployed under whatever domain is mapped to it;
// `qr.xdirga.xyz` (temporary per Open Decision 2) or the eventual final
// domain both just need a DNS/custom-domain mapping onto this same
// deployment for this route to serve real QR scans.
//
// `$restaurantId` is the restaurant's UUID `id` (see
// src/lib/qr-interceptor.server.ts's header comment for why: no `slug`
// column exists anywhere in the restaurants schema). The physical QR
// codes printed for each table must therefore encode the real UUID, the
// same way `restaurant_access_tokens`/tenant provisioning already
// reference restaurants by id.
export const Route = createFileRoute("/r/$restaurantId/t/$tableNumber")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { handleQrInterceptorRequest } = await import("@/lib/qr-interceptor.server");
        return handleQrInterceptorRequest(params.restaurantId, params.tableNumber);
      },
    },
  },
});
