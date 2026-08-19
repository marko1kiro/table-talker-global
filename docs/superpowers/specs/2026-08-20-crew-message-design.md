# Crew Message — Design

**Tanggal:** 2026-08-20
**Status:** Disetujui
**Pemilik:** miracle1min
**Prasyarat:** [Crew Session Continuity](2026-08-15-crew-session-continuity-design.md) (Supabase Realtime, service-role server fn, crew_sessions targetting)

## Goal

Super Admin dapat mengirim pesan teks ke crew device tertentu. Pesan muncul sebagai overlay penuh secara realtime di UI crew, otomatis menghilang setelah 5 detik, dengan tombol manual berlabel **"OK Bang!"** untuk menutup lebih cepat. Suara yang sedang berputar tetap berputar; overlay hanya menonaktifkan interaksi soundboard.

## Context

Soundboard dipasang di device kounter (tablet kios). Crew butuh beri tahu meja/kondisi secara real-time (mis. "meja 5 lapor ke dapur"). Fitur ini memanfaatkan infrastruktur realtime yang sama dengan remote audio (`remote_commands`), hanya berbeda payload (teks).

Pakai **Screen Wake Lock (auto-on)** ga terhubung langsung — overlay muncul di layer atas, tidak mematikan wake lock. Namun, overlay tidak perlu `position: fixed` full bleed berkat wake lock mencegah display mati saat terbuka.

## Scope

### Termasuk

- Tabel `public.crew_messages` + RPC `create_crew_message` (service_role only).
- Server fn `sendCrewMessage` (auth super admin) untuk insert.
- Supabase Realtime broadcast ke crew target via `postgres_changes` INSERT filter `target_session_id = auth.uid()`.
- Hook `useCrewMessage` (subscribe realtime + timer auto 5s + dedupe).
- `CrewMessageOverlay` komponen: full-screen, brutal, tombol "OK Bang!".
- Integrasi di SoundboardPage: blok interaksi soundboard saat overlay terbuka; suara tetap berputar.
- Form kirim pesan di panel Super Admin (textarea ≤200 char + target dari snapshot).

### Tidak termasuk (YAGNI)

- Riwayat / log pesan di DB (tidak disimpan).
- Pemilihan template (input bebas saja).
- Pesan broadcast ke semua crew (hanya per-target, sama seperti remote audio).
- Stop suara otomatis saat overlay muncul (biarkan berputar sampai selesai).

## Architecture

### Tabel & RPC — `supabase/migrations/YYYY-MM-DD-crew-messages.sql`

```sql
create table public.crew_messages (
  id uuid primary key default gen_random_uuid(),
  target_session_id uuid not null references public.crew_sessions(id) on delete cascade,
  message text not null check (char_length(message) <= 200),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index crew_messages_target_idx on public.crew_messages (target_session_id);

-- cleanup expired (bisa dipanggil oleh job cron harian):
create or replace function public.cleanup_expired_crew_messages()
  returns void
  language sql security definer as $$
    delete from public.crew_messages where expires_at < now();
  $$;

-- insert + broadcast:
create or replace function public.create_crew_message(
  p_target_session_id uuid,
  p_message text,
  p_expires_in_seconds bigint default 5
)
  returns uuid
  language plpgsql security definer as $$
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

-- hak akses sama seperti remote_commands:
revoke all on public.crew_messages from public, anon, authenticated;
revoke all on function public.create_crew_message(uuid, text, bigint), public.cleanup_expired_crew_messages() from public, anon, authenticated;
grant execute on function public.create_crew_message(uuid, text, bigint) to service_role;
grant execute on function public.cleanup_expired_crew_messages() to service_role;
-- crew tidak perlu SELECT langsung; realtime broadcast cukup:
alter publication supabase_realtime add table public.crew_messages;
```

- `make_interval(secs => p_expires_in_seconds)` = 5s default.
- `target_session_id` FK ke `crew_sessions` (uuid), cascade delete.
- RLS enable; revoke ke anon/authenticated (crew dapat via realtime saja).

### Server Function — `src/lib/remote-audio.server.ts`

Tambahkan:

```ts
const crewMessageSchema = z.object({
  targetSessionId: z.string().uuid(),
  message: z.string().min(1).max(200),
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

- Auth `requireSuperAdmin()` + `getServiceClient()` (service_role) — pola sama `sendRemoteCommand`.
- Return `{ok}` / `{error}` / `{offline}`; tidak perlu cek target eligible (queue sampai expired).

### Pure Domain — `src/lib/crew-message-domain.ts`

```ts
export const CREW_MESSAGE_MAX_LENGTH = 200;
export const CREW_MESSAGE_TTL_MS = 6_000; // sedikit > expires_at 5s, agar replay stale dibuang

export function validateCrewMessageRequest(input: { targetSessionId: string; message: string }) {
  if (!targetSessionIdFormat check ok) return { error: "Crew target tidak valid." };
  if (message.trim().length === 0) return { error: "Pesan kosong." };
  if (message.length > CREW_MESSAGE_MAX_LENGTH) return { error: "Pesan maksimal 200 karakter." };
  return { targetSessionId, message };
}
```

- `processedIds` dedupe: reuse `pruneProcessedCommands` existing (parametrik, generic)? Lebih bersih: buat helper `dedupeById` sederhana di domain. YAGNI reuse; buat sendiri agar scope terisolasi.

```ts
export type CrewMessage = { id: string; message: string };

