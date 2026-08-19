# Screen Wake Lock Auto-on — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Run commands one at a time, not combined with `&&`.

**Goal:** Menjaga layar perangkat crew tetap menyala otomatis selama halaman soundboard dibuka, tanpa perubahan UI apa pun.

**Architecture:** Split pure logic (`src/lib/screen-wake-lock.ts`) dari React binding (`src/hooks/use-screen-wake-lock.ts`), integrasi satu baris di `SoundboardPage`. Pure decision `visibleWakeLockState` = satu source of truth; request/release di-wrapper silent-catch. Tanpa dependency baru, pakai native `navigator.wakeLock`.

**Tech Stack:** React 19, TypeScript, Vitest (node env tanpa jsdom), TanStack Start.

**Spec:** `docs/superpowers/specs/2026-08-20-screen-wake-lock-design.md`

---

## Task 1: Pure decision `visibleWakeLockState`

**Files:**
- Create: `src/lib/screen-wake-lock.ts`
- Test: `tests/screen-wake-lock.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { visibleWakeLockState } from "../src/lib/screen-wake-lock";

describe("visibleWakeLockState", () => {
  it("requests when active and no sentinel while visible", () => {
    expect(visibleWakeLockState({ active: true, sentinelActive: false, visibility: "visible" })).toBe("request");
  });

  it("skips re-request when a sentinel is already active", () => {
    expect(visibleWakeLockState({ active: true, sentinelActive: true, visibility: "visible" })).toBe("none");
  });

  it("never requests while the tab is hidden", () => {
    expect(visibleWakeLockState({ active: true, sentinelActive: false, visibility: "hidden" })).toBe("none");
    expect(visibleWakeLockState({ active: true, sentinelActive: true, visibility: "hidden" })).toBe("none");
  });

  it("releases when deactivated and a sentinel exists", () => {
    expect(visibleWakeLockState({ active: false, sentinelActive: true, visibility: "visible" })).toBe("release");
  });

  it("does nothing when deactivated without a sentinel", () => {
    expect(visibleWakeLockState({ active: false, sentinelActive: false, visibility: "visible" })).toBe("none");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/screen-wake-lock.test.ts`
Expected: FAIL (module `/src/lib/screen-wake-lock` tidak ada / function undefined).

- [ ] **Step 3: Write minimal implementation**

`src/lib/screen-wake-lock.ts`:

```ts
export type WakeLockAction = "request" | "release" | "none";

export function visibleWakeLockState({
  active,
  sentinelActive,
  visibility,
}: {
  active: boolean;
  sentinelActive: boolean;
  visibility: string;
}): WakeLockAction {
  if (!active && sentinelActive) return "release";
  if (active && !sentinelActive && visibility === "visible") return "request";
  return "none";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/screen-wake-lock.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/screen-wake-lock.ts tests/screen-wake-lock.test.ts
git commit -m "feat: add wake lock visibility decision"
```

## Task 2: Request/release wrappers

**Files:**
- Modify: `src/lib/screen-wake-lock.ts`
- Test: `tests/screen-wake-lock.test.ts`

- [ ] **Step 1: Add failing tests**

Append ke `tests/screen-wake-lock.test.ts`:

```ts
import { afterEach, expect } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestScreenWakeLock", () => {
  it("requests the screen wake lock when supported", async () => {
    const sentinel = { release: vi.fn() };
    const request = vi.fn().mockResolvedValue(sentinel);
    vi.stubGlobal("navigator", { wakeLock: { request } });

    const result = await requestScreenWakeLock();

    expect(request).toHaveBeenCalledWith("screen");
    expect(result).toBe(sentinel);
  });

  it("returns null when the API is unsupported", async () => {
    vi.stubGlobal("navigator", {});

    const result = await requestScreenWakeLock();

    expect(result).toBeNull();
  });

  it("returns null silently when the request is rejected", async () => {
    const request = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { wakeLock: { request } });

    const result = await requestScreenWakeLock();

    expect(result).toBeNull();
  });
});

describe("releaseScreenWakeLock", () => {
  it("releases the sentinel", () => {
    const sentinel = { release: vi.fn() };

    releaseScreenWakeLock(sentinel);

    expect(sentinel.release).toHaveBeenCalledOnce();
  });

  it("does nothing for a null sentinel", () => {
    expect(() => releaseScreenWakeLock(null)).not.toThrow();
  });
});
```

