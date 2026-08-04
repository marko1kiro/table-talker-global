import { createServerFn } from "@tanstack/react-start";
import { upload } from "@vercel/blob/client";

export const TABLE_COUNT = 70;
export const BLOB_PREFIX = "table-talker/tables/";
export const ANNOUNCEMENT_PREFIX = "table-talker/announcements/";
export type AnnouncementId = "seating" | "outside-food" | "no-smoking" | "jam-buka-resto";

export interface TableAudioEntry {
  tableNumber: number;
  url: string;
  size: number;
  uploadedAt: string;
}

export function fileNameFor(tableNumber: number): string {
  return `${tableNumber}.mp3`;
}

export function tableNumberFromFileName(name: string): number | null {
  const match = name.match(/^(\d+)\.(mp3)$/i);
  if (!match) return null;
  const number = Number.parseInt(match[1], 10);
  return number >= 1 && number <= TABLE_COUNT ? number : null;
}

function tableNumberFromPathname(pathname: string): number | null {
  if (!pathname.startsWith(BLOB_PREFIX)) return null;
  return tableNumberFromFileName(pathname.slice(BLOB_PREFIX.length));
}

const getAudioCatalog = createServerFn({ method: "GET" }).handler(
  async (): Promise<TableAudioEntry[]> => {
    const [{ list }, { requireDashboard }] = await Promise.all([
      import("@vercel/blob"),
      import("./auth.server"),
    ]);
    await requireDashboard();

    if (!process.env.BLOB_READ_WRITE_TOKEN) return [];

    const entries: TableAudioEntry[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: BLOB_PREFIX, cursor, limit: 1000 });
      for (const blob of page.blobs) {
        const tableNumber = tableNumberFromPathname(blob.pathname);
        if (tableNumber !== null) {
          entries.push({
            tableNumber,
            url: blob.url,
            size: blob.size,
            uploadedAt: blob.uploadedAt.toISOString(),
          });
        }
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);

    return entries.sort((a, b) => a.tableNumber - b.tableNumber);
  },
);

const getAnnouncementCatalog = createServerFn({ method: "GET" }).handler(
  async (): Promise<Record<AnnouncementId, string | null>> => {
    const [{ list }, { requireDashboard }] = await Promise.all([
      import("@vercel/blob"),
      import("./auth.server"),
    ]);
    await requireDashboard();

    const result: Record<AnnouncementId, string | null> = {
      seating: null,
      "outside-food": null,
      "no-smoking": null,
      "jam-buka-resto": null,
    };
    if (!process.env.BLOB_READ_WRITE_TOKEN) return result;

    const page = await list({ prefix: ANNOUNCEMENT_PREFIX, limit: 100 });
    for (const blob of page.blobs) {
      const name = blob.pathname.slice(ANNOUNCEMENT_PREFIX.length);
      if (name === "seating.mp3") result.seating = blob.url;
      if (name === "outside-food.mp3") result["outside-food"] = blob.url;
      if (name === "no-smoking.mp3") result["no-smoking"] = blob.url;
      if (name === "jam-buka-resto.mp3") result["jam-buka-resto"] = blob.url;
    }
    return result;
  },
);

const deleteAudio = createServerFn({ method: "POST" })
  .inputValidator((tableNumber: number) => tableNumber)
  .handler(async ({ data: tableNumber }) => {
    const [{ del, list }, { requireManage }] = await Promise.all([
      import("@vercel/blob"),
      import("./auth.server"),
    ]);
    await requireManage();
    if (tableNumber < 1 || tableNumber > TABLE_COUNT) {
      return { error: "Nomor meja tidak valid." };
    }

    const result = await list({ prefix: `${BLOB_PREFIX}${tableNumber}.` });
    const exact = result.blobs.filter(
      (blob) => tableNumberFromPathname(blob.pathname) === tableNumber,
    );
    if (exact.length) await del(exact.map((blob) => blob.url));
    return { error: null };
  });

export async function getAnnouncementAudioUrls(): Promise<Record<AnnouncementId, string | null>> {
  return getAnnouncementCatalog();
}

export async function listReadyTables(): Promise<Set<number>> {
  const catalog = await getAudioCatalog();
  return new Set(catalog.map((entry) => entry.tableNumber));
}

export async function getTableAudioUrl(tableNumber: number): Promise<string | null> {
  const catalog = await getAudioCatalog();
  return catalog.find((entry) => entry.tableNumber === tableNumber)?.url ?? null;
}

export async function getTableAudioUrls(tableNumbers: number[]): Promise<Map<number, string>> {
  const wanted = new Set(tableNumbers);
  const catalog = await getAudioCatalog();
  return new Map(
    catalog
      .filter((entry) => wanted.has(entry.tableNumber))
      .map((entry) => [entry.tableNumber, entry.url]),
  );
}

export async function uploadTableAudio(
  tableNumber: number,
  file: File,
): Promise<{ error: string | null }> {
  if (tableNumber < 1 || tableNumber > TABLE_COUNT) {
    return { error: "Nomor meja tidak valid." };
  }
  if (file.size > 25 * 1024 * 1024) {
    return { error: "Ukuran file maksimal 25 MB." };
  }

  try {
    await upload(`${BLOB_PREFIX}${tableNumber}.mp3`, file, {
      access: "public",
      handleUploadUrl: "/api/blob-upload",
      contentType: file.type || "audio/mpeg",
      multipart: file.size > 5 * 1024 * 1024,
      clientPayload: JSON.stringify({ tableNumber }),
    });
    return { error: null };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Upload gagal.",
    };
  }
}

export async function deleteTableAudio(tableNumber: number): Promise<{ error: string | null }> {
  try {
    return await deleteAudio({ data: tableNumber });
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Hapus audio gagal.",
    };
  }
}
