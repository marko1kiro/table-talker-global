import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

// Rename brand TABLE TALKER -> LIME: tidak boleh ada lagi brand lama di
// source, dan brand baru wajib hadir di halaman login owner + shell console.
// Cookie "table-talker-session" di auth.server.ts sengaja dipertahankan
// (identifier internal; rename = logout paksa semua sesi owner).
function listFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) files.push(...listFiles(full));
    else files.push(full.split(path.sep).join("/"));
  }
  return files;
}

const sourceFiles = listFiles("src").filter((file) => /\.(ts|tsx)$/.test(file));

it("no remaining TABLE TALKER brand text in src", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles) {
    const content = readFileSync(file, "utf8");
    if (/TABLE TALKER|Table Talker/i.test(content)) offenders.push(file);
  }
  expect(offenders).toEqual([]);
});

it("owner login and console shell carry the LIME brand", () => {
  const authGate = readFileSync(new URL("../src/components/AuthGate.tsx", import.meta.url), "utf8");
  expect(authGate).toContain(">LIME</p>");
  expect(authGate).toContain("/lime-logo.webp");
  expect(authGate).toContain("Panggilan meja & operasional resto");
  expect(authGate).toContain("Operasional resto yang cepat, jelas, dan terkendali.");

  const shell = readFileSync(
    new URL("../src/routes/super-admin/route.tsx", import.meta.url),
    "utf8",
  );
  expect(shell).toContain('title: "Owner Console - LIME"');
  expect(shell).toContain("/lime-logo.webp");
});

it("public pages use the LIME brand in metadata", () => {
  const landing = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
  expect(landing).toContain('title: "LIME — Panggilan Meja"');
  const helpMessage = readFileSync(new URL("../src/lib/help-message.ts", import.meta.url), "utf8");
  expect(helpMessage).toContain("*LAPORAN KENDALA LIME*");
});
