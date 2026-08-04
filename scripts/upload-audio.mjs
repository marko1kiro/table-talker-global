import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";

/**
 * Sinkronisasi audio ke Vercel Blob saat build (`prebuild`).
 *
 * ATURAN PENTING — dibuat setelah insiden 3 Agu 2026:
 * Sound nomor meja adalah KONTEN yang dikelola pemilik resto lewat halaman /manage.
 * Skrip build TIDAK BOLEH menyentuhnya. Versi lama skrip ini meng-upload seluruh
 * folder audio/ dengan allowOverwrite:true, sehingga setiap deploy menimpa 70 sound
 * meja di Blob dengan salinan lama yang ada di repo.
 *
 * Perilaku sekarang:
 *   - audio/announcements/  -> disinkron, TAPI hanya file yang belum ada di Blob.
 *   - audio/tables/         -> DILEWATI sama sekali secara default.
 *   - Tidak pernah menimpa file yang sudah ada di Blob.
 *
 * Escape hatch (harus disetel manual, jangan dipasang permanen di Vercel):
 *   AUDIO_SYNC_TABLES=1  -> ikut sinkron folder tables (tetap tidak menimpa).
 *                           Gunakan hanya untuk mengisi environment baru yang masih kosong.
 *   AUDIO_SYNC_FORCE=1   -> izinkan menimpa file yang sudah ada. DESTRUKTIF.
 *                           Hanya untuk reset audio yang benar-benar disengaja.
 */

const BLOB_PREFIX = "table-talker/";
const root = join(process.cwd(), "audio");

const includeTables = process.env.AUDIO_SYNC_TABLES === "1";
const force = process.env.AUDIO_SYNC_FORCE === "1";

async function walk(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    }),
  );
  return nested.flat();
}

/**
 * Penentu keputusan, dipisah agar bisa diuji tanpa kredensial Blob.
 * @param {string[]} relativePaths  path relatif terhadap folder audio/, pakai "/"
 * @param {Set<string>} existing    pathname yang sudah ada di Blob
 * @param {{includeTables:boolean, force:boolean}} opts
 */
export function planUploads(relativePaths, existing, opts) {
  const upload = [];
  const skipped = { tables: [], exists: [] };

  for (const relativePath of [...relativePaths].sort()) {
    const isTable = relativePath.startsWith("tables/");
    if (isTable && !opts.includeTables) {
      skipped.tables.push(relativePath);
      continue;
    }
    const pathname = `${BLOB_PREFIX}${relativePath}`;
    if (existing.has(pathname) && !opts.force) {
      skipped.exists.push(relativePath);
      continue;
    }
    upload.push({ relativePath, pathname, overwrite: existing.has(pathname) });
  }
  return { upload, skipped };
}

async function listExisting(list) {
  const existing = new Set();
  let cursor;
  do {
    const page = await list({ prefix: BLOB_PREFIX, cursor, limit: 1000 });
    for (const blob of page.blobs) existing.add(blob.pathname);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return existing;
}

async function main() {
  const files = (await walk(root)).filter((path) => extname(path).toLowerCase() === ".mp3");
  if (files.length === 0) {
    console.log("[audio-sync] Tidak ada MP3 di folder audio; dilewati.");
    return;
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN wajib tersedia untuk meng-upload audio saat build.");
  }

  const { list, put } = await import("@vercel/blob");
  const relativePaths = files.map((path) => relative(root, path).split(sep).join("/"));
  const byRelative = new Map(relativePaths.map((rel, i) => [rel, files[i]]));

  const existing = await listExisting(list);
  console.log(`[audio-sync] ${existing.size} file sudah ada di Blob.`);
  if (force) console.warn("[audio-sync] ⚠ AUDIO_SYNC_FORCE=1 — file yang ada AKAN ditimpa.");
  if (includeTables)
    console.warn("[audio-sync] ⚠ AUDIO_SYNC_TABLES=1 — folder tables ikut disinkron.");

  const { upload, skipped } = await planUploads(relativePaths, existing, { includeTables, force });

  if (skipped.tables.length) {
    console.log(
      `[audio-sync] ⏭ ${skipped.tables.length} sound meja dilewati (dikelola lewat halaman Kelola, tidak disentuh deploy).`,
    );
  }
  if (skipped.exists.length) {
    console.log(`[audio-sync] ⏭ ${skipped.exists.length} file dilewati karena sudah ada di Blob.`);
  }

  if (upload.length === 0) {
    console.log("[audio-sync] Tidak ada file baru. Selesai tanpa perubahan.");
    return;
  }

  console.log(`[audio-sync] Meng-upload ${upload.length} file baru…`);
  for (const item of upload) {
    await put(item.pathname, await readFile(byRelative.get(item.relativePath)), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: force,
      contentType: "audio/mpeg",
      cacheControlMaxAge: 60,
    });
    console.log(`[audio-sync] ${item.overwrite ? "⚠ ditimpa" : "✓ baru"} ${item.pathname}`);
  }
  console.log("[audio-sync] Selesai.");
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith("upload-audio.mjs");
if (invokedDirectly) await main();
