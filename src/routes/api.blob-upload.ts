import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireManage } from "@/lib/auth.server";
import { BLOB_PREFIX, TABLE_COUNT } from "@/lib/audio-store";

export const Route = createFileRoute("/api/blob-upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as HandleUploadBody;
          const result = await handleUpload({
            request,
            body,
            onBeforeGenerateToken: async (pathname, clientPayload) => {
              await requireManage();

              let tableNumber = 0;
              try {
                tableNumber = Number(JSON.parse(clientPayload || "{}").tableNumber);
              } catch {
                throw new Error("Payload upload tidak valid.");
              }

              if (
                !Number.isInteger(tableNumber) ||
                tableNumber < 1 ||
                tableNumber > TABLE_COUNT ||
                pathname !== `${BLOB_PREFIX}${tableNumber}.mp3`
              ) {
                throw new Error("Path upload tidak valid.");
              }

              return {
                allowedContentTypes: ["audio/mpeg", "audio/mp3"],
                maximumSizeInBytes: 25 * 1024 * 1024,
                addRandomSuffix: false,
                allowOverwrite: true,
                cacheControlMaxAge: 60,
              };
            },
          });
          return Response.json(result);
        } catch (error) {
          console.error("Blob upload error", error);
          return Response.json(
            { error: error instanceof Error ? error.message : "Upload gagal." },
            { status: 400 },
          );
        }
      },
    },
  },
});