Update import baris 1 jadi:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  releaseScreenWakeLock,
  requestScreenWakeLock,
  visibleWakeLockState,
} from "../src/lib/screen-wake-lock";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/screen-wake-lock.test.ts`
Expected: FAIL (`requestScreenWakeLock` / `releaseScreenWakeLock` undefined).

- [ ] **Step 3: Write minimal implementation**

Append ke `src/lib/screen-wake-lock.ts`:

```ts
export type WakeLockSentinelLike = { release(): Promise<void> };

type WakeLockLike = { request(type: "screen"): Promise<WakeLockSentinelLike> };

type NavigatorWithWakeLock = Navigator & { wakeLock?: WakeLockLike };

export async function requestScreenWakeLock(): Promise<WakeLockSentinelLike | null> {
  const wakeLock = (navigator as NavigatorWithWakeLock).wakeLock;
  if (!wakeLock) return null;
  try {
    return await wakeLock.request("screen");
  } catch {
    return null;
  }
}

export function releaseScreenWakeLock(sentinel: WakeLockSentinelLike | null | undefined) {
  if (!sentinel) return;
  void sentinel.release();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/screen-wake-lock.test.ts`
Expected: 10 passed (5 decision + 3 request + 2 release), tidak ada error tipe.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS, bersih.

- [ ] **Step 6: Commit**

```bash
git add src/lib/screen-wake-lock.ts tests/screen-wake-lock.test.ts
git commit -m "feat: wrap wake lock request and release silently"
```

## Task 3: Hook `useScreenWakeLock`

**Files:**
- Create: `src/hooks/use-screen-wake-lock.ts`

- [ ] **Step 1: Write the hook**

`src/hooks/use-screen-wake-lock.ts`:

```ts
import { useEffect, useRef } from "react";
import {
  releaseScreenWakeLock,
  requestScreenWakeLock,
  visibleWakeLockState,
  type WakeLockSentinelLike,
} from "../lib/screen-wake-lock";

export function useScreenWakeLock(enabled: boolean) {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    let disposed = false;
    const sync = () => {
      const action = visibleWakeLockState({
        active: enabled,
        sentinelActive: sentinelRef.current !== null,
        visibility: document.visibilityState,
      });
      if (action === "release") {
        releaseScreenWakeLock(sentinelRef.current);
        sentinelRef.current = null;
        return;
      }
      if (action === "request") {
        void requestScreenWakeLock().then((sentinel) => {
          if (disposed || !enabledRef.current) {
            releaseScreenWakeLock(sentinel);
            return;
          }
          sentinelRef.current = sentinel;
        });
      }
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", sync);
      releaseScreenWakeLock(sentinelRef.current);
      sentinelRef.current = null;
    };
  }, [enabled]);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Run full test suite (regression)**

Run: `npm test`
Expected: semua test sukses.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/use-screen-wake-lock.ts
git commit -m "feat: add wake lock hook"
```

## Task 4: Integrasi di SoundboardPage

**Files:**
- Modify: `src/routes/index.tsx:68-80`
- Test: `tests/screen-wake-lock.test.ts`

- [ ] **Step 1: Add failing source assertion**

Append ke `tests/screen-wake-lock.test.ts` endpoint:

```ts
import { readFileSync } from "node:fs";

const indexSource = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");

it("activates wake lock in the crew soundboard page", () => {
  expect(indexSource).toContain("useScreenWakeLock(identityHydrated)");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/screen-wake-lock.test.ts`
Expected: 1 FAIL (source tidak mengandung pemanggilan).

- [ ] **Step 3: Wire the hook**

`src/routes/index.tsx`:

1. Tambah import setelah baris `import { useRemoteCrew } from "@/hooks/use-remote-crew";`:

```tsx
import { useScreenWakeLock } from "@/hooks/use-screen-wake-lock";
```

2. Di `SoundboardPage`, tepat setelah `useEffect` yang set `identityHydrated` (block `() => { const identity = readCrewSessionIdentity(...); ... }`), tambah:

```tsx
useScreenWakeLock(identityHydrated);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/screen-wake-lock.test.ts`
Expected: PASS.

- [ ] **Step 5: Full verification**

Run each, satu-satu:
1. `npm test` — semua pass.
2. `npx tsc --noEmit` — bersih.
3. `npm run lint` — 0 error (6 warning pre-existing boleh tetap).
4. `npm run build` — sukses.

- [ ] **Step 6: Commit**

```bash
git add src/routes/index.tsx tests/screen-wake-lock.test.ts
git commit -m "feat: keep crew soundboard screen awake"
```

## Done

- [ ] Cabang siap. Jika bekerja di feature branch: push & dan lanjut ke review/finishing (subagent rekomendasi per skill finishing-a-development-branch).