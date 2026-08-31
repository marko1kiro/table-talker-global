import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = () =>
  readFileSync(new URL("../src/components/RoleLoginFlow.tsx", import.meta.url), "utf8");

describe("RoleLoginFlow: step 1 - Kode Resto (plain text, no masking)", () => {
  it("renders the restaurant code field as plain visible text, never masked", () => {
    const text = source();
    expect(text).not.toMatch(/type=["']password["']/);
    expect(text).toContain('id="restaurant-code"');
  });

  it("reuses validateRestaurantCode and loginToRestaurant unchanged", () => {
    const text = source();
    expect(text).toContain('import { validateRestaurantCode } from "@/lib/restaurant-domain"');
    expect(text).toContain('import { loginToRestaurant } from "@/lib/restaurants.server"');
    expect(text).toContain("loginToRestaurant({ data:");
  });
});

describe("RoleLoginFlow: step 2 - confirmation dialog", () => {
  it("shows the exact confirmation copy with the restaurant's display name and YA/TIDAK actions", () => {
    const text = source();
    expect(text).toContain("Apakah kamu login ke Resto");
    expect(text).toContain("YA");
    expect(text).toContain("TIDAK");
  });

  it("TIDAK discards the tenant token and returns to step 1 with a cleared code field", () => {
    const text = source();
    expect(text).toMatch(/setStep\(\s*"code"\s*\)/);
    expect(text).toContain('setCode("")');
    expect(text).toContain("setLogin(null)");
  });

  it("YA advances to the role picker without any server call", () => {
    const text = source();
    expect(text).toMatch(/setStep\(\s*"role"\s*\)/);
  });
});

describe("RoleLoginFlow: step 3 - role picker (exactly 4 roles)", () => {
  it("imports the canonical 4-role order and label map from role-session-domain", () => {
    const text = source();
    expect(text).toMatch(
      /CREW_ROLE_LABELS,?\s*\n?\s*CREW_ROLE_ORDER,?\s*\n?\s*jakartaCheckedInAtToIso/,
    );
    expect(text).toMatch(/}\s*from\s*"@\/lib\/role-session-domain"/);
    expect(text).toContain("CREW_ROLE_ORDER.map");
  });

  it("never hardcodes a role list separately from CREW_ROLE_ORDER", () => {
    const text = source();
    expect(text).not.toMatch(/\[\s*"ss"\s*,\s*"kasir"\s*,\s*"satgas"\s*,\s*"clear_up"\s*\]/);
  });
});

describe("RoleLoginFlow: step 4 - manual Nama + Tanggal & Jam Masuk (all 4 roles, never pre-filled)", () => {
  it("initializes the name field to an empty string, never auto-generated for any role", () => {
    const text = source();
    expect(text).not.toContain("autoCrewName");
    expect(text).toMatch(
      /useState\(\s*""\s*\)[^;]*;?\s*\/\/\s*name|const \[name, setName\] = useState\(""\)/,
    );
  });

  it("initializes checked-in date/time to an empty string, never pre-filled with the current time", () => {
    const text = source();
    expect(text).not.toContain("new Date().toISOString()");
    expect(text).not.toMatch(/useState\(\s*new Date\(\)/);
    expect(text).toContain('const [checkedInAt, setCheckedInAt] = useState("")');
  });

  it("uses a datetime-local input and converts it via jakartaCheckedInAtToIso before submitting", () => {
    const text = source();
    expect(text).toContain('type="datetime-local"');
    expect(text).toContain("jakartaCheckedInAtToIso(checkedInAt)");
  });

  it("reuses normalizeCrewName for manual name validation, same as the SS-only flow used to", () => {
    const text = source();
    expect(text).toContain('import { normalizeCrewName } from "@/lib/remote-audio-domain"');
    expect(text).toContain("normalizeCrewName(name)");
  });
});

describe("RoleLoginFlow: step 5 - claim session and hand off to caller", () => {
  it("calls claimRoleSession with the manually entered values, unmodified", () => {
    const text = source();
    expect(text).toContain('import { claimRoleSession } from "@/lib/role-session.server"');
    expect(text).toMatch(/claimRoleSession\(\{\s*data:/);
    expect(text).toMatch(/\brole,/);
    expect(text).toMatch(/displayName:\s*normalized\.displayName/);
    expect(text).toMatch(/checkedInAt:\s*iso/);
  });

  it("obtains a per-device anonymous-auth access token before calling claimRoleSession", () => {
    const text = source();
    expect(text).toContain(
      'import { ensureAnonAccessToken, getSupabaseBrowserClient } from "@/lib/supabase-browser"',
    );
    expect(text).toContain("ensureAnonAccessToken(getSupabaseBrowserClient())");
    expect(text).toMatch(/\baccessToken,/);
  });

  it("never calls the SS-only claim_crew_session RPC or any remote-audio/heartbeat mechanism (Option B: SS session model unchanged)", () => {
    const text = source();
    expect(text).not.toMatch(/rpc\(\s*["']claim_crew_session["']/);
    expect(text).not.toContain("claimCrewSession");
    expect(text).not.toContain("heartbeat");
  });

  it("hands SS off via onSsContinue with the same CrewIdentity shape the page already expects", () => {
    const text = source();
    expect(text).toContain("onSsContinue");
    expect(text).toContain('crewSessionId: ""');
    expect(text).toContain('crewSessionToken: ""');
  });

  it("hands the other 3 roles off via onRoleContinue instead of rendering the soundboard", () => {
    const text = source();
    expect(text).toContain("onRoleContinue");
  });

  it("no longer uses the getClientKey() localStorage pattern (rate limiting was removed)", () => {
    const text = source();
    expect(text).not.toContain("function getClientKey()");
    expect(text).not.toContain("table-talker.login-client-key");
    expect(text).not.toContain("const clientKey = getClientKey();");
    expect(text).toContain("loginToRestaurant({ data: { code } })");
  });

  it("keeps the audio-unlock call site out of this component (stays in index.tsx per the plan)", () => {
    const text = source();
    expect(text).not.toContain("unlockBundledAudio");
  });
});

describe("RoleLoginFlow: never shows removed remote-audio/heartbeat copy", () => {
  it("never contains the deprecated remote control unavailable copy", () => {
    const text = source();
    expect(text).not.toContain("Remote control tidak tersedia. Soundboard tetap bisa dipakai.");
    expect(text).not.toContain("remoteCrew.offline");
  });
});
