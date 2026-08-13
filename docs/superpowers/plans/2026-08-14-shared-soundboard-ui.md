# Shared Soundboard UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse one server-safe, metadata-driven soundboard UI for crew local playback and Super Admin target-first remote commands.

**Architecture:** Put table range and announcement labels/categories in `remote-audio-domain.ts`, which is safe for both server and browser imports. `SoundboardGrid` owns the grid, drawer, grouping, accessibility, and status presentation; routes provide availability, status, disabled state, and selection callbacks. Keep audio playback in the crew route and remote transport/audit in the Super Admin route.

**Tech Stack:** React 19, TypeScript, TanStack Start/React Query, Lucide React, Vitest Node, ESLint, Vite.

---

## File Structure

- Modify: `src/lib/remote-audio-domain.ts` — shared table IDs, announcement categories, labels, and metadata lookup without Vite/browser imports.
- Modify: `src/lib/audio.ts` — derive bundled announcement URL typing/catalog from shared metadata only.
- Modify: `src/lib/super-admin-state.ts` — target/offline/pending control guard without a selected audio dropdown value.
- Create: `src/components/SoundboardGrid.tsx` — reusable responsive table grid, announcement trigger/drawer, grouping, native disabled controls, and display status wiring.
- Modify: `src/routes/index.tsx` — replace duplicated grid/drawer markup with `SoundboardGrid`, retaining local play/pause/resume/concurrency/Stop behavior.
- Modify: `src/routes/super-admin.tsx` — retain target selector and audit/error sections, replace audio selector/Play button with immediate shared-grid dispatch.
- Modify: `tests/remote-audio-domain.test.ts` — verify server-safe shared table and categorized announcement metadata.
- Modify: `tests/super-admin-route.test.ts` — verify target-first guard and removed dropdown/Play UI.
- Create: `tests/shared-soundboard-ui.test.ts` — Node structural/pure tests proving both routes consume the one presentation component and its metadata-driven controls.

### Task 1: Define shared, server-safe soundboard metadata

**Files:**
- Modify: `src/lib/remote-audio-domain.ts:1-43`
- Modify: `src/lib/audio.ts:15-105`
- Test: `tests/remote-audio-domain.test.ts:1-33`

- [ ] **Step 1: Write the failing metadata tests**

Replace the first test in `tests/remote-audio-domain.test.ts` with this test and add `TABLE_AUDIO_IDS` to its import list:

```ts
it("exposes one 70-table range and categorized announcement metadata without asset URLs", () => {
  expect(TABLE_AUDIO_IDS).toHaveLength(70);
  expect(TABLE_AUDIO_IDS[0]).toBe("table:1");
  expect(TABLE_AUDIO_IDS[69]).toBe("table:70");
  expect(ANNOUNCEMENT_CATALOG.map(({ id, category }) => ({ id, category }))).toEqual([
    { id: "seating", category: "INFO" },
    { id: "himbauan-barang-bawaan-pelanggan", category: "INFO" },
    { id: "jam-buka-resto", category: "INFO" },
    { id: "outside-food", category: "LARANGAN" },
    { id: "no-smoking", category: "LARANGAN" },
    { id: "larangan-gabung-meja", category: "LARANGAN" },
  ]);
  expect(JSON.stringify({ TABLE_AUDIO_IDS, ANNOUNCEMENT_CATALOG })).not.toContain(".mp3");
  expect(getCatalogMetadata("table:71")).toBeNull();
  expect(getCatalogMetadata("announcement:no-smoking")).toEqual({
    id: "announcement:no-smoking",
    label: "Dilarang Merokok di Area Lobby",
  });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npx vitest run tests/remote-audio-domain.test.ts`

Expected: FAIL because `TABLE_AUDIO_IDS` is not exported and announcement entries lack `category`.

- [ ] **Step 3: Add the metadata range and categories**

Replace `ANNOUNCEMENT_CATALOG` and add the following declarations in `src/lib/remote-audio-domain.ts` directly after `TABLE_COUNT`:

