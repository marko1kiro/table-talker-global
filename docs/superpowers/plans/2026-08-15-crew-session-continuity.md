# Crew Session Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve one crew identity and anonymous Supabase session through same-tab refreshes while safely restoring presence and audio activation state.

**Architecture:** Add a browser-safe identity/storage module that owns validated crew-name persistence and a sessionStorage-backed Supabase auth adapter. Hydrate the crew route from that module with `audioReady: false`; the existing remote hook claims the restored UID and reconnects only after Realtime subscribes. Extend server snapshot classification to emit online/recent sessions, then make Super Admin render disabled non-selectable rows while pure selection state immediately clears invalid targets.

**Tech Stack:** React 19, TypeScript, TanStack Start/React Query, Supabase JS 2, Vitest Node, ESLint, Vite.

---

## File Structure

- Create: `src/lib/crew-session-identity.ts` — sessionStorage-safe validated crew identity read/write/remove helpers and a storage adapter factory.
- Modify: `src/lib/supabase-browser.ts` — configure the lazy browser client with the session-scoped auth adapter, `persistSession: true`, and `autoRefreshToken: true`.
- Modify: `src/components/CrewIdentityDialog.tsx` — remove the dialog-only `CrewIdentity` type so route hydration can use the shared identity type.
- Modify: `src/routes/index.tsx` — hydrate saved identity before rendering, persist only validated names after `LANJUT!!`, reset readiness after refresh, and retain local soundboard fail-open behavior.
- Modify: `src/hooks/use-remote-crew.ts` — reconnect with a newly created channel after foreground return/terminal state, while preserving subscribed-before-connected heartbeat and no command replay/retry.
- Modify: `src/lib/remote-audio-domain.ts` — define server-safe online/recent/expired snapshot classification from freshness, connection, visibility, and audio readiness.
- Modify: `src/lib/remote-audio.server.ts` — omit expired crew rows and return snapshot state plus eligibility.
- Modify: `src/lib/super-admin-state.ts` — make target selection require `state === "online"`, eligibility, and audio readiness.
- Modify: `src/routes/super-admin.tsx` — show selectable online-ready rows and disabled online-unready/recent rows with required status labels.
- Modify: `docs/supabase-super-admin-remote-audio.md` — document same-tab session boundary, 30-second online/three-hour recent snapshot semantics, and preserved no-replay behavior.
- Modify: `tests/supabase-browser.test.ts` — test adapter configuration and isolated same-tab/new-tab storage behavior.
- Create: `tests/crew-session-identity.test.ts` — pure identity storage validation, malformed-data cleanup, and storage-exception fallback tests.
- Modify: `tests/use-remote-crew.test.ts` — test restored UID reuse, foreground resubscribe ordering, and no replay/retry behavior.
- Modify: `tests/remote-audio-domain.test.ts` — test online/recent/expired classification boundaries.
- Modify: `tests/remote-audio-server.test.ts` — test snapshot filtering/classification source behavior without a browser environment.
- Modify: `tests/super-admin-route.test.ts` — test recent/unready display eligibility and synchronous selected-target clearing.
- Modify: `tests/audio-unlock.test.ts` — add source-level route assertions that restored hydration starts audio unready and exposes the recovery button.

### Task 1: Add safe session-scoped crew identity helpers

**Files:**
- Create: `src/lib/crew-session-identity.ts`
- Create: `tests/crew-session-identity.test.ts`

- [ ] **Step 1: Write failing pure identity helper tests**

