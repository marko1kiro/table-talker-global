import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

it("uses createFileRoute for the /help route with SEO metadata", () => {
  const page = source("../src/routes/help.tsx");
  expect(page).toContain('createFileRoute("/help")');
  expect(page).toContain('{ title: "Bantuan — Table Talker" }');
  expect(page).toContain('{ property: "og:url", content: "/help" }');
  expect(page).toContain('{ rel: "canonical", href: "/help" }');
});

it("builds the WhatsApp URL from the shared help-message domain module", () => {
  const page = source("../src/routes/help.tsx");
  expect(page).toContain('import { buildWhatsAppHelpUrl } from "@/lib/help-message"');
  expect(page).toContain("buildWhatsAppHelpUrl(trimmedCode, trimmedName, trimmedIssue)");
  expect(page).not.toContain("wa.me");
  expect(page).toContain('window.open(url, "_blank", "noopener,noreferrer")');
});

it("collects Kode Resto, Nama Crew, and a free-text issue description", () => {
  const page = source("../src/routes/help.tsx");
  expect(page).toContain('id="help-restaurant-code"');
  expect(page).toContain('id="help-crew-name"');
  expect(page).toContain('id="help-issue"');
  expect(page).toContain("Jelaskan masalah/kendala yang muncul");
});

it("trims and rejects whitespace-only fields before submitting", () => {
  const page = source("../src/routes/help.tsx");
  expect(page).toContain("restaurantCode.trim()");
  expect(page).toContain("crewName.trim()");
  expect(page).toContain("issue.trim()");
  expect(page).toContain("!trimmedCode || !trimmedName || !trimmedIssue");
  expect(page).toContain("Semua kolom wajib diisi ya bos.");
});

it("renders the shared Header and Footer for consistent navigation", () => {
  const page = source("../src/routes/help.tsx");
  expect(page).toContain('import { Header } from "@/components/Header"');
  expect(page).toContain('import { Footer } from "@/components/Footer"');
  expect(page).toContain("<Header readyCount={0} totalCount={0} />");
  expect(page).toContain("<Footer />");
});
