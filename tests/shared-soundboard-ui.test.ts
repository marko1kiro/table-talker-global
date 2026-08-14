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
  expect(source).toContain("ANNOUNCEMENT_CATALOG.filter");
  expect(source).toContain('role="dialog"');
  expect(source).toContain('event.key === "Escape"');
  expect(source).toContain("event.target === event.currentTarget");
  expect(source).toContain("disabled={tableDisabled(audioId) || !availableAudioIds.has(audioId)}");
  expect(compactSource).toContain(
    "disabled={ announcementDisabled(audioId) || !availableAudioIds.has(audioId) }",
  );
});