Create `tests/crew-session-identity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createSessionStorageAdapter,
  readCrewSessionIdentity,
  removeCrewSessionIdentity,
  writeCrewSessionIdentity,
} from "../src/lib/crew-session-identity";

function storage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

describe("crew session identity", () => {
  it("round-trips only normalized validated identity", () => {
    const session = storage();
    const identity = { displayName: "  Crew   Pagi ", normalizedName: "ignored" };

    expect(writeCrewSessionIdentity(session, identity)).toEqual({
      displayName: "Crew Pagi",
      normalizedName: "crew pagi",
    });
    expect(readCrewSessionIdentity(session)).toEqual({
      displayName: "Crew Pagi",
      normalizedName: "crew pagi",
    });
  });

  it("removes malformed, mismatched, and invalid stored identity", () => {
    for (const value of ["{", JSON.stringify({ displayName: "", normalizedName: "" }), JSON.stringify({ displayName: "Crew", normalizedName: "other" })]) {
      const session = storage({ "table-talker.crew-identity": value });
      expect(readCrewSessionIdentity(session)).toBeNull();
      expect(session.getItem("table-talker.crew-identity")).toBeNull();
    }
  });

  it("fails open when storage access throws", () => {
    const unavailable = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    };

    expect(readCrewSessionIdentity(unavailable)).toBeNull();
    expect(writeCrewSessionIdentity(unavailable, { displayName: "Crew", normalizedName: "crew" })).toBeNull();
    expect(() => removeCrewSessionIdentity(unavailable)).not.toThrow();
  });

  it("keeps each session adapter isolated", () => {
    const first = createSessionStorageAdapter(storage());
    const second = createSessionStorageAdapter(storage());

    first.setItem("supabase.auth.token", "same-tab-user");
    expect(first.getItem("supabase.auth.token")).toBe("same-tab-user");
    expect(second.getItem("supabase.auth.token")).toBeNull();
  });
});
```

- [ ] **Step 2: Run identity tests to verify failure**

Run: `npx vitest run tests/crew-session-identity.test.ts`

Expected: FAIL with `Failed to load url ../src/lib/crew-session-identity`.

- [ ] **Step 3: Implement the minimal safe helpers**

Create `src/lib/crew-session-identity.ts`:

```ts
import { normalizeCrewName } from "./remote-audio-domain";

export const CREW_SESSION_IDENTITY_KEY = "table-talker.crew-identity";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type CrewSessionIdentity = {
  displayName: string;
  normalizedName: string;
};

export function readCrewSessionIdentity(storage: StorageLike | null): CrewSessionIdentity | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(CREW_SESSION_IDENTITY_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as { displayName?: unknown; normalizedName?: unknown };
    if (typeof value.displayName !== "string" || typeof value.normalizedName !== "string") {
      storage.removeItem(CREW_SESSION_IDENTITY_KEY);
      return null;
    }
    const normalized = normalizeCrewName(value.displayName);
    if ("error" in normalized || normalized.normalizedName !== value.normalizedName) {
      storage.removeItem(CREW_SESSION_IDENTITY_KEY);
      return null;
    }
    return normalized;
  } catch {
    try {
      storage.removeItem(CREW_SESSION_IDENTITY_KEY);
    } catch {}
    return null;
  }
}

export function writeCrewSessionIdentity(
  storage: StorageLike | null,
  identity: CrewSessionIdentity,
): CrewSessionIdentity | null {
  const normalized = normalizeCrewName(identity.displayName);
  if ("error" in normalized || !storage) return null;
  try {
    storage.setItem(CREW_SESSION_IDENTITY_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    return null;
  }
}

export function removeCrewSessionIdentity(storage: StorageLike | null) {
  try {
    storage?.removeItem(CREW_SESSION_IDENTITY_KEY);
  } catch {}
}

export function createSessionStorageAdapter(storage: StorageLike | null): StorageLike {
  return {
    getItem: (key) => {
      try {
        return storage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    setItem: (key, value) => {
      try {
        storage?.setItem(key, value);
      } catch {}
    },
    removeItem: (key) => {
      try {
        storage?.removeItem(key);
      } catch {}
    },
  };
}

export function browserSessionStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run identity tests to verify pass**

Run: `npx vitest run tests/crew-session-identity.test.ts`

Expected: PASS with 4 tests.

- [ ] **Step 5: Commit the helper and tests**

```bash
git add src/lib/crew-session-identity.ts tests/crew-session-identity.test.ts
git commit -m "feat: persist crew identity per tab"
```

Expected: one commit containing only the two listed files. Do not stage unrelated unstaged `.gitignore`.

### Task 2: Persist Supabase auth in sessionStorage

**Files:**
- Modify: `src/lib/supabase-browser.ts:1-13`
- Modify: `tests/supabase-browser.test.ts:1-6`

- [ ] **Step 1: Write failing Supabase configuration tests**

Replace `tests/supabase-browser.test.ts` with:

```ts
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createSessionStorageAdapter } from "../src/lib/crew-session-identity";