```ts
export const TABLE_AUDIO_IDS = Array.from(
  { length: TABLE_COUNT },
  (_, index) => `table:${index + 1}` as `table:${number}`,
);

export const ANNOUNCEMENT_CATALOG = [
  { id: "seating", label: "Himbauan Duduk Sesuai Nomor Meja", category: "INFO" },
  {
    id: "himbauan-barang-bawaan-pelanggan",
    label: "Himbauan Barang Bawaan Pelanggan",
    category: "INFO",
  },
  { id: "jam-buka-resto", label: "Informasi Jam Buka Tutup Resto", category: "INFO" },
  { id: "outside-food", label: "Dilarang Bawa Makanan Dari Luar", category: "LARANGAN" },
  { id: "no-smoking", label: "Dilarang Merokok di Area Lobby", category: "LARANGAN" },
  { id: "larangan-gabung-meja", label: "Dilarang Gabungkan Meja", category: "LARANGAN" },
] as const;

export type AnnouncementCategory = (typeof ANNOUNCEMENT_CATALOG)[number]["category"];
```

Replace the table branch in `getCatalogMetadata` with:

```ts
const table = TABLE_AUDIO_IDS.find((tableId) => tableId === id);
if (table) return { id: table, label: `Meja ${table.slice("table:".length)}` };
```

In `src/lib/audio.ts`, retain asset discovery but derive the announcement URL record from metadata. Replace the explicit six-key initializer with:

```ts
const result = Object.fromEntries(
  ANNOUNCEMENT_CATALOG.map(({ id }) => [id, null]),
) as Record<AnnouncementId, string | null>;
```

Replace the table branch of `bundledAudioCatalog` with:

```ts
...TABLE_AUDIO_IDS.flatMap((id) => {
  const tableNumber = Number(id.slice("table:".length));
  const url = tableAudioUrls.get(tableNumber);
  const metadata = getCatalogMetadata(id);
  return url && metadata ? [{ ...metadata, url }] : [];
}),
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npx vitest run tests/remote-audio-domain.test.ts`

Expected: PASS with all remote audio domain tests green.

- [ ] **Step 5: Commit metadata independently**

```bash
git add src/lib/remote-audio-domain.ts src/lib/audio.ts tests/remote-audio-domain.test.ts
git commit -m "feat: share soundboard catalog metadata"
```

Expected: one commit containing only the three listed files. Do not stage unrelated unstaged `.gitignore`.

### Task 2: Create the shared soundboard presentation component

**Files:**
- Create: `src/components/SoundboardGrid.tsx`
- Test: `tests/shared-soundboard-ui.test.ts`

- [ ] **Step 1: Write the failing Node structural test**

Create `tests/shared-soundboard-ui.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { ANNOUNCEMENT_CATALOG, TABLE_AUDIO_IDS } from "../src/lib/remote-audio-domain";

const source = readFileSync(
  new URL("../src/components/SoundboardGrid.tsx", import.meta.url),
  "utf8",
);

it("derives all table and categorized announcement controls from shared metadata", () => {
  expect(TABLE_AUDIO_IDS).toHaveLength(70);
  expect(ANNOUNCEMENT_CATALOG.filter(({ category }) => category === "INFO")).toHaveLength(3);
  expect(ANNOUNCEMENT_CATALOG.filter(({ category }) => category === "LARANGAN")).toHaveLength(3);
  expect(source).toContain("TABLE_AUDIO_IDS.map");
  expect(source).toContain("ANNOUNCEMENT_CATALOG.filter");
  expect(source).toContain('role="dialog"');
  expect(source).toContain("event.key === \"Escape\"");
  expect(source).toContain("event.target === event.currentTarget");
  expect(source).toContain("disabled={tableDisabled(audioId) || !availableAudioIds.has(audioId)}");
  expect(source).toContain("disabled={announcementDisabled(audioId) || !availableAudioIds.has(audioId)}");
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npx vitest run tests/shared-soundboard-ui.test.ts`

Expected: FAIL with `ENOENT` because `src/components/SoundboardGrid.tsx` does not exist.

- [ ] **Step 3: Create `src/components/SoundboardGrid.tsx`**

Create the component with this public contract; use the existing `TableButton` and existing Tailwind class strings from `src/routes/index.tsx` for visual parity:

