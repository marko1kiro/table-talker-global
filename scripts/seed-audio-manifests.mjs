import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";

const RESTAURANT_ID = "33916a05-7e95-42fa-bc3c-050bed2402c5";
const CATALOG_VERSION = 1;
const ASSETS_DIR = join(import.meta.dirname, "../src/assets/audio");
const TABLES_DIR = join(ASSETS_DIR, "tables");
const ANNOUNCEMENTS_DIR = join(ASSETS_DIR, "announcements");

// R2
const R2_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.CF_R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.CF_R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.CF_R2_BUCKET || "soundboard";
const R2_PUBLIC_URL = process.env.CF_R2_PUBLIC_URL;

// Supabase
const SUPABASE_URL = "https://kjzxtmxdbcanvkgqqdow.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLL_KEY_STAGING;

if (!R2_ACCESS_KEY_ID || !SUPABASE_KEY) {
  console.error("Missing env vars. R2:", !!R2_ACCESS_KEY_ID, "Supabase:", !!SUPABASE_KEY);
  process.exit(1);
}

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}
function r2Key(audioId, hash) {
  return `restaurants/${RESTAURANT_ID}/${audioId.replace(":", "_")}/${hash}.mp3`;
}

const ANNOUNCEMENTS = {
  "seating.mp3": {
    id: "announcement:seating",
    label: "Himbauan Duduk Sesuai Nomor Meja",
    category: "INFO",
  },
  "himbauan-barang-bawaan-pelanggan.mp3": {
    id: "announcement:himbauan-barang-bawaan-pelanggan",
    label: "Himbauan Barang Bawaan Pelanggan",
    category: "INFO",
  },
  "jam-buka-resto.mp3": {
    id: "announcement:jam-buka-resto",
    label: "Informasi Jam Buka Tutup Resto",
    category: "INFO",
  },
  "outside-food.mp3": {
    id: "announcement:outside-food",
    label: "Dilarang Bawa Makanan Dari Luar",
    category: "LARANGAN",
  },
  "no-smoking.mp3": {
    id: "announcement:no-smoking",
    label: "Dilarang Merokok di Area Lobby",
    category: "LARANGAN",
  },
  "larangan-gabung-meja.mp3": {
    id: "announcement:larangan-gabung-meja",
    label: "Dilarang Gabungkan Meja",
    category: "LARANGAN",
  },
};

async function uploadAndRow(filePath, audioId, category, label, ordering) {
  const buf = readFileSync(filePath);
  const hash = sha256(buf);
  const byteSize = statSync(filePath).size;
  const key = r2Key(audioId, hash);
  const url = `${R2_PUBLIC_URL}/${key}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buf,
      ContentType: "audio/mpeg",
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );

  return {
    restaurant_id: RESTAURANT_ID,
    audio_id: audioId,
    label,
    category,
    r2_url: url,
    content_hash: hash,
    byte_size: byteSize,
    active: true,
    ordering,
    catalog_version: CATALOG_VERSION,
  };
}

async function main() {
  // 1. Delete old manifests
  console.log("Deleting old manifests...");
  const { error: delErr } = await db
    .from("audio_manifests")
    .delete()
    .eq("restaurant_id", RESTAURANT_ID)
    .eq("catalog_version", CATALOG_VERSION);
  if (delErr) {
    console.error("Delete error:", delErr);
    process.exit(1);
  }

  const rows = [];

  // 2. Upload table audio
  const tableFiles = readdirSync(TABLES_DIR)
    .filter((f) => f.endsWith(".mp3"))
    .sort((a, b) => parseInt(a) - parseInt(b));
  console.log(`Uploading ${tableFiles.length} table audio files...`);
  for (const file of tableFiles) {
    const num = parseInt(file.replace(".mp3", ""));
    const row = await uploadAndRow(
      join(TABLES_DIR, file),
      `table:${num}`,
      "BASE",
      `Meja ${num}`,
      num,
    );
    rows.push(row);
    if (num % 10 === 0) process.stdout.write(`${num} `);
  }
  console.log("\nTable audio done.");

  // 3. Upload announcement audio
  const announceFiles = readdirSync(ANNOUNCEMENTS_DIR).filter((f) => f.endsWith(".mp3"));
  console.log(`Uploading ${announceFiles.length} announcement audio files...`);
  let order = 100;
  for (const file of announceFiles) {
    const info = ANNOUNCEMENTS[file];
    if (!info) {
      console.warn(`Unknown: ${file}`);
      continue;
    }
    const row = await uploadAndRow(
      join(ANNOUNCEMENTS_DIR, file),
      info.id,
      info.category,
      info.label,
      order++,
    );
    rows.push(row);
  }
  console.log("Announcement audio done.");

  // 4. Batch insert (Supabase max 1000 rows per insert)
  console.log(`Inserting ${rows.length} manifests...`);
  const { error: insErr } = await db.from("audio_manifests").insert(rows);
  if (insErr) {
    console.error("Insert error:", insErr);
    process.exit(1);
  }

  console.log(`\nDone! ${rows.length} audio manifests seeded for CKRBUL.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