export function pruneDeliveredIds(
  delivered: Map<string, number>,
  now: number,
  maxAgeMs = CREW_MESSAGE_TTL_MS,
  maxCount = 64,
) { ... prune by expiresAt <= now - maxAgeMs and count cap ... }
```

### Hook — `src/hooks/use-crew-message.ts`

- Subscribe `postgres_changes` INSERT `crew_messages` filter `target_session_id=eq.<userId>` via `getSupabaseBrowserClient()` (anon client).
- State: `{ message: string | null }`.
- Dedupe `processedIds: Map<id, deliveredAt>` (TTL 6s), prune tiap insert.
- Timer: `setTimeout(5000)` clear message; reset timer kalau message baru (clear + jadwalkan baru).
- Visibility: hanya render saat `document.visibilityState === "visible"`. Jika muncul saat hidden, simpan last message, render saat visible. (Sederhana: set message state saat visible aja; kalau sampai INSERT saat hidden, biarkan — realtime tetap kirimkan tiap visible.)
- Cleanup: unsubscribe channel + clearTimeout unmount.
- `visibleOnly` guard supaya tidak subscribe saat `registration` null (belum login crew).

```ts
export function useCrewMessage(registration: CrewIdentity | null) {
  const [message, setMessage] = useState<CrewMessage | null>(null);
  ...
  useEffect(() => {
    if (!registration) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const channel = client.channel(`crew-messages:${userId}`).on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "crew_messages", filter: `target_session_id=eq.${userId}` },
      ({ new: row }) => { onCrewMessage(row as CrewMessageRow) }
    ).subscribe(...)
    return unsubscribe;
  }, [registration]);
}
```

### UI — `src/components/CrewMessageOverlay.tsx`

- Full-screen fixed (z-[70]), brutal border, center flex.
- Props: `{ message: string; onClose: () => void }`.
- Tombol **OK Bang!** (label eksak): klik → `onClose`.
- Auto-close via timer di parent (hook), bukan di komponen.
- Sembunyikan `SoundboardGrid` interactivity: parent set `interactionBlocked` — tetap render soundboard, tapi `tableDisabled={() => interactionBlocked || ...}`, dan stop button tidak di-arahkan (overlay menutupinya). Suara berhenti/manual bisa via stop button? Tidak — overlay di atas. Klik "OK Bang!" baru bisa. Ini konsisten "suara tetap berputar, interaksi diblok".

### Integrasi — `src/routes/index.tsx` (SoundboardPage)

1. Pasang `const crewMessage = useCrewMessage(identityHydrated ? crewIdentity : null);` (mirip `useRemoteCrew` — pass identity atau null).
2. Render `{crewMessage.message && <CrewMessageOverlay message={crewMessage.message} onClose={crewMessage.dismiss} />}`.
3. `SoundboardGrid` props: `tableDisabled={() => !!crewMessage.message || activeAudioId !== null}`.
4. Wake lock tetap aktif (jika terpasang). Overlay tidak menonaktifkan wake lock (diperlukan agar layar tetap nyala saat overlay, supaya crew baca pesan).
5. Sembari overlay, `activeAudioId` tetap jalan — tidak panggil `stop()`. Suara selesai atau manual lewat... stop button terhalang. Bisa: tambahkan `stop` tetap bisa lewat `Esc`? Tidak perlu — keep simple, "OK Bang!" dulu.

### Admin UI — `src/routes/super-admin.tsx`

- Setelah panel milih `targetSessionId` (sudah ada di state `super-admin-state.ts`), tambah form: `<textarea maxLength={200} value={messageText} onChange=... />` + button "Kirim Pesan" → `sendCrewMessage({targetSessionId, message})`.
- Disable saat tidak ada target atau textarea kosong, atau submitting.
- State error/success toast via `sonner` (exist dep).

## Data Flow

1. Admin klik "Kirim Pesan" → server fn `sendCrewMessage` → `requireSuperAdmin` valid → RPC `create_crew_message` insert row.
2. Supabase Realtime broadcast INSERT pada publikasi `supabase_realtime`.
3. Crew anon client menerima `postgres_changes` INSERT (channel filter `target_session_id = <uid>`).
4. Hook valid (uuid, belum delivered), set `message`, jadwalkan timer 5s.
5. Overlay render di atas soundboard; tombol meja disabled.
6. 5s habis → timer clear `message`, overlay hilang, soundboard kembali interaktif. Klik "OK Bang!" → clear timer + clear message.

## Error Handling

- `MESSAGE_TOO_LONG` → `{error: "Pesan maksimal 200 karakter."}`.
- Channel error/offline → log; tidak break soundboard. Jika crew disconnect saat overlay terbuka, timer tetap berjalan (local) → hilang otomatis.
- Replay duplicate real-time: `processedIds` dedupe (TTL 6s), mirip crew command.
- `requireSuperAdmin` gagal / env service role missing → `offline()` (same behavior `sendRemoteCommand`).

## Testing

- `tests/crew-message-domain.test.ts`:
  - `validateCrewMessageRequest`: uuid valid, empty message, >200 chars.
  - `pruneDeliveredIds`: hapus expired + count cap.
- `tests/use-crew-message.test.ts`:
  - Pure coordinator `deliverCrewMessage`: dedupe id duplikat, timer reset, visibility hidden tidak set message.
  - Use a pure helper `createCrewMessageCoordinator` exported from domain (mirip `createVisibleClaimCoordinator` pattern) agar testable tanpa jsdom.
- Source assertion: `src/routes/index.tsx` mengandung `useCrewMessage(`.

## References

- Pola ekivalen: `sendRemoteCommand` + `useRemoteCrew` + `create_channel_status_handler` (`src/hooks/use-remote-crew.ts`, `src/lib/remote-audio.server.ts`).
- RLS pattern di migration `20260812000000_super_admin_remote_audio.sql` (revoke/ke grant service_role/authenticated).
- Wake lock integrasi: `docs/superpowers/specs/2026-08-20-screen-wake-lock-design.md` (overlay tidak menonaktifkan wake lock).