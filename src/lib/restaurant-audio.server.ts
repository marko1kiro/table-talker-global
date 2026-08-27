import { verifyAudioDownloadGrant } from "./audio-download-grant.server";
import { r2Key, readFromR2 } from "./r2.server";

type AudioAccessDependencies = {
  verifyGrant?: typeof verifyAudioDownloadGrant;
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

export async function serveRestaurantAudio(
  request: Request,
  audioId: string,
  { verifyGrant = verifyAudioDownloadGrant, readObject = readFromR2 }: AudioAccessDependencies = {},
): Promise<Response> {
  const restaurantId = new URL(request.url).searchParams.get("restaurantId");
  const grantToken = request.headers.get("x-audio-grant");
  if (!restaurantId || !audioId) return response("Permintaan audio tidak valid.", 400);
  if (!grantToken) return response("Izin unduh audio tidak valid.", 401);

  const grant = verifyGrant(grantToken);
  if (!grant || grant.restaurantId !== restaurantId || grant.audioId !== audioId)
    return response("Izin unduh audio tidak valid.", 401);

  try {
    const bytes = await readObject(r2Key(restaurantId, audioId, grant.contentHash));
    if (bytes.byteLength !== grant.byteSize)
      return response("Audio tidak dapat diverifikasi.", 502);

    const body = new Uint8Array(bytes).buffer;
    return new Response(body, {
      status: 200,
      headers: {
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Length": String(bytes.byteLength),
        "Content-Type": "audio/mpeg",
        "X-Content-Hash": grant.contentHash,
        Vary: "X-Audio-Grant",
      },
    });
  } catch {
    return response("Layanan audio tidak tersedia.", 503);
  }
}
