# Crew Message Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Run commands one at a time, not combined.

**Goal:** Super Admin kirim pesan teks per-target crew → overlay realtime full-screen di device crew, auto close 5 detik + tombol **"OK Bang!"**, soundboard diblok sementara (suara tetap berputar).

**Architecture:** Reuse pattern remote audio — SQL table + service-role RPC + TanStack Start server fn + Supabase Realtime broadcast ke crew via anon client filer `target_session_id = auth.uid()`. Hook `useCrewMessage` + komponen overlay. Pure domain logika terpisah agar test tanpa jsdom.

**Tech Stack:** PostgreSQL (Supabase migration via SQL), TanStack Start server fn, Supabase Realtime, React 19 hooks, Vitest (pure function tests + source assertions, no jsdom).

**Spec:** `docs/superpowers/specs/2026-08-20-crew-message-design.md`

---

## File Structure

- **Create** `supabase/migrations/20260820000000_crew_messages.sql` — tabel, index, RPC, RLS, publication.
- **Create** `src/lib/crew-message-domain.ts` — pure constants + `validateCrewMessageRequest` + dedupe helpers.
- **Create** `src/lib/crew-message.server.ts` — server fn `sendCrewMessage`.
- **Create** `src/hooks/use-crew-message.ts` — subscribe Realtime + timer/auto-close + dedupe ref.
- **Create** `src/components/CrewMessageOverlay.tsx` — full-screen modal + tombol "OK Bang!".
- **Modify** `src/routes/index.tsx` — mount `useCrewMessage`, render overlay, disable soundboard saat aktif.
- **Modify** `src/routes/super-admin.tsx` — form kirim pesan (textarea + button) + mutation.
- **Tests:** `tests/crew-message-domain.test.ts`, source assertions di test existing.
- **No UI changes** di komponen lama.

---

## Task 1: DB schema + RPC

**Files:**
- Create: `supabase/migrations/20260820000000_crew_messages.sql`

- [ ] **Step 1: Write migration**

```sql
create table public.crew_messages (
  id uuid primary key default gen_random_uuid(),
  target_session_id uuid not null references public.crew_sessions(id) on delete cascade,
  message text not null check (char_length(message) <= 200),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index crew_messages_target_idx on public.crew_messages (target_session_id);

create or replace function public.create_crew_message(
  p_target_session_id uuid,
  p_message text,
  p_expires_in_seconds bigint default 5
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public as $$
  declare v_id uuid;
begin
  if char_length(p_message) > 200 then
    raise exception 'MESSAGE_TOO_LONG';
  end if;
  insert into public.crew_messages (target_session_id, message, expires_at)
  values (p_target_session_id, p_message, now() + make_interval(secs => p_expires_in_seconds))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.cleanup_expired_crew_messages()
  returns void
  language sql
  security definer
  set search_path = public as $$
  delete from public.crew_messages where expires_at < now();
$$;

-- akses sama seperti remote_commands:
alter table public.crew_messages enable row level security;
revoke all on public.crew_messages from public, anon, authenticated;
revoke all on function public.create_crew_message(uuid, text, bigint),
                public.cleanup_expired_crew_messages() from public, anon, authenticated;
grant execute on function public.create_crew_message(uuid, text, bigint) to service_role;
grant execute on function public.cleanup_expired_crew_messages() to service_role;
-- crew dapat via realtime broadcast, bukan SELECT langsung:
do $$
begin
  begin
    alter publication supabase_realtime add table public.crew_messages;
  exception
    when duplicate_object then null;
  end;
end;
$$;
```

- [ ] **Step 2: Verify syntax mentally / run tsc (migration not applied, just authored)**