const source = readFileSync(new URL("../src/lib/supabase-browser.ts", import.meta.url), "utf8");

it("uses the safe sessionStorage auth adapter with persistence and refresh enabled", () => {
  expect(source).toContain("createSessionStorageAdapter(browserSessionStorage())");
  expect(source).toContain("persistSession: true");
  expect(source).toContain("autoRefreshToken: true");
});

it("returns null rather than throwing for unavailable browser storage", () => {
  const adapter = createSessionStorageAdapter(null);
  expect(adapter.getItem("supabase.auth.token")).toBeNull();
  expect(() => adapter.setItem("supabase.auth.token", "token")).not.toThrow();
  expect(() => adapter.removeItem("supabase.auth.token")).not.toThrow();
});
```

- [ ] **Step 2: Run Supabase tests to verify failure**

Run: `npx vitest run tests/supabase-browser.test.ts`

Expected: FAIL because the client currently uses `persistSession: false` and `autoRefreshToken: false`.

- [ ] **Step 3: Configure the client with the adapter**

Replace `src/lib/supabase-browser.ts` with:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { browserSessionStorage, createSessionStorageAdapter } from "./crew-session-identity";

let client: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  client ??= createClient(url, anonKey, {
    auth: {
      storage: createSessionStorageAdapter(browserSessionStorage()),
      persistSession: true,
      autoRefreshToken: true,
    },
  });
  return client;
}
```

- [ ] **Step 4: Run Supabase tests to verify pass**

Run: `npx vitest run tests/supabase-browser.test.ts`

Expected: PASS with 2 tests.

- [ ] **Step 5: Commit session-scoped auth configuration**

```bash
git add src/lib/supabase-browser.ts tests/supabase-browser.test.ts
git commit -m "feat: scope Supabase auth to browser session"
```

Expected: one commit containing only the two listed files. Do not stage `.gitignore`.

### Task 3: Hydrate crew identity without restoring audio readiness

**Files:**
- Modify: `src/components/CrewIdentityDialog.tsx:5-22`
- Modify: `src/routes/index.tsx:1-25,62-141,220-246`
- Modify: `tests/audio-unlock.test.ts`

- [ ] **Step 1: Write failing hydration/source tests**

Append to `tests/audio-unlock.test.ts`:

```ts
it("hydrates a same-tab crew without persisting audio readiness", () => {
  const route = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");

  expect(route).toContain("readCrewSessionIdentity(browserSessionStorage())");
  expect(route).toContain("audioReady: false");
  expect(route).toContain("writeCrewSessionIdentity(browserSessionStorage(), identity)");
  expect(route).toContain("Aktifkan Suara");
});
```

- [ ] **Step 2: Run audio tests to verify failure**

Run: `npx vitest run tests/audio-unlock.test.ts`

Expected: FAIL because the route has no session identity hydration or persistence.

- [ ] **Step 3: Share the non-audio identity type**

In `src/components/CrewIdentityDialog.tsx`, replace the `CrewIdentity` declaration and its `onContinue` type with:

```tsx
import type { CrewSessionIdentity } from "@/lib/crew-session-identity";

export type CrewIdentity = CrewSessionIdentity & { audioReady: boolean };
```

