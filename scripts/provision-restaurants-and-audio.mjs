// One-time provisioning script: creates/updates restaurants and uploads their
// audio catalog (table:1-100 + 6 announcements) to R2 + Supabase audio_manifests.
//
// Usage: node scripts/provision-restaurants-and-audio.mjs
// Requires .env (gitignored) with SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// RESTAURANT_CODE_ENCRYPTION_KEY, CF_ACCOUNT_ID, CF_R2_ACCESS_KEY_ID,
// CF_R2_SECRET_ACCESS_KEY, CF_R2_BUCKET, CF_R2_PUBLIC_URL.
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  hashRestaurantCode,
  encryptRestaurantCode,
  parseRestaurantCodeEncryptionKey,
} from "../src/lib/restaurant-code.server.ts";
import { validateRestaurantCode } from "../src/lib/restaurant-domain.ts";

// ---- load .env ----
const envPath = new URL("../.env", import.meta.url);
if (existsSync(envPath)) {
  const envText = readFileSync(envPath, "utf8");
  for (const line of envText.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_R2_ACCESS_KEY_ID = process.env.CF_R2_ACCESS_KEY_ID;
const CF_R2_SECRET_ACCESS_KEY = process.env.CF_R2_SECRET_ACCESS_KEY;
const CF_R2_BUCKET = process.env.CF_R2_BUCKET ?? "soundboard";
const CF_R2_PUBLIC_URL = process.env.CF_R2_PUBLIC_URL ?? "https://static.xdirga.xyz";

for (const [name, value] of Object.entries({
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  CF_ACCOUNT_ID,
  CF_R2_ACCESS_KEY_ID,
  CF_R2_SECRET_ACCESS_KEY,
})) {
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
}

const encryptionKey = parseRestaurantCodeEncryptionKey(
  process.env.RESTAURANT_CODE_ENCRYPTION_KEY ?? "",
);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: CF_R2_ACCESS_KEY_ID,
    secretAccessKey: CF_R2_SECRET_ACCESS_KEY,
  },
});

// ---- static audio catalog metadata (matches ANNOUNCEMENT_CATALOG) ----
const ANNOUNCEMENT_META = {
  seating: { label: "Himbauan Duduk Sesuai Nomor Meja", category: "INFO", ordering: 105 },
  "himbauan-barang-bawaan-pelanggan": {
    label: "Himbauan Barang Bawaan Pelanggan",
    category: "INFO",
    ordering: 100,
  },
  "jam-buka-resto": {
    label: "Informasi Jam Buka Tutup Resto",
    category: "INFO",
    ordering: 101,
  },
  "outside-food": { label: "Dilarang Bawa Makanan Dari Luar", category: "LARANGAN", ordering: 104 },
  "no-smoking": { label: "Dilarang Merokok di Area Lobby", category: "LARANGAN", ordering: 103 },
  "larangan-gabung-meja": { label: "Dilarang Gabungkan Meja", category: "LARANGAN", ordering: 102 },
};

const WORK_DIR = "/tmp/seed-work";

// ---- per-restaurant announcement file slug used in the ZIP filenames ----
const RESTAURANTS = [
  {
    displayName: "Mie Gacoan Bantar Gebang Sétu",
    code: "BKSBAN",
    slug: "bantar-gebang-setu",
    action: "create",
  },
  {
    displayName: "Mie Gacoan Cut Mutia",
    code: "BKSMUT",
    slug: "cut-mutia",
    action: "create",
  },
  {
    displayName: "Mie Gacoan M.H. Thamrin",
    code: "CKRTHA",
    slug: "mh-thamrin",
    action: "create",
  },
  {
    displayName: "Mie Gacoan Tarum Barat",
    code: "CKRTAR",
    slug: "tarum-barat",
    action: "create",
  },
  {
    displayName: "Mie Gacoan R.E. Martadinata",
    code: "CKRMAR",
    slug: "re-martadinata",
    action: "create",
  },
  {
    displayName: "Mie Gacoan Cikoronjo Cibarusah",
    code: "CKRCIK",
    slug: "cikoronjo-cibarusah",
    action: "create",
  },
  {
    displayName: "Mie Gacoan Kampung Bulu",
    code: "CKRBUL",
    slug: "kampung-bulu",
    action: "replace",
    restaurantId: "33916a05-7e95-42fa-bc3c-050bed2402c5",
    hasJamBuka: true,
  },
  {
    displayName: "Mie Gacoan Golden City",
    code: "BKSGOL",
    slug: "golden-city",
    action: "create",
  },
  {
    displayName: "Mie Gacoan Bosih Raya",
    code: "CKRBOS",
    slug: "bosih-raya",
    action: "rotate-code",
    restaurantId: "fa2dea0f-8c68-4c2f-bb72-17c34825c61e",
  },
];

