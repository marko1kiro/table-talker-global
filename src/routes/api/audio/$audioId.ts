import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

export const Route = createFileRoute("/api/audio/$audioId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { serveRestaurantAudio } = await import("@/lib/restaurant-audio.server");
        return serveRestaurantAudio(request, params.audioId);
      },
    },
  },
});