Keep the successful submit payload exactly:

```tsx
onContinue({ ...result, audioReady });
```

- [ ] **Step 4: Hydrate and persist only validated name identity**

In `src/routes/index.tsx`, add:

```tsx
import {
  browserSessionStorage,
  readCrewSessionIdentity,
  writeCrewSessionIdentity,
} from "@/lib/crew-session-identity";
```

Replace the crew identity state declaration with:

```tsx
const [crewIdentity, setCrewIdentity] = useState<CrewIdentity | null>(() => {
  const identity = readCrewSessionIdentity(browserSessionStorage());
  return identity && { ...identity, audioReady: false };
});
```

Replace the dialog `onContinue` callback with:

```tsx
onContinue={(identity) => {
  setDuplicateName(false);
  const saved = writeCrewSessionIdentity(browserSessionStorage(), identity);
  setCrewIdentity({ ...(saved ?? identity), audioReady: identity.audioReady });
}}
```

Retain the existing unlock button, but preserve the fresh gesture state transition exactly:

```tsx
void unlockAudio().then((audioReady) => {
  setCrewIdentity({ ...crewIdentity, audioReady });
  remoteCrew.retryAudioUnlock();
});
```

Do not write any audio-ready value to `sessionStorage`. Do not change local manual playback behavior when Supabase/auth/storage is unavailable.

- [ ] **Step 5: Run audio tests to verify pass**

Run: `npx vitest run tests/audio-unlock.test.ts`

Expected: PASS, including the new hydration test.

- [ ] **Step 6: Commit refresh hydration**

```bash
git add src/components/CrewIdentityDialog.tsx src/routes/index.tsx tests/audio-unlock.test.ts
git commit -m "feat: restore crew name after refresh"
```

Expected: one commit containing only the three listed files. Do not stage `.gitignore`.

### Task 4: Preserve UID claim and foreground reconnect semantics

**Files:**
- Modify: `src/hooks/use-remote-crew.ts:16-120,281-445`
- Modify: `tests/use-remote-crew.test.ts:1-122,305-357`

- [ ] **Step 1: Write failing pure reconnection and UID tests**

Add `canReconnectPresence` to the import list in `tests/use-remote-crew.test.ts`, then append:

```ts
it("uses a restored authenticated UID without anonymous sign-in", async () => {
  const signInAnonymously = vi.fn();
  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "restored-crew" } } }),
      signInAnonymously,
    },
  };

  await expect(getAnonymousUserId(client as never)).resolves.toBe("restored-crew");
  expect(signInAnonymously).not.toHaveBeenCalled();
});

it("reconnects only from a visible page", () => {
  expect(canReconnectPresence("visible")).toBe(true);
  expect(canReconnectPresence("hidden")).toBe(false);
});

it("does not make hidden or missed commands replayable after reconnect", async () => {
  const playRemoteAudio = vi.fn().mockResolvedValue(undefined);
  const processor = createRemoteCommandProcessor({
    sessionId: "crew-1",
    playRemoteAudio,
    acknowledge: vi.fn().mockResolvedValue(undefined),
    now: () => Date.parse("2026-08-12T10:00:08.000Z"),
  });

  await processor.process(command);
  expect(playRemoteAudio).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run remote crew tests to verify failure**

Run: `npx vitest run tests/use-remote-crew.test.ts`

Expected: FAIL because `canReconnectPresence` is not exported.

- [ ] **Step 3: Add the visible reconnect guard**

Add directly after `canSendConnectedHeartbeat` in `src/hooks/use-remote-crew.ts`:

```ts
export function canReconnectPresence(visibilityState: string) {
  return visibilityState === "visible";
}
```

- [ ] **Step 4: Recreate the Realtime channel after foreground/terminal loss**

In the effect beginning at `src/hooks/use-remote-crew.ts:281`, replace the channel creation guard and visibility handling so `claimWhenVisible` can remove a terminal channel and claim/re-subscribe again:

```ts
const onVisibilityChange = () => {
  if (document.visibilityState === "visible") {
    if (channel) void client.removeChannel(channel);
    channel = null;
    channelTerminal = false;
    presenceActive = false;
    if (canReconnectPresence(document.visibilityState)) void claimWhenVisible();
    return;
  }
  if (!channelTerminal) disconnect();
};
```

Replace the first line of `claimWhenVisible` with:

```ts
if (!userId || document.visibilityState !== "visible" || (channel && !channelTerminal) || claimInFlight)
  return;