// filename patterns per announcement, per the extracted ZIP folder structure
const ANNOUNCEMENT_FILE_CANDIDATES = {
  "himbauan-barang-bawaan-pelanggan": (slug) => [
    `${WORK_DIR}/pengumuman/barang bawaan/himbauan-barang-bawaan-pelanggan-${slug}-v1.mp3`,
    `${WORK_DIR}/pengumuman/barang bawaan/himbauan-barang-bawaan-pelanggan-${slug}-v2.mp3`,
    `${WORK_DIR}/pengumuman/barang bawaan/pengumuman-barang-bawaan-${slug}.mp3`,
  ],
  "no-smoking": (slug) => [
    `${WORK_DIR}/pengumuman/dilarang merokok/dilarang-merokok-di-area-lobby-${slug}-v1.mp3`,
    `${WORK_DIR}/pengumuman/dilarang merokok/dilarang-merokok-di-area-lobby-${slug}-v2.mp3`,
  ],
  "outside-food": (slug) => [
    `${WORK_DIR}/pengumuman/makan dan minuman dari luar/himbauan-duduk-sesuai-nomor-meja-${slug}-v1.mp3`,
    `${WORK_DIR}/pengumuman/makan dan minuman dari luar/himbauan-duduk-sesuai-nomor-meja-${slug}-v2.mp3`,
  ],
  "larangan-gabung-meja": (slug) => [
    `${WORK_DIR}/pengumuman/dilarang gabungkan meja/dilarang-gabungkan-meja-${slug}-v1.mp3`,
    `${WORK_DIR}/pengumuman/dilarang gabungkan meja/dilarang-gabungkan-meja-${slug}-v2.mp3`,
  ],
};