```tsx
import { useEffect, useMemo, useState } from "react";
import { Megaphone, Pause, Play, X } from "lucide-react";
import { TableButton, type TableStatus } from "./TableButton";
import {
  ANNOUNCEMENT_CATALOG,
  TABLE_AUDIO_IDS,
  type AnnouncementCategory,
  type AnnouncementId,
  type AudioId,
} from "../lib/remote-audio-domain";

type AnnouncementStatus = "idle" | "loading" | "playing" | "paused";

type SoundboardGridProps = {
  availableAudioIds: ReadonlySet<AudioId>;
  drawerDisabled: boolean;
  tableDisabled: (audioId: AudioId) => boolean;
  announcementDisabled: (audioId: AudioId) => boolean;
  tableStatus: (tableNumber: number) => TableStatus;
  announcementStatus: (announcementId: AnnouncementId) => AnnouncementStatus;
  onSelect: (audioId: AudioId) => void;
};

const categories: readonly AnnouncementCategory[] = ["INFO", "LARANGAN"];

export function SoundboardGrid({
  availableAudioIds,
  drawerDisabled,
  tableDisabled,
  announcementDisabled,
  tableStatus,
  announcementStatus,
  onSelect,
}: SoundboardGridProps) {
  const [announcementPanelOpen, setAnnouncementPanelOpen] = useState(false);
  const announcementGroups = useMemo(
    () =>
      categories.map((category) => ({
        category,
        items: ANNOUNCEMENT_CATALOG.filter((announcement) => announcement.category === category),
      })),
    [],
  );

  useEffect(() => {
    if (!announcementPanelOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAnnouncementPanelOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [announcementPanelOpen]);

  return (
    <>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 sm:gap-3 md:grid-cols-8 lg:grid-cols-10">
        {TABLE_AUDIO_IDS.map((audioId) => {
          const tableNumber = Number(audioId.slice("table:".length));
          return (
            <TableButton
              key={audioId}
              tableNumber={tableNumber}
              status={tableStatus(tableNumber)}
              disabled={tableDisabled(audioId) || !availableAudioIds.has(audioId)}
              onClick={() => onSelect(audioId)}
            />
          );
        })}
      </div>
      {!announcementPanelOpen && (
        <button
          type="button"
          onClick={() => setAnnouncementPanelOpen(true)}
          aria-haspopup="dialog"
          aria-expanded="false"
          disabled={drawerDisabled}
          className="brutal-border brutal-shadow-lg brutal-press fixed bottom-4 right-4 z-30 flex items-center gap-2 bg-primary px-4 py-3 font-display text-sm uppercase text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40 sm:px-5 sm:text-base"
        >
          <Megaphone className="size-5 shrink-0" aria-hidden="true" />
          Lihat Pengumuman
        </button>
      )}
      {announcementPanelOpen && (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-foreground/60"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setAnnouncementPanelOpen(false);
          }}
        >
          <section role="dialog" aria-modal="true" aria-labelledby="announcement-panel-title" className="h-full w-full overflow-y-auto border-l-4 border-foreground bg-background p-4 shadow-[-8px_0_0_0_hsl(var(--foreground))] sm:max-w-xl sm:p-6">
            <div className="sticky top-0 z-10 -mx-4 -mt-4 mb-5 flex items-start justify-between gap-3 border-b-4 border-foreground bg-background p-4 sm:-mx-6 sm:-mt-6 sm:p-6">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center bg-primary text-primary-foreground"><Megaphone className="size-5" aria-hidden="true" /></div>
                <div><h2 id="announcement-panel-title" className="font-display text-lg uppercase leading-tight sm:text-xl">Tombol Pengumuman</h2><p className="mt-1 text-xs text-muted-foreground sm:text-sm">Pilih pengumuman yang ingin diputar.</p></div>
              </div>
              <button type="button" onClick={() => setAnnouncementPanelOpen(false)} aria-label="Tutup panel pengumuman" className="brutal-border brutal-press flex size-10 shrink-0 items-center justify-center bg-card"><X className="size-5" strokeWidth={3} aria-hidden="true" /></button>
            </div>
            <div className="space-y-5">
              {announcementGroups.map((group) => (
                <div key={group.category} aria-labelledby={`announcement-category-${group.category.toLowerCase()}`}>
                  <div className="mb-3 flex items-center gap-2"><h3 id={`announcement-category-${group.category.toLowerCase()}`} className={`border-2 border-foreground px-2.5 py-1 font-display text-xs uppercase ${group.category === "INFO" ? "bg-primary text-primary-foreground" : "bg-destructive text-destructive-foreground"}`}>{group.category}</h3><span className="text-xs font-bold text-muted-foreground">{group.items.length} pengumuman</span><div className="h-0.5 flex-1 bg-foreground" aria-hidden="true" /></div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {group.items.map((announcement) => {
                      const audioId = `announcement:${announcement.id}` as AudioId;
                      const status = announcementStatus(announcement.id);
                      return <button key={announcement.id} type="button" onClick={() => onSelect(audioId)} disabled={announcementDisabled(audioId) || !availableAudioIds.has(audioId)} aria-label={`${status === "playing" ? "Jeda" : "Putar"} ${announcement.label.toLowerCase()}`} className={`brutal-border brutal-press flex w-full items-center justify-between gap-3 px-4 py-3 text-left font-display text-sm uppercase leading-tight disabled:cursor-not-allowed disabled:opacity-40 sm:text-base ${group.category === "INFO" ? "bg-accent" : "bg-destructive text-destructive-foreground"}`}><span>{announcement.label}</span>{status === "playing" ? <Pause className="size-5 shrink-0 fill-current" aria-hidden="true" /> : <Play className="size-5 shrink-0 fill-current" aria-hidden="true" />}</button>;
                    })}
                  </div>
                </div>
              ))}
            </div>
            <footer className="mt-8 border-t-2 border-foreground px-2 pb-2 pt-4 text-center text-xs leading-relaxed text-muted-foreground sm:text-sm">
              <p className="italic">- Gak ada orang yang terlahir bodoh, mereka hanya <strong className="font-bold text-foreground">Malas Belajar</strong>. -</p>
              <p className="mt-1 font-semibold text-foreground">Semoga Bermanfaat ya gaes!</p>
              <p className="mt-1 text-[11px] sm:text-xs">By <strong className="font-bold text-foreground">Bang Marko Ganteng</strong></p>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
```