```

In the terminal status branch, retain the disconnected heartbeat and add channel disposal before setting offline:

```ts
channelTerminal = true;
stopHeartbeat();
disconnect();
if (channel) void client.removeChannel(channel);
channel = null;
presenceActive = false;
```

Keep these existing invariants unchanged:

```ts
if (shouldActivatePresence(status)) {
  update(setOffline, false);
  if (active) setConnectionState("online");
  activatePresence();
  return;
}
```

```ts
if (!isVisible()) return;
```

```ts
if (!commandIsProcessable(...)) return;
```

This retains: same restored UID via `client.auth.getUser()`, claim-before-subscribe, subscribed-before-connected heartbeat, background disconnection, five-second expiry, processed-command deduplication, and no retry/replay.

- [ ] **Step 5: Run remote crew tests to verify pass**

Run: `npx vitest run tests/use-remote-crew.test.ts`

Expected: PASS with existing processor tests plus the 3 new cases.

- [ ] **Step 6: Commit presence reconnection**

```bash
git add src/hooks/use-remote-crew.ts tests/use-remote-crew.test.ts
git commit -m "fix: reconnect crew presence on foreground"
```

Expected: one commit containing only the two listed files. Do not stage `.gitignore`.

### Task 5: Classify admin snapshots as online, recent, or expired

**Files:**
- Modify: `src/lib/remote-audio-domain.ts:22-73`
- Modify: `src/lib/remote-audio.server.ts:12-20,73-86,101-115`
- Modify: `tests/remote-audio-domain.test.ts`
- Modify: `tests/remote-audio-server.test.ts`

- [ ] **Step 1: Write failing classification tests**

Append to `tests/remote-audio-domain.test.ts`:

```ts
it("classifies fresh visible connected crews as online, recent crews through three hours, and omits expired crews", () => {
  const now = Date.parse("2026-08-15T12:00:00.000Z");
  const base = {
    connectionState: "connected" as const,
    visibilityState: "visible" as const,
    audioReady: true,
  };

  expect(classifyCrewSession({ ...base, lastSeen: "2026-08-15T11:59:30.000Z" }, now)).toBe("online");
  expect(classifyCrewSession({ ...base, lastSeen: "2026-08-15T11:59:29.999Z" }, now)).toBe("recent");
  expect(classifyCrewSession({ ...base, lastSeen: "2026-08-15T09:00:00.000Z" }, now)).toBe("recent");
  expect(classifyCrewSession({ ...base, lastSeen: "2026-08-15T08:59:59.999Z" }, now)).toBe("expired");
  expect(classifyCrewSession({ ...base, audioReady: false, lastSeen: "2026-08-15T11:59:30.000Z" }, now)).toBe("online");
  expect(classifyCrewSession({ ...base, visibilityState: "hidden", lastSeen: "2026-08-15T11:59:30.000Z" }, now)).toBe("recent");
});
```

Append to `tests/remote-audio-server.test.ts`:

```ts
it("maps snapshot sessions through online/recent filtering before returning them", () => {
  expect(server()).toContain("classifyCrewSession");
  expect(server()).toContain('state === "expired"');
  expect(server()).toContain("state,");
});
```

Add `classifyCrewSession` to the domain test import list.

- [ ] **Step 2: Run focused classification tests to verify failure**

Run: `npx vitest run tests/remote-audio-domain.test.ts tests/remote-audio-server.test.ts`

Expected: FAIL because `classifyCrewSession` is not exported and snapshots return every database row.

- [ ] **Step 3: Define the snapshot state in the shared domain module**

In `src/lib/remote-audio-domain.ts`, add after `ONLINE_WINDOW_MS`:

```ts
export const RECENT_WINDOW_MS = 3 * 60 * 60 * 1_000;
export type CrewSessionState = "online" | "recent" | "expired";
```

Add after `sessionIsEligible`:

```ts
export function classifyCrewSession(
  session: Omit<CrewSessionEligibility, "audioReady">,
  now: number,
): CrewSessionState {
  const seen = Date.parse(session.lastSeen);
  if (!Number.isFinite(seen) || seen > now || now - seen > RECENT_WINDOW_MS) return "expired";
  return session.connectionState === "connected" &&
    session.visibilityState === "visible" &&
    now - seen <= ONLINE_WINDOW_MS
    ? "online"
    : "recent";
}
```

`audioReady` remains separate from state: a fresh connected visible crew can be `online` but not command-eligible.

- [ ] **Step 4: Filter expired rows and retain state in the server response**

In `src/lib/remote-audio.server.ts`, import `classifyCrewSession`. Replace `withEligibility` with:

```ts
function withSnapshotState(sessions: CrewSessionRow[], now: number) {
  return sessions.flatMap((session) => {
    const state = classifyCrewSession(
      {
        connectionState: session.connection_state,
        visibilityState: session.visibility_state,
        lastSeen: session.last_seen,
      },
      now,
    );
    if (state === "expired") return [];
    return [{
      ...session,
      state,
      eligible: state === "online" && sessionIsEligible(
        {
          audioReady: session.audio_ready,
          connectionState: session.connection_state,
          visibilityState: session.visibility_state,
          lastSeen: session.last_seen,
        },
        now,
      ),
    }];
  });
}
```

Replace `sessions: withEligibility(sessions, now),` with:

```ts
sessions: withSnapshotState(sessions, now),
```

Do not alter `create_remote_command`, command expiry, cleanup, schemas, or migrations.

- [ ] **Step 5: Run focused classification tests to verify pass**

Run: `npx vitest run tests/remote-audio-domain.test.ts tests/remote-audio-server.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit snapshot classification**

