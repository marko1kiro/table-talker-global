import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { ANNOUNCEMENT_CATALOG, TABLE_AUDIO_IDS } from "../src/lib/remote-audio-domain";

const source = readFileSync(
  new URL("../src/components/SoundboardGrid.tsx", import.meta.url),
  "utf8",
);
const compactSource = source.replace(/\s+/g, " ");

it("keeps the announcement trigger at the default bottom position", () => {
  expect(compactSource).toContain("announcementTriggerElevated = false");
  expect(compactSource).toContain('announcementTriggerElevated ? "bottom-24" : "bottom-4"');
});

it("derives all table and categorized announcement controls from shared metadata", () => {
  expect(TABLE_AUDIO_IDS).toHaveLength(70);
  expect(ANNOUNCEMENT_CATALOG.filter(({ category }) => category === "INFO")).toHaveLength(3);
  expect(ANNOUNCEMENT_CATALOG.filter(({ category }) => category === "LARANGAN")).toHaveLength(3);
  expect(source).toContain("TABLE_AUDIO_IDS.map");
  expect(source).toContain("ANNOUNCEMENT_CATALOG.reduce");
  expect(source).not.toContain('["INFO", "LARANGAN"]');
  expect(source).toContain('role="dialog"');
  expect(source).toContain('event.key === "Escape"');
  expect(source).toContain("event.target === event.currentTarget");
  expect(source).toContain("disabled={tableDisabled(audioId) || !availableAudioIds.has(audioId)}");
  expect(compactSource).toContain(
    "disabled={ announcementDisabled(audioId) || !availableAudioIds.has(audioId) }",
  );
});

it("makes the crew route use the shared component and pass logical audio IDs", () => {
  const crew = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
  expect(crew).toContain('import { SoundboardGrid } from "@/components/SoundboardGrid"');
  expect(crew).toContain("<SoundboardGrid");
  expect(crew).toContain("onSelect={(audioId) =>");
  expect(crew).not.toContain("const announcementGroups = [");
  expect(crew).not.toContain("announcementPanelOpen");
  expect(crew).toContain("<Square");
});

it("makes Super Admin use immediate shared-grid selection without audio dropdown or Play button", () => {
  const admin = readFileSync(new URL("../src/routes/super-admin.tsx", import.meta.url), "utf8");
  expect(admin).toContain('import { SoundboardGrid } from "@/components/SoundboardGrid"');
  expect(admin).toContain("<SoundboardGrid");
  expect(admin).toContain("mutation.mutate(audioId)");
  expect(admin).toContain("onSelect={(audioId) =>");
  expect(admin).toContain("Pilih crew siap audio terlebih dahulu.");
  expect(admin).not.toContain("Pilih audio");
  expect(admin).not.toContain("Play audio");
});