Format this file with Prettier before continuing. Preserve the existing drawer footer verbatim below the grouped buttons, so the crew presentation does not lose current content.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npx vitest run tests/shared-soundboard-ui.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the presentation component**

```bash
git add src/components/SoundboardGrid.tsx tests/shared-soundboard-ui.test.ts
git commit -m "feat: add shared soundboard presentation"
```

Expected: one commit containing only the component and its test. Do not stage unrelated unstaged `.gitignore`.

### Task 3: Replace crew duplicated markup while preserving local playback

**Files:**
- Modify: `src/routes/index.tsx:1-24,53-67,151-264,301-481`
- Modify: `tests/shared-soundboard-ui.test.ts`

- [ ] **Step 1: Add failing structural assertions for crew reuse and logical IDs**

Append this test to `tests/shared-soundboard-ui.test.ts`:

```ts
it("makes the crew route use the shared component and pass logical audio IDs", () => {
  const crew = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
  expect(crew).toContain('import { SoundboardGrid } from "@/components/SoundboardGrid"');
  expect(crew).toContain("<SoundboardGrid");
  expect(crew).toContain("onSelect={(audioId) =>");
  expect(crew).not.toContain("const announcementGroups = [");
  expect(crew).not.toContain("announcementPanelOpen");
  expect(crew).toContain("<Square");
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npx vitest run tests/shared-soundboard-ui.test.ts`

Expected: FAIL because the crew route still declares its own announcement groups, drawer state, and grid.

- [ ] **Step 3: Wire crew route to `SoundboardGrid`**

In `src/routes/index.tsx`:

1. Replace the `TableButton` import with `SoundboardGrid`; remove `Megaphone`, `Pause`, `Play`, and `X` from the Lucide import, retaining `Square`.
2. Remove `TABLE_COUNT` only if no longer used outside `Header`; retain it for `Header` and empty-state copy.
3. Remove `tables`, `announcements`, `announcementPanelOpen`, its Escape `useEffect`, and `announcementGroups`.
4. Add these helpers before `SoundboardPage`:

```ts
function tableAudioId(tableNumber: number): AudioId {
  return `table:${tableNumber}`;
}

function announcementAudioId(announcementId: string): AudioId {
  return `announcement:${announcementId}` as AudioId;
}
```