```bash
git add src/lib/remote-audio-domain.ts src/lib/remote-audio.server.ts tests/remote-audio-domain.test.ts tests/remote-audio-server.test.ts
git commit -m "feat: retain recently active crew snapshots"
```

Expected: one commit containing only the four listed files. Do not stage `.gitignore`.

### Task 6: Render non-selectable recent and audio-unready targets

**Files:**
- Modify: `src/lib/super-admin-state.ts:1-33`
- Modify: `src/routes/super-admin.tsx:99-170`
- Modify: `tests/super-admin-route.test.ts:60-94`

- [ ] **Step 1: Write failing target-state tests**

Replace the `sessions` fixture in `tests/super-admin-route.test.ts` with this typed shape in the existing stale-target test, then append the new test:

```ts
it("clears selected targets synchronously unless online and audio-ready", () => {
  const sessions = [
    { id: "ready", state: "online" as const, eligible: true, audioReady: true },
    { id: "unready", state: "online" as const, eligible: false, audioReady: false },
    { id: "recent", state: "recent" as const, eligible: false, audioReady: true },
  ];

  expect(reconcileRemoteSelection("ready", sessions)).toBe("ready");
  expect(reconcileRemoteSelection("unready", sessions)).toBe("");
  expect(reconcileRemoteSelection("recent", sessions)).toBe("");
  expect(getSelectedRemoteTarget("recent", sessions)).toBeUndefined();
});

it("renders disabled online-unready and recent options", () => {
  const source = readFileSync(new URL("../src/routes/super-admin.tsx", import.meta.url), "utf8");

  expect(source).toContain("Aktifkan suara di perangkat");
  expect(source).toContain("Offline / terakhir aktif");
  expect(source).toContain("disabled={!session.eligible}");
});
```

