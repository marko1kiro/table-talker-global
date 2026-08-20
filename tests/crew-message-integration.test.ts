import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const indexSource = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
const migrationSource = readFileSync(
  new URL("../supabase/migrations/20260821000000_fix_crew_message_realtime.sql", import.meta.url),
  "utf8",
);

it("grants authenticated crew access only to targeted messages", () => {
  expect(migrationSource).toMatch(/grant select on public\.crew_messages to authenticated/i);
  expect(migrationSource).toMatch(
    /create policy "crew reads targeted messages"[\s\S]*target_session_id = auth\.uid\(\)/i,
  );
});

it("renders the crew message overlay when active", () => {
  expect(indexSource).toContain("useCrewMessage(identityHydrated)");
  expect(indexSource).toContain("CrewMessageOverlay");
  expect(indexSource).toContain("crewMessage.dismiss");
});
