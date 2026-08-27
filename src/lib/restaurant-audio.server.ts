import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "./remote-audio.server";
import { r2Key, readFromR2 } from "./r2.server";
import { verifyActiveTenantSession } from "./restaurant-session.server";

type TenantSession = { restaurantId: string; codeVersion: number } | null;

type AudioAccessDependencies = {
  getClient?: () => SupabaseClient | null;
  verifySession?: (client: SupabaseClient, token: string) => Promise<TenantSession>;
  readObject?: (key: string) => Promise<Uint8Array>;
};

function response(message: string, status: number) {
  return new Response(message, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export async function serveRestaurantAudio(
  request: Request,
  audioId: string,
  {
    getClient = getServiceClient,
    verifySession = verifyActiveTenantSession,
    readObject = readFromR2,
  }: AudioAccessDependencies = {},
): Promise<Response> {
  const restaurantId = new URL(request.url).searchParams.get("restaurantId");
  const token = bearerToken(request);
  if (!restaurantId || !audioId) return response("Permintaan audio tidak valid.", 400);
  if (!token) return response("Sesi resto tidak valid.", 401);

  const client = getClient();
  if (!client) return response("Layanan audio tidak tersedia.", 503);

  try {
    const tenant = await verifySession(client, token);
    if (!tenant || tenant.restaurantId !== restaurantId)
      return response("Sesi resto tidak valid.", 401);

    const { data: restaurant, error: restaurantError } = await client
      .from("restaurants")
      .select("catalog_version")
      .eq("id", restaurantId)
      .eq("is_active", true)
      .maybeSingle();
    if (restaurantError) return response("Layanan audio tidak tersedia.", 503);
    if (!restaurant) return response("Audio tidak ditemukan.", 404);

    const { data: item, error: manifestError } = await client
      .from("audio_manifests")
      .select("content_hash, byte_size")
      .eq("restaurant_id", restaurantId)
      .eq("catalog_version", restaurant.catalog_version)
      .eq("audio_id", audioId)
      .eq("active", true)
      .maybeSingle();
    if (manifestError) return response("Layanan audio tidak tersedia.", 503);
    if (!item) return response("Audio tidak ditemukan.", 404);

    const bytes = await readObject(r2Key(restaurantId, audioId, item.content_hash));
    if (bytes.byteLength !== item.byte_size)
      return response("Audio tidak dapat diverifikasi.", 502);

    const body = new Uint8Array(bytes).buffer;
    return new Response(body, {
      status: 200,
      headers: {
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Length": String(bytes.byteLength),
        "Content-Type": "audio/mpeg",
        "X-Content-Hash": item.content_hash,
        Vary: "Authorization",
      },
    });
  } catch {
    return response("Layanan audio tidak tersedia.", 503);
  }
}