function resolveAnnouncementFile(audioId, slug) {
  const candidates = ANNOUNCEMENT_FILE_CANDIDATES[audioId](slug);
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return null;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function r2Key(restaurantId, audioId, hash) {
  return `restaurants/${restaurantId}/${audioId.replace(":", "_")}/${hash}.mp3`;
}

async function uploadToR2(restaurantId, audioId, buffer) {
  const hash = sha256(buffer);
  const key = r2Key(restaurantId, audioId, hash);
  await s3.send(
    new PutObjectCommand({
      Bucket: CF_R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: "audio/mpeg",
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  return {
    contentHash: hash,
    byteSize: buffer.length,
    r2Url: `${CF_R2_PUBLIC_URL}/${key}`,
  };
}

async function ensureRestaurant(entry) {
  if (entry.action === "create") {
    // Idempotent: if a restaurant with this exact display_name already exists
    // (e.g. from a previous interrupted run), reuse it instead of creating a duplicate.
    const { data: existing } = await supabase
      .from("restaurants")
      .select("id")
      .eq("display_name", entry.displayName)
      .maybeSingle();
    if (existing) {
      console.log(`[exists] ${entry.displayName} -> ${existing.id} (skipping credential creation)`);
      return existing.id;
    }
    const id = randomUUID();
    const validated = validateRestaurantCode(entry.code);
    if (!("code" in validated)) throw new Error(`INVALID_CODE:${entry.code}`);
    const { error } = await supabase.from("restaurants").insert({
      id,
      code_hash: hashRestaurantCode(validated.code, encryptionKey),
      code_encrypted: encryptRestaurantCode(validated.code, id, encryptionKey),
      code_version: 1,
      credential_rotated_at: new Date().toISOString(),
      display_name: entry.displayName,
    });
    if (error) throw new Error(`CREATE_FAILED:${entry.displayName}:${error.message}`);
    console.log(`[created] ${entry.displayName} -> ${id}`);
    return id;
  }

  if (entry.action === "rotate-code") {
    const { data: restaurant, error: lookupError } = await supabase
      .from("restaurants")
      .select("id, code_version")
      .eq("id", entry.restaurantId)
      .single();
    if (lookupError || !restaurant) throw new Error(`LOOKUP_FAILED:${entry.displayName}`);
    const validated = validateRestaurantCode(entry.code);
    if (!("code" in validated)) throw new Error(`INVALID_CODE:${entry.code}`);
    const { error } = await supabase.rpc("rotate_restaurant_credentials", {
      p_restaurant_id: restaurant.id,
      p_code_hash: hashRestaurantCode(validated.code, encryptionKey),
      p_code_encrypted: encryptRestaurantCode(validated.code, restaurant.id, encryptionKey),
      p_next_code_version: restaurant.code_version + 1,
    });
    if (error) throw new Error(`ROTATE_FAILED:${entry.displayName}:${error.message}`);
    console.log(`[rotated-code] ${entry.displayName} -> ${restaurant.id}`);
    return restaurant.id;
  }

  if (entry.action === "replace") {
    console.log(`[replace] ${entry.displayName} -> ${entry.restaurantId} (audio only, code untouched)`);
    return entry.restaurantId;
  }

  throw new Error(`UNKNOWN_ACTION:${entry.action}`);
}

async function upsertManifestRow(restaurantId, audioId, label, category, ordering, asset) {
  const { error } = await supabase.from("audio_manifests").upsert(
    {
      restaurant_id: restaurantId,
      audio_id: audioId,
      label,
      category,
      r2_url: asset.r2Url,
      content_hash: asset.contentHash,
      byte_size: asset.byteSize,
      active: true,
      ordering,
      catalog_version: 1,
    },
    { onConflict: "restaurant_id,audio_id,catalog_version" },
  );
  if (error) throw new Error(`MANIFEST_UPSERT_FAILED:${restaurantId}:${audioId}:${error.message}`);
}

async function main() {
  console.log(`Loaded ${RESTAURANTS.length} restaurant entries.`);

  // preload shared global audio buffers once
  const seatingBuffer = readFileSync(`${WORK_DIR}/duduk-sesuai-nomor-meja.mp3`);
  const jamBukaBuffer = readFileSync(`${WORK_DIR}/jam-buka-resto.mp3`);
  const tableBuffers = [];
  for (let i = 1; i <= 100; i++) {
    tableBuffers.push(readFileSync(`${WORK_DIR}/meja/${i}.mp3`));
  }
  console.log("Preloaded shared audio buffers (seating, jam-buka-resto, 100 table files).");

  for (const entry of RESTAURANTS) {
    console.log(`\n=== ${entry.displayName} (${entry.code}) ===`);
    const restaurantId = await ensureRestaurant(entry);

    // Idempotent resume: if this restaurant already has the full expected manifest
    // count from a previous (possibly interrupted) run, skip it entirely.
    const expectedCount = 1 /* seating */ + (entry.hasJamBuka ? 1 : 0) + 4 /* per-resto announcements */ + 100 /* tables */;
    const { count: existingCount } = await supabase
      .from("audio_manifests")
      .select("*", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId);
    if (existingCount === expectedCount) {
      console.log(`  [skip-complete] already has ${existingCount}/${expectedCount} manifest rows`);
      continue;
    }
    console.log(`  [resume] currently ${existingCount ?? 0}/${expectedCount} manifest rows`);

    // For "replace" (CKRBUL), we must overwrite every row's content unconditionally,
    // so never treat existing audio_ids as already-done for that restaurant.
    let doneAudioIds = new Set();
    if (entry.action !== "replace") {
      const { data: doneRows } = await supabase
        .from("audio_manifests")
        .select("audio_id")
        .eq("restaurant_id", restaurantId);
      doneAudioIds = new Set((doneRows ?? []).map((row) => row.audio_id));
    }

    // 1) seating (global, same content for all restaurants)
    if (doneAudioIds.has("announcement:seating")) {
      console.log("  [skip] announcement:seating (already provisioned)");
    } else {
      const asset = await uploadToR2(restaurantId, "announcement:seating", seatingBuffer);
      await upsertManifestRow(
        restaurantId,
        "announcement:seating",
        ANNOUNCEMENT_META.seating.label,
        ANNOUNCEMENT_META.seating.category,
        ANNOUNCEMENT_META.seating.ordering,
        asset,
      );
      console.log("  [ok] announcement:seating");
    }

    // 2) jam-buka-resto — only for Kampung Bulu per instructions
    if (!entry.hasJamBuka) {
      console.log("  [skip] announcement:jam-buka-resto (not provided for this restaurant)");
    } else if (doneAudioIds.has("announcement:jam-buka-resto")) {
      console.log("  [skip] announcement:jam-buka-resto (already provisioned)");
    } else {
      const asset = await uploadToR2(restaurantId, "announcement:jam-buka-resto", jamBukaBuffer);
      await upsertManifestRow(
        restaurantId,
        "announcement:jam-buka-resto",
        ANNOUNCEMENT_META["jam-buka-resto"].label,
        ANNOUNCEMENT_META["jam-buka-resto"].category,
        ANNOUNCEMENT_META["jam-buka-resto"].ordering,
        asset,
      );
      console.log("  [ok] announcement:jam-buka-resto");
    }

    // 3) per-restaurant announcements (barang bawaan, no-smoking, outside-food, gabung-meja)
    for (const audioId of [
      "himbauan-barang-bawaan-pelanggan",
      "no-smoking",
      "outside-food",
      "larangan-gabung-meja",
    ]) {
      if (doneAudioIds.has(`announcement:${audioId}`)) {
        console.log(`  [skip] announcement:${audioId} (already provisioned)`);
        continue;
      }
      const filePath = resolveAnnouncementFile(audioId, entry.slug);
      if (!filePath) {
        console.warn(`  [MISSING] announcement:${audioId} for slug=${entry.slug}`);
        continue;
      }
      const buffer = readFileSync(filePath);
      const asset = await uploadToR2(restaurantId, `announcement:${audioId}`, buffer);
      await upsertManifestRow(
        restaurantId,
        `announcement:${audioId}`,
        ANNOUNCEMENT_META[audioId].label,
        ANNOUNCEMENT_META[audioId].category,
        ANNOUNCEMENT_META[audioId].ordering,
        asset,
      );
      console.log(`  [ok] announcement:${audioId} <- ${filePath.split("/").pop()}`);
    }

    // 4) table:1..100 (global, same content for all restaurants)
    let tablesUploaded = 0;
    let tablesSkipped = 0;
    for (let i = 1; i <= 100; i++) {
      if (doneAudioIds.has(`table:${i}`)) {
        tablesSkipped++;
        continue;
      }
      const asset = await uploadToR2(restaurantId, `table:${i}`, tableBuffers[i - 1]);
      await upsertManifestRow(restaurantId, `table:${i}`, `Meja ${i}`, "BASE", i, asset);
      tablesUploaded++;
    }
    console.log(`  [ok] table:1..100 (uploaded ${tablesUploaded}, skipped ${tablesSkipped} already-done)`);
  }

  console.log("\nDone.");
}

main().catch((error) => {
  console.error("PROVISIONING_FAILED:", error);
  process.exitCode = 1;
});
