/**
 * Uji pengaman sinkronisasi audio — TIDAK menyentuh Vercel Blob asli.
 * Memakai stub modul @vercel/blob, jadi aman dijalankan kapan saja tanpa kredensial.
 *
 * Pakai:  node test-audio-sync.mjs /path/ke/table-talker
 * Keluar dengan kode 1 kalau ada skenario yang gagal.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const repo = process.argv[2] ?? process.cwd();
const script = join(repo, "scripts", "upload-audio.mjs");
if (!existsSync(script)) {
  console.error(`Tidak menemukan ${script}. Berikan path root project sebagai argumen.`);
  process.exit(1);
}

const dir = "/tmp/audio-sync-test";
rmSync(dir, { recursive: true, force: true });
for (const d of ["scripts", "audio/tables", "audio/announcements", "node_modules/@vercel/blob"]) {
  mkdirSync(join(dir, d), { recursive: true });
}
copyFileSync(script, join(dir, "scripts/upload-audio.mjs"));

const TABLES = ["1", "2", "3"];
const ANNS = ["seating", "outside-food", "no-smoking", "jam-buka-resto"];
for (const n of TABLES) writeFileSync(join(dir, `audio/tables/${n}.mp3`), `MEJA-${n}-REPO-LAMA`);
for (const a of ANNS) writeFileSync(join(dir, `audio/announcements/${a}.mp3`), `ANN-${a}`);

writeFileSync(
  join(dir, "node_modules/@vercel/blob/package.json"),
  JSON.stringify({
    name: "@vercel/blob",
    version: "0.0.0-stub",
    type: "module",
    exports: { ".": "./index.js" },
  }),
);
writeFileSync(
  join(dir, "node_modules/@vercel/blob/index.js"),
  `import { appendFileSync, readFileSync } from "node:fs";
const state = JSON.parse(readFileSync(process.env.STUB_STATE, "utf8"));
export async function list({ prefix }) {
  return { blobs: state.existing.filter((p) => p.startsWith(prefix)).map((p) => ({ pathname: p })), hasMore: false };
}
export async function put(pathname) {
  appendFileSync(process.env.STUB_LOG, "PUT " + pathname + "\\n");
  return { url: "https://blob.test/" + pathname };
}
`,
);

const blobAll = [
  ...TABLES.map((n) => `table-talker/tables/${n}.mp3`),
  ...ANNS.slice(0, 3).map((a) => `table-talker/announcements/${a}.mp3`),
];

function run({ existing, env = {} }) {
  writeFileSync(join(dir, "state.json"), JSON.stringify({ existing }));
  writeFileSync(join(dir, "put.log"), "");
  const out = execFileSync("node", ["scripts/upload-audio.mjs"], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
      BLOB_READ_WRITE_TOKEN: "dummy",
      STUB_STATE: join(dir, "state.json"),
      STUB_LOG: join(dir, "put.log"),
    },
  });
  const puts = readFileSync(join(dir, "put.log"), "utf8").trim().split("\n").filter(Boolean);
  return { out, puts };
}

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "LULUS" : "GAGAL"}  ${name}${ok ? "" : `\n       ${detail}`}`);
  if (!ok) failed++;
}

// 1. Deploy fitur baru: hanya pengumuman baru yang naik, meja tidak tersentuh.
{
  const { puts } = run({ existing: blobAll });
  check(
    "deploy fitur baru hanya meng-upload pengumuman baru",
    puts.length === 1 && puts[0].endsWith("announcements/jam-buka-resto.mp3"),
    `puts=${JSON.stringify(puts)}`,
  );
  check(
    "nol sentuhan ke sound meja",
    !puts.some((p) => p.includes("/tables/")),
    `puts=${JSON.stringify(puts)}`,
  );
}

// 2. Deploy ulang tanpa perubahan: nol upload (idempoten).
{
  const { puts } = run({ existing: [...blobAll, "table-talker/announcements/jam-buka-resto.mp3"] });
  check(
    "deploy ulang tidak meng-upload apa pun",
    puts.length === 0,
    `puts=${JSON.stringify(puts)}`,
  );
}

// 3. Sound meja yang sudah dihapus lewat /manage tidak dihidupkan ulang.
{
  const existing = [...blobAll, "table-talker/announcements/jam-buka-resto.mp3"].filter(
    (p) => p !== "table-talker/tables/2.mp3",
  );
  const { puts } = run({ existing });
  check(
    "sound meja yang dihapus tidak dibangkitkan ulang",
    puts.length === 0,
    `puts=${JSON.stringify(puts)}`,
  );
}

// 4. Environment baru & kosong bisa di-seed dengan AUDIO_SYNC_TABLES=1.
{
  const { puts } = run({ existing: [], env: { AUDIO_SYNC_TABLES: "1" } });
  check(
    "environment kosong bisa di-seed penuh dengan flag",
    puts.length === TABLES.length + ANNS.length,
    `puts=${puts.length}, harusnya ${TABLES.length + ANNS.length}`,
  );
}

// 5. Tanpa flag, environment kosong hanya mengisi pengumuman.
{
  const { puts } = run({ existing: [] });
  check(
    "tanpa flag, tables tetap dilewati walau Blob kosong",
    puts.length === ANNS.length && !puts.some((p) => p.includes("/tables/")),
    `puts=${JSON.stringify(puts)}`,
  );
}

console.log(failed === 0 ? "\nSEMUA SKENARIO LULUS" : `\n${failed} SKENARIO GAGAL`);
process.exit(failed === 0 ? 0 : 1);