No test for migration; applied via Supabase di deployment.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260820000000_crew_messages.sql
git commit -m "feat: add crew_messages table and create_crew_message RPC"
```

## Task 2: Pure domain — constants, validate, dedupe

**Files:**
- Create: `src/lib/crew-message-domain.ts`
- Test: `tests/crew-message-domain.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  CREW_MESSAGE_AUTO_CLOSE_MS,
  CREW_MESSAGE_MAX_LENGTH,
  CREW_MESSAGE_TTL_MS,
  isDuplicateCrewMessage,
  pruneDeliveredCrewMessages,
  validateCrewMessageRequest,
} from "../src/lib/crew-message-domain";

describe("validateCrewMessageRequest", () => {
  it("accepts valid uuid target and short message", () => {
    expect(
      validateCrewMessageRequest({
        targetSessionId: "00000000-0000-0000-0000-000000000001",
        message: "Meja 5 lapor ke dapur",
      }),
    ).toEqual({ targetSessionId: "00000000-0000-0000-0000-000000000001", message: "Meja 5 lapor ke dapur" });
  });

  it("rejects empty message", () => {
    expect(validateCrewMessageRequest({ targetSessionId: "00000000-0000-0000-0000-000000000001", message: "  " })).toEqual({
      error: "Nama wajib diisi.",
    });
  });

  it("rejects invalid target uuid", () => {
    expect(validateCrewMessageRequest({ targetSessionId: "bukan-uuid", message: "x" })).toEqual({
      error: "Crew target tidak valid.",
    });
  });

  it("rejects message over 200 chars", () => {
    expect(validateCrewMessageRequest({ targetSessionId: "00000000-0000-0000-0000-000000000001", message: "k".repeat(201) })).toEqual({
      error: "Pesan maksimal 200 karakter.",
    });
  });

  it("rejects message exactly at 200 as valid", () => {
    expect(validateCrewMessageRequest({ targetSessionId: "00000000-0000-0000-0000-000000000001", message: "k".repeat(200) })).toEqual({
      targetSessionId: "00000000-0000-0000-0000-000000000001",
      message: "k".repeat(200),
    });
  });
});