Update every existing `RemoteTarget` fixture in this test file to include `state: "online"` unless the test explicitly asserts another state.

- [ ] **Step 2: Run Super Admin tests to verify failure**

Run: `npx vitest run tests/super-admin-route.test.ts`

Expected: FAIL because `RemoteTarget` has no `state` and the route filters disabled rows out.

- [ ] **Step 3: Require online state in pure selection helpers**

Replace the `RemoteTarget` declaration in `src/lib/super-admin-state.ts` with:

```ts
export type RemoteTarget = {
  id: string;
  state: "online" | "recent";
  eligible: boolean;
  audioReady: boolean;
};
```

Replace `getSelectedRemoteTarget` with:

```ts
export function getSelectedRemoteTarget(
  targetSessionId: string,
  sessions: readonly RemoteTarget[],
): RemoteTarget | undefined {
  return sessions.find(
    (session) =>
      session.id === targetSessionId &&
      session.state === "online" &&
      session.eligible &&
      session.audioReady,
  );
}
```

Keep `reconcileRemoteSelection` delegating to `getSelectedRemoteTarget`; this is the synchronous clear path used whenever a snapshot changes.

- [ ] **Step 4: Render all non-expired targets with native disabled options**

In both `sessions.map` calls that construct selection inputs to `reconcileRemoteSelection` and `getSelectedRemoteTarget` in `src/routes/super-admin.tsx`, include:

```tsx
state: session.state,
```

Replace the current filtered option block with:

```tsx
{sessions.map((session) => {
  const disabled = !session.eligible;
  const status =
    session.state === "recent"
      ? `Offline / terakhir aktif ${new Date(session.last_seen).toLocaleString("id-ID")}`
      : session.audio_ready
        ? "Online dan siap audio"
        : "Aktifkan suara di perangkat";
  return (
    <option key={session.id} value={session.id} disabled={disabled}>
      {session.display_name} — {session.device_description} — {status}
    </option>
  );
})}
```

Leave `<select disabled={offline}>` intact. Do not allow a recent or audio-unready row through `getSelectedRemoteTarget`, `remoteCommandRequest`, or `canSelectRemoteAudio`; retain server-side RPC eligibility as the race-condition authority.

- [ ] **Step 5: Run Super Admin tests to verify pass**

Run: `npx vitest run tests/super-admin-route.test.ts`

Expected: PASS with current tests plus new state/markup assertions.

- [ ] **Step 6: Commit target availability UI**

```bash
git add src/lib/super-admin-state.ts src/routes/super-admin.tsx tests/super-admin-route.test.ts
git commit -m "feat: show offline crew as recent targets"
```

Expected: one commit containing only the three listed files. Do not stage `.gitignore`.

### Task 7: Document session boundary and operational behavior

**Files:**
- Modify: `docs/supabase-super-admin-remote-audio.md:30-32`

- [ ] **Step 1: Write the documentation update**

Append this paragraph to `docs/supabase-super-admin-remote-audio.md`:

```md
Crew display identity and anonymous Supabase auth are stored only in browser `sessionStorage`: a refresh in the same tab restores the UID and validated name, while a closed/new tab or restarted browser session does not. Audio readiness is never stored; after refresh the crew must tap `Aktifkan Suara` before a subscribed heartbeat reports `audio_ready = true`. Admin snapshots show fresh connected visible sessions as online for 30 seconds, retain all other sessions with `last_seen` at most three hours as disabled `Offline / terakhir aktif` targets, and omit older rows. Foreground return creates a new Realtime subscription before publishing connected presence. Commands retain their five-second TTL and are never retried or replayed after backgrounding or reconnecting.
```