5. Keep existing local `play`, `toggleAnnouncement`, `stop`, playback generation, remote playback, and `activeAudioId` behavior. Change only their call boundaries: table selection calls `void play(Number(audioId.slice("table:".length)))`; announcement selection calls `toggleAnnouncement(announcement.id, announcementAudioUrls[announcement.id])` after deriving `announcement.id` from the selected `announcement:` ID.
6. Replace the current table `<div>` through the announcement drawer closing `</div>` with:

```tsx
<SoundboardGrid
  availableAudioIds={new Set<AudioId>([
    ...[...readyTables].map(tableAudioId),
    ...ANNOUNCEMENT_CATALOG.filter((announcement) => announcementAudioUrls[announcement.id]).map(
      (announcement) => announcementAudioId(announcement.id),
    ),
  ])}
  drawerDisabled={false}
  tableDisabled={() => activeAudioId !== null}
  announcementDisabled={(audioId) => {
    const announcement = ANNOUNCEMENT_CATALOG.find(
      ({ id }) => `announcement:${id}` === audioId,
    );
    return (
      loading !== null ||
      (activeAudioId !== null && activeAudioId !== announcement?.label)
    );
  }}
  tableStatus={(tableNumber) => {
    if (playing === tableNumber) return "playing";
    if (loading === tableNumber) return "loading";
    return readyTables.has(tableNumber) ? "ready" : "empty";
  }}
  announcementStatus={(announcementId) => {
    const id = announcement.label;
    if (playing === id) return "playing";
    if (loading === id) return "loading";
    return paused === id ? "paused" : "idle";
  }}
  onSelect={(audioId) => {
    if (audioId.startsWith("table:")) {
      void play(Number(audioId.slice("table:".length)));
      return;
    }
    const announcement = ANNOUNCEMENT_CATALOG.find(
      ({ id }) => `announcement:${id}` === audioId,
    );
    if (announcement) toggleAnnouncement(announcement.label, announcementAudioUrls[announcement.id]);
  }}
/>
```

7. Import `ANNOUNCEMENT_CATALOG` with `AudioId` from `@/lib/remote-audio-domain`. Keep the existing floating `Stop` block unchanged and crew-only.

- [ ] **Step 4: Run focused tests to verify crew behavior is structurally preserved**

Run: `npx vitest run tests/audio-unlock.test.ts tests/shared-soundboard-ui.test.ts`

Expected: PASS. Existing controller tests prove stop, remote replacement, stale completion, and resume safety remain intact; structural test proves route reuse and crew-only Stop.

- [ ] **Step 5: Commit crew integration**

```bash
git add src/routes/index.tsx tests/shared-soundboard-ui.test.ts
git commit -m "refactor: reuse soundboard grid for crew"
```

Expected: one commit containing only the listed files. Do not stage unrelated unstaged `.gitignore`.

### Task 4: Make Super Admin target-first with immediate item dispatch

**Files:**
- Modify: `src/lib/super-admin-state.ts:1-30`
- Modify: `src/routes/super-admin.tsx:1-193`
- Modify: `tests/super-admin-route.test.ts:1-112`
- Modify: `tests/shared-soundboard-ui.test.ts`

- [ ] **Step 1: Write failing pure and structural tests**

In `tests/super-admin-route.test.ts`, replace the `canPlayRemoteAudio` import/test with `canSelectRemoteAudio` and:

```ts
it("enables a soundboard selection only for a valid online idle target", () => {
  expect(canSelectRemoteAudio({ offline: false, targetSessionId: "crew", pending: false })).toBe(true);
  expect(canSelectRemoteAudio({ offline: true, targetSessionId: "crew", pending: false })).toBe(false);
  expect(canSelectRemoteAudio({ offline: false, targetSessionId: "", pending: false })).toBe(false);
  expect(canSelectRemoteAudio({ offline: false, targetSessionId: "crew", pending: true })).toBe(false);
});
```

Replace the reconciliation assertions so the function no longer accepts or returns `audioId`:

```ts
expect(
  reconcileRemoteSelection("crew-1", [{ id: "crew-1", eligible: true, audioReady: true }]),
).toEqual("crew-1");
expect(
  reconcileRemoteSelection("crew-1", [{ id: "crew-1", eligible: false, audioReady: true }]),
).toBe("");
expect(reconcileRemoteSelection("crew-1", [])).toBe("");
```

Append this test to `tests/shared-soundboard-ui.test.ts`:

```ts
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
```

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `npx vitest run tests/super-admin-route.test.ts tests/shared-soundboard-ui.test.ts`

Expected: FAIL because the state helper requires `audioId`, reconciliation carries audio selection, and Super Admin has an Audio select plus Play button.

- [ ] **Step 3: Simplify the remote selection state helper**

Replace `src/lib/super-admin-state.ts:1-30` with:

```ts
export type RemoteSelectionState = {
  offline: boolean;
  targetSessionId: string;
  pending: boolean;
};

export function canSelectRemoteAudio({ offline, targetSessionId, pending }: RemoteSelectionState) {
  return !offline && Boolean(targetSessionId) && !pending;
}

export function reconcileRemoteSelection(
  targetSessionId: string,
  sessions: readonly { id: string; eligible: boolean; audioReady: boolean }[],
) {
  return sessions.some(
    (session) => session.id === targetSessionId && session.eligible && session.audioReady,
  )
    ? targetSessionId
    : "";
}

export function commandStatus(
  command: { status: "sent" | "played" | "failed" | "expired"; expires_at: string },
  now: number,
) {
  return command.status === "sent" && Date.parse(command.expires_at) <= now
    ? "expired"
    : command.status;
}
```

- [ ] **Step 4: Wire immediate Super Admin dispatch**

In `src/routes/super-admin.tsx`:

1. Import `SoundboardGrid`, `TableStatus`, and `AudioId`.
2. Replace `canPlayRemoteAudio` with `canSelectRemoteAudio`.
3. Remove `audioId` state entirely.
4. Change mutation construction to:

```ts
const mutation = useMutation({
  mutationFn: (audioId: AudioId) => sendRemoteCommand({ data: { targetSessionId, audioId } }),
  onSuccess: () => {
    setSendError("");
    queryClient.invalidateQueries({ queryKey: snapshotKey });
  },
  onError: () => setSendError("Gagal mengirim perintah. Silakan coba lagi."),
});
```

5. Reconcile only `targetSessionId`:

```ts
useEffect(() => {
  const nextTargetSessionId = reconcileRemoteSelection(
    targetSessionId,
    sessions.map((session) => ({
      id: session.id,
      eligible: session.eligible,
      audioReady: session.audio_ready,
    })),
  );
  if (nextTargetSessionId !== targetSessionId) setTargetSessionId(nextTargetSessionId);
}, [sessions, targetSessionId]);
```

6. Compute `const controlsDisabled = !canSelectRemoteAudio({ offline, targetSessionId, pending: mutation.isPending });` and `const availableAudioIds = useMemo(() => new Set(catalog.map((audio) => audio.id as AudioId)), [catalog]);`.
7. Keep the target `<select>` as the first field. Delete the entire Audio `<label>`/`<select>` block and the separate Play `<button>`.
8. Directly after the target status paragraph, render visible target-first guidance and the shared component:

```tsx
{!selectedTarget && !offline && (
  <p className="mt-3 text-sm font-bold">Pilih crew siap audio terlebih dahulu.</p>
)}
<SoundboardGrid
  availableAudioIds={availableAudioIds}
  drawerDisabled={controlsDisabled}
  tableDisabled={() => controlsDisabled}
  announcementDisabled={() => controlsDisabled}
  tableStatus={(tableNumber): TableStatus => {
    const audioId = `table:${tableNumber}` as AudioId;
    return mutation.isPending && mutation.variables === audioId ? "loading" : "ready";
  }}
  announcementStatus={(announcementId) => {
    const audioId = `announcement:${announcementId}` as AudioId;
    return mutation.isPending && mutation.variables === audioId ? "loading" : "idle";
  }}
  onSelect={(audioId) => {
    setSendError("");
    mutation.reset();
    mutation.mutate(audioId);
  }}
/>
```

9. Preserve the existing `role="alert"` mutation error text and the seven-day audit section unchanged. The existing catalog continues to label audit rows from the same server-safe metadata. Do not add browser audio APIs or confirmation UI.