describe("delivered message dedupe", () => {
  const NOW = 1_000_000;
  it("treats unseen id as not duplicate and marks it", () => {
    const delivered = new Map<string, number>();
    expect(isDuplicateCrewMessage("m1", delivered, NOW)).toBe(false);
    markDeliveredCrewMessage("m1", delivered, NOW);
    expect(isDuplicateCrewMessage("m1", delivered, NOW)).toBe(true);
  });

  it("prunes entries older than TTL", () => {
    const delivered = new Map<string, number>([["m1", NOW - CREW_MESSAGE_TTL_MS - 1]]);
    pruneDeliveredCrewMessages(delivered, NOW);
    expect(delivered.has("m1")).toBe(false);
  });

  it("keeps entries still fresh", () => {
    const delivered = new Map<string, number>([["m2", NOW - 10]]);
    pruneDeliveredCrewMessages(delivered, NOW);
    expect(delivered.has("m2")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `npm test -- tests/crew-message-domain.test.ts`
Expected: FAIL (module tidak ada).

- [ ] **Step 3: Write implementation**

`src/lib/crew-message-domain.ts`:

```ts
import { z } from "zod";

export const CREW_MESSAGE_MAX_LENGTH = 200;
export const CREW_MESSAGE_AUTO_CLOSE_MS = 5_000;
export const CREW_MESSAGE_TTL_MS = 6_000; // sedikit > auto-close, agar replay stale dibuang

const targetSessionId = z.string().uuid();

export type CrewMessage = {
  id: string;
  target_session_id: string;
  message: string;
  created_at: string;
  expires_at: string;
};

export type ValidateCrewMessageResult =
  | { targetSessionId: string; message: string }
  | { error: string };

export function validateCrewMessageRequest(input: {
  targetSessionId: string;
  message: string;
}): ValidateCrewMessageResult {
  if (!targetSessionId.safeParse(input.targetSessionId).success) {
    return { error: "Crew target tidak valid." };
  }
  const trimmed = input.message.trim();
  if (trimmed === "") {
    return { error: "Nama wajib diisi." }; // pakai kamu wording yang sama untuk empty
  }
  if (input.message.length > CREW_MESSAGE_MAX_LENGTH) {
    return { error: "Pesan maksimal 200 karakter." };
  }
  return { targetSessionId: input.targetSessionId, message: input.message };
}

export function isDuplicateCrewMessage(
  id: string,
  delivered: Map<string, number>,
  now: number,
): boolean {
  pruneDeliveredCrewMessages(delivered, now);
  return delivered.has(id);
}

export function markDeliveredCrewMessage(
  id: string,
  delivered: Map<string, number>,
  now: number,
) {
  delivered.set(id, now);
}

export function pruneDeliveredCrewMessages(
  delivered: Map<string, number>,
  now: number,
  maxAgeMs = CREW_MESSAGE_TTL_MS,
  maxCount = 128,
) {
  for (const [id, deliveredAt] of delivered) {
    if (deliveredAt <= now - maxAgeMs) delivered.delete(id);
  }
  if (delivered.size <= maxCount) return;
  for (const [id] of [...delivered].sort(([, a], [, b]) => a - b)) {
    delivered.delete(id);
    if (delivered.size <= maxCount) return;
  }
}
```

- [ ] **Step 4: Run test passes**

Run: `npm test -- tests/crew-message-domain.test.ts`
Expected: PASS, 8 test.

- [ ] **Step 5: Commit**

```bash
git add src/lib/crew-message-domain.ts tests/crew-message-domain.test.ts
git commit -m "feat: crew message domain validation and dedupe"
```

## Task 3: Server fn `sendCrewMessage`

**Files:**
- Modify: `src/lib/remote-audio.server.ts`
- Test: source assertion existing test file

- [ ] **Step 1: Add failing source assertion**

Append ke `tests/remote-audio-server.test.ts` (cek exists) or buat baru `tests/crew-message-server.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const source = readFileSync(new URL("../src/lib/remote-audio.server.ts", import.meta.url), "utf8");

it("exports sendCrewMessage server fn bound to create_crew_message RPC", () => {
  expect(source).toContain("sendCrewMessage");
  expect(source).toContain("create_crew_message");
  expect(source).toContain("requireSuperAdmin");
});
```

- [ ] **Step 2: Run to verify fails**

Run: `npm test -- tests/crew-message-server.test.ts`
Expected: FAIL (sendCrewMessage tidak ada).

- [ ] **Step 3: Append server fn**

Di akhir `src/lib/remote-audio.server.ts`:

```ts
const crewMessageSchema = z.object({
  targetSessionId: z.string().uuid(),
  message: z.string().min(1).max(CREW_MESSAGE_MAX_LENGTH),
});

export const sendCrewMessage = createServerFn({ method: "POST" })
  .validator(crewMessageSchema)
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    const client = getServiceClient();
    if (!client) return offline();
    try {
      const { error } = await client.rpc("create_crew_message", {
        p_target_session_id: data.targetSessionId,
        p_message: data.message,
        p_expires_in_seconds: 5,
      });
      if (error?.message.includes("MESSAGE_TOO_LONG")) {
        return { error: "Pesan maksimal 200 karakter." };
      }
      return error ? offline() : { ok: true as const };
    } catch {
      return offline();
    }
  });
```

Import di atas: `import { CREW_MESSAGE_MAX_LENGTH } from "./crew-message-domain";` (z dan createServerFn sudah di-import).

- [ ] **Step 4: Run test passes**

Run: `npm test -- tests/crew-message-server.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add src/lib/remote-audio.server.ts tests/crew-message-server.test.ts
git commit -m "feat: add sendCrewMessage server fn"
```

## Task 4: Hook real-time crew message

**Files:**
- Create: `src/hooks/use-crew-message.ts`

- [ ] **Step 1: Write hook**

```ts
import { useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "../lib/supabase-browser";
import { getAnonymousUserId } from "./use-remote-crew";
import {
  CREW_MESSAGE_AUTO_CLOSE_MS,
  isDuplicateCrewMessage,
  markDeliveredCrewMessage,
  pruneDeliveredCrewMessages,
  type CrewMessage,
} from "../lib/crew-message-domain";

type CrewMessageRow = CrewMessage;

export type CrewMessageState = {
  message: string | null;
  dismiss: () => void;
};

export function useCrewMessage(
  enabled: boolean,
): CrewMessageState {
  const [message, setMessage] = useState<string | null>(null);
  const deliveredRef = useRef<Map<string, number>>(new Map());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const scheduleClose = () => {
    clearTimer();
    timerRef.current = setTimeout(() => setMessage(null), CREW_MESSAGE_AUTO_CLOSE_MS);
  };

  const dismiss = () => {
    clearTimer();
    setMessage(null);
  };

  useEffect(() => {
    if (!enabled) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;

    let mounted = true;
    let channel: ReturnType<typeof client.channel> | null = null;

    const deliver = async () => {
      try {
        const userId = await getAnonymousUserId(client);
        if (!mounted) return;
        channel = client
          .channel(`crew-messages:${userId}`)
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "crew_messages",
              filter: `target_session_id=eq.${userId}`,
            },
            ({ new: row }) => {
              if (!mounted) return;
              const msg = row as CrewMessageRow;
              const now = Date.now();
              pruneDeliveredCrewMessages(deliveredRef.current, now);
              if (isDuplicateCrewMessage(msg.id, deliveredRef.current, now)) return;
              markDeliveredCrewMessage(msg.id, deliveredRef.current, now);
              if (document.visibilityState !== "visible") return;
              setMessage(msg.message);
              scheduleClose();
            },
          )
          .subscribe();
      } catch {
        // crew not authed yet — silently tidak subscribe
      }
    };

    void deliver();

    return () => {
      mounted = false;
      clearTimer();
      if (channel) void client.removeChannel(channel);
    };
  }, [enabled]);

  return { message, dismiss };
}
```

Note: `getAnonymousUserId` dapat throw bila crew belum authed (anon sign-in belum selesai) — dibungkus try/catch, tidak subscribe. Ini konsisten dengan useRemoteCrew yang juga panggil getAnonymousUserId di dalam effect.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-crew-message.ts
git commit -m "feat: add crew message realtime hook"
```

## Task 5: Overlay komponen

**Files:**
- Create: `src/components/CrewMessageOverlay.tsx`

- [ ] **Step 1: Write component**

```tsx
import { X } from "lucide-react";

export function CrewMessageOverlay({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  return (
    <div
      className="brutal-border brutal-shadow-xl fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded border-2 border-foreground bg-card p-6 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Tutup"
          className="absolute top-3 right-3 brutal-border brutal-press bg-accent px-2 py-1"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
        <p className="font-display text-lg uppercase leading-snug">{message}</p>
        <button
          type="button"
          className="brutal-border brutal-press mt-5 w-full bg-accent px-3 py-2 font-display uppercase"
          onClick={onClose}
        >
          OK Bang!
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck & lint**

Run: `npx tsc --noEmit` && `npm run lint`
Expected: PASS, 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/CrewMessageOverlay.tsx
git commit -m "feat: add crew message overlay component"
```

## Task 6: Integrasi SoundboardPage

**Files:**
- Modify: `src/routes/index.tsx`

- [ ] **Step 1: Import hook + component**

Setelah `import { useRemoteCrew } from "@/hooks/use-remote-crew";`:

```tsx
import { useCrewMessage } from "@/hooks/use-crew-message";
import { CrewMessageOverlay } from "@/components/CrewMessageOverlay";
```

- [ ] **Step 2: Pasang hook & render overlay + disable soundboard**

Di `SoundboardPage`, setelah `const remoteCrew = useRemoteCrew(...);`:

```tsx
const crewMessage = useCrewMessage(identityHydrated);
```

Render overlay (di akhir return, sebelum `</div>` akhir, setelah Stop button):

```tsx
{crewMessage.message && (
  <CrewMessageOverlay message={crewMessage.message} onClose={crewMessage.dismiss} />
)}
```

Blok soundboard: ubah disabled predicate yang ada menjadi mengecek `crewMessage.message`:

```tsx
tableDisabled={() => crewMessage.message !== null || activeAudioId !== null}
announcementDisabled={(audioId) => crewMessage.message !== null || loading !== null || (activeAudioId !== null && activeAudioId !== audioId)}
drawerDisabled={crewMessage.message !== null}
```

`activeAudioId !== null` tetap berlaku; suara berhenti tidak dipaksa.

- [ ] **Step 3: Typecheck & test**

Run: `npx tsc --noEmit` && `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/routes/index.tsx
git commit -m "feat: integrate crew message overlay on soundboard"
```

## Task 7: Form admin + mutation

**Files:**
- Modify: `src/routes/super-admin.tsx`
- Modify: `src/lib/super-admin-state.ts` (helper validasi)

- [ ] **Step 1: Import + state**

Di `super-admin.tsx` atas, import:

```tsx
import { sendCrewMessage } from "@/lib/remote-audio.server";
```

State tambahan di `SuperAdminPage`:

```tsx
const [messageText, setMessageText] = useState("");
const messageMutation = useMutation({
  mutationFn: sendCrewMessage,
  onSuccess: (result) => {
    if ("error" in result) {
      toast.error(result.error);
    } else if (result?.ok) {
      toast.success("Pesan terkirim.");
      setMessageText("");
    } else {
      toast.error("Realtime offline");
    }
  },
  onError: () => toast.error("Gagal mengirim pesan."),
});
```

import `toast` dari `"sonner"`.

- [ ] **Step 2: UI form di bawah select target (sebelum SoundboardGrid)**

Di JSX, setelah block `<div className="mt-5">...</select>...</div>` target crew (sekitar line 172), tambah:

```tsx
{selectedTarget && selectedTarget.audioReady && selectedTarget.state === "online" && (
  <div className="mt-5">
    <label className="text-sm font-bold">
      Pesan ke {selectedTarget.id === targetSessionId ? selectedTarget.display_name : ""}
    </label>
    <textarea
      className="brutal-border mt-1 w-full bg-background px-3 py-2 font-normal"
      maxLength={CREW_MESSAGE_MAX_LENGTH}
      value={messageText}
      onChange={(e) => setMessageText(e.target.value)}
      placeholder="Ketik pesan..."
      disabled={messageMutation.isPending}
    />
    <button
      type="button"
      className="brutal-border brutal-press mt-2 w-full bg-accent px-3 py-2 font-display uppercase"
      disabled={!messageText.trim() || messageMutation.isPending}
      onClick={() => {
        const result = validateCrewMessageRequest({ targetSessionId, message: messageText });
        if ("error" in result) return toast.error(result.error);
        messageMutation.mutate({ data: result });
      }}
    >
      Kirim Pesan
    </button>
  </div>
)}
```

Import `validateCrewMessageRequest` & `CREW_MESSAGE_MAX_LENGTH` dari `../lib/crew-message-domain`.

- [ ] **Step 3: Typecheck + lint + test**

Run: `npx tsc --noEmit` && `npm run lint`
Expected: 0 error.

- [ ] **Step 4: Commit**

```bash
git add src/routes/super-admin.tsx
git commit -m "feat: add crew message send form in super admin"
```

## Task 8: Full verification + commit final doc

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: semua pass, naik ~6 test baru (domain 8 + server 1 + integration source).

- [ ] **Step 2: Typecheck full**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: 0 error, pre-existing 6 warning saja.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: sukses.

- [ ] **Step 5: Commit final doc (plan sudah committed, optional changelog)**

```bash
git status --short --branch
```

Jika semua committed → siap finishing.

## Done

- [ ] cabang `feat/crew-message` siap finishing (audit + merge/PR).
