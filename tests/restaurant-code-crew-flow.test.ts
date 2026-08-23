import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const source = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

it("collects exact Kode Resto before crew name without client transformation or PIN", () => {
  const dialog = source("src/components/CrewIdentityDialog.tsx");
  expect(dialog).toContain("Kode Resto");
  expect(dialog).not.toContain("toUpperCase");
  expect(dialog).not.toContain("PIN");
  expect(dialog).not.toContain("restaurantCode");
  expect(dialog).toContain('setStep("name")');
});

it("blocks soundboard until sync and clears tenant state when version-bound access fails", () => {
  const page = source("src/routes/index.tsx");
  expect(page).toContain("!audioSynced");
  expect(page).toContain("removeCrewSessionIdentity(browserSessionStorage())");
  expect(page).toContain("audioControllerRef.current?.stop()");
  expect(page).toContain("setAudioSynced(false)");
  expect(page).toContain("setAvailableAudioIds(new Set())");
  const hook = source("src/hooks/use-remote-crew.ts");
  expect(hook).toContain("onSessionInvalid");
  expect(hook).toContain("client.removeChannel");
  expect(source("src/components/SyncDialog.tsx")).toContain("onSessionInvalid");
});