- [ ] **Step 2: Verify documentation scope**

Run: `git diff --check -- docs/supabase-super-admin-remote-audio.md`

Expected: exit code 0 with no whitespace errors.

- [ ] **Step 3: Commit documentation**

```bash
git add docs/supabase-super-admin-remote-audio.md
git commit -m "docs: explain crew session continuity"
```

Expected: one commit containing only the documentation file. Do not stage `.gitignore`.

### Task 8: Full verification and manual mobile checks

**Files:**
- Verify only; do not modify `src/routeTree.gen.ts`.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test`

Expected: PASS; all Vitest Node tests green.

- [ ] **Step 2: Run TypeScript validation**

Run: `npx tsc --noEmit`

Expected: exit code 0.

- [ ] **Step 3: Run lint**

Run: `npm run lint`

Expected: exit code 0.

- [ ] **Step 4: Run production build**

Run: `npm run build`

Expected: exit code 0; Vite production build completes.

- [ ] **Step 5: Check generated routing and working tree boundaries**

Run: `git status --short && git diff --check && git diff -- src/routeTree.gen.ts .gitignore`

Expected: no changes to `src/routeTree.gen.ts`; `.gitignore` remains the pre-existing unrelated unstaged modification and is not staged; no whitespace errors.

- [ ] **Step 6: Manually verify Android Chrome**

1. Open an authenticated dashboard tab; enter a valid crew name; verify soundboard plays after `LANJUT!!`.
2. Refresh the same tab; verify the name dialog is skipped, `Aktifkan Suara` is visible, local controls remain usable, and Super Admin displays the crew disabled until activation.
3. Tap `Aktifkan Suara`; verify the same tab becomes selectable only after the crew Realtime subscription is online and a heartbeat reports readiness.
4. Background/lock the device for more than 30 seconds; verify Super Admin changes the crew to disabled `Offline / terakhir aktif` and remote controls clear/disable.
5. Foreground/unlock; verify the crew remains disabled until Realtime re-subscribes, then becomes selectable after reactivating sound; send one remote command and verify one playback only.
6. Close the tab, open a new tab; verify the name dialog returns and no prior crew identity is reused.

Expected: all six checks behave exactly as listed; no remote command is replayed after foregrounding.

- [ ] **Step 7: Manually verify iOS Safari**

Repeat Android steps 1-6 in Safari, including a refresh, app background/lock, foreground reconnect, audio reactivation, one remote command, then tab close/new tab.

Expected: same-tab identity restoration only, explicit post-refresh audio activation, recent/offline status during backgrounding, and no replay/retry.

## Self-Review

- [ ] **Spec coverage:** Tasks 1-3 cover safe `sessionStorage`, validated same-tab identity hydration, custom persisted Supabase auth, restored UID claim, fail-open manual soundboard, and unpersisted audio readiness. Task 4 covers subscribed-before-connected foreground reconnection and no command replay/retry. Tasks 5-6 cover online/recent/expired snapshot behavior, disabled target display, synchronous selection clearing, and authoritative server eligibility. Task 7 records operational behavior. Task 8 covers full automated checks plus Android/iOS refresh, new-tab, lock/background, return, activation, last-seen, and remote playback checks. No migration, new table, schema change, command retry, or replay is planned.
- [ ] **Placeholder scan:** Run `rg -n "TBD|TODO|implement later|fill in details|appropriate error handling|Similar to Task" docs/superpowers/plans/2026-08-15-crew-session-continuity.md`.

Expected: no matches.

- [ ] **Type consistency:** Confirm `CrewSessionIdentity`, `CrewIdentity`, `CrewSessionState`, `RemoteTarget`, `classifyCrewSession`, `createSessionStorageAdapter`, and `canReconnectPresence` match the signatures in Tasks 1-6; run `npx tsc --noEmit` again after any correction.