- [ ] **Step 5: Run focused tests to verify immediate dispatch behavior**

Run: `npx vitest run tests/super-admin-route.test.ts tests/shared-soundboard-ui.test.ts`

Expected: PASS. This covers disabled no-target/offline/pending state, removal of selector/Play UI, visible instruction, shared component reuse, and immediate `mutation.mutate(audioId)` wiring.

- [ ] **Step 6: Commit Super Admin integration**

```bash
git add src/lib/super-admin-state.ts src/routes/super-admin.tsx tests/super-admin-route.test.ts tests/shared-soundboard-ui.test.ts
git commit -m "feat: send remote audio from shared soundboard"
```

Expected: one commit containing only the four listed files. Do not stage unrelated unstaged `.gitignore`.

### Task 5: Full verification and production smoke

**Files:**
- Modify: none

- [ ] **Step 1: Run the complete Vitest suite**

Run: `npm test`

Expected: PASS; every existing Node test plus `shared-soundboard-ui.test.ts` passes.

- [ ] **Step 2: Run TypeScript validation**

Run: `npx tsc --noEmit`

Expected: exit code 0 with no TypeScript diagnostics.

- [ ] **Step 3: Run lint and record the known baseline**

Run: `npm run lint`

Expected: exit code 0 with the existing six `react-refresh/only-export-components` warnings only; no new warnings or errors. If this environment exceeds the command timeout, rerun with a timeout of at least 10 minutes and preserve the resulting output in the implementation log.

- [ ] **Step 4: Build production assets**

Run: `npm run build`

Expected: exit code 0 and Vite production output; do not edit `src/routeTree.gen.ts` manually.

- [ ] **Step 5: Perform production smoke testing**

Run: `npm run dev -- --host 127.0.0.1`

Expected: Vite reports a localhost URL. Open the local app and verify:

1. Crew dashboard still shows 70 table positions, INFO/LARANGAN drawer groups, native disabled unavailable assets, local pause/resume, concurrent-playback lock, remote playback, and the crew-only Stop control.
2. Super Admin shows target selection above the shared grid; before target selection, visible instruction appears and table/announcement controls are disabled.
3. With an eligible audio-ready target and subscribed Realtime, click table 7 once; one `table:7` request sends immediately, that item shows loading during mutation, then audit refreshes from `sent` to terminal status.
4. Click the no-smoking announcement once; one `announcement:no-smoking` request sends immediately.
5. Disconnect Realtime and start a request separately; controls disable in both cases. Force a request error and confirm existing bounded `role="alert"` text remains visible, then controls re-enable after pending ends.

Stop the dev server after smoke testing with `Ctrl+C`.

- [ ] **Step 6: Inspect changes before handoff**

Run: `git status --short && git diff --check && git log --oneline -4`

Expected: `git diff --check` produces no output; only the unrelated pre-existing `.gitignore` remains unstaged, and the three feature commits appear in recent history.

## Self-Review

- [ ] **Spec coverage:** Task 1 supplies server-safe shared IDs, labels, categories, and one 70-table range. Task 2 centralizes grid, `TableButton` mapping, trigger, drawer, grouping, Escape/backdrop/native-disabled/accessibility presentation. Task 3 preserves crew playback, status, local availability, remote controller use, and Stop. Task 4 keeps required eligible target selection, immediate logical-ID dispatch, pending item loading, offline/no-target/pending disablement, unchanged errors/audit, and removes Audio dropdown/Play button. Task 5 validates full suite, TypeScript, lint baseline, build, and all specified manual smoke paths.
- [ ] **Placeholder scan:** No `TBD`, `TODO`, “implement later”, unspecified tests, or unspecified commands remain.
- [ ] **Type consistency:** `AudioId`, `AnnouncementId`, `AnnouncementCategory`, `TableStatus`, `canSelectRemoteAudio`, `reconcileRemoteSelection`, and `SoundboardGrid` props use the same names/signatures in all tasks.
- [ ] **Route generation safety:** No task edits `src/routeTree.gen.ts`; file-based routes remain unchanged.
- [ ] **Working-tree safety:** Every commit command names exact files and excludes the pre-existing unstaged `.gitignore`.
