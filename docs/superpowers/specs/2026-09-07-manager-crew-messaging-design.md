# Manager → Crew Messaging (Instruksi + ACK + Reply)

## Overview

Manager dapat mengirim instruksi ke 1 crew tertentu atau semua crew aktif dari Dashboard Manager. Crew wajib ACK (blocking banner). Crew bisa reply singkat (≤100 char). Manager melihat status ACK per-individu + reply inline (thread view).

## Data Model

### `manager_instructions`

| Column | Type | Constraint |
|---|---|---|
| id | uuid | PK, default gen_random_uuid() |
| restaurant_id | uuid | NOT NULL, FK → restaurants |
| manager_id | uuid | NOT NULL, FK → manager_accounts |
| target_type | text | NOT NULL, CHECK ('all', 'individual') |
| target_session_id | uuid | NULL, FK → crew_role_sessions (NULL kalau 'all') |
| message | text | NOT NULL, CHECK length ≤ 200 |
| created_at | timestamptz | NOT NULL, default now() |
| expires_at | timestamptz | NOT NULL (tengah malam WIB hari itu) |

### `instruction_receipts`

| Column | Type | Constraint |
|---|---|---|
| id | uuid | PK, default gen_random_uuid() |
| instruction_id | uuid | NOT NULL, FK → manager_instructions ON DELETE CASCADE |
| role_session_id | uuid | NOT NULL, FK → crew_role_sessions |
| ack_at | timestamptz | NULL (NULL = belum ACK) |
| reply_text | text | NULL, CHECK length ≤ 100 |
| replied_at | timestamptz | NULL |

- Unique constraint: `(instruction_id, role_session_id)`

### Expiry

- `expires_at` = tengah malam WIB hari instruksi dikirim.
  - Contoh: kirim 14:00 WIB (07:00 UTC) → expires 00:00 WIB besok (17:00 UTC hari itu).
- Cleanup cron: harian jam 02:00 WIB (19:00 UTC), DELETE `manager_instructions` WHERE `expires_at < now()`. Cascade deletes receipts.

## Realtime Delivery

Reuse private Broadcast channel `table-occupancy:{restaurantId}` yang sudah ada. Tambah 2 event baru:

### Event `instruction` (DB trigger AFTER INSERT on `instruction_receipts`)

Payload:
```json
{
  "instruction_id": "uuid",
  "message": "string",
  "target_session_id": "uuid | null",
  "manager_name": "string",
  "created_at": "iso8601"
}
```

### Event `instruction_ack` (DB trigger AFTER UPDATE on `instruction_receipts` WHERE ack_at changed)

Payload:
```json
{
  "instruction_id": "uuid",
  "role_session_id": "uuid",
  "display_name": "string",
  "ack_at": "iso8601",
  "reply_text": "string | null"
}
```

Crew filter: tampilkan banner kalau `target_session_id` NULL (all) atau match session sendiri.

## UI — Sisi Crew

### Blocking Banner (overlay)

- Full-width banner fixed di atas viewport, z-index tinggi, backdrop semi-transparent.
- Isi: icon megaphone + teks pesan + nama Manager pengirim + timestamp.
- 2 aksi:
  - Tombol **"TERIMA"** — ACK langsung tanpa reply.
  - Link teks **"Balas & Terima"** — expand input field (max 100 char) + tombol **"KIRIM"**.
- Banner **tidak bisa dismiss** tanpa ACK.
- Kalau ada >1 instruksi belum di-ACK, tampil stack — selesaikan satu per satu, yang terlama di atas.

### Catch-up saat login/reload

- Saat Crew masuk halaman role, server fn query `instruction_receipts` WHERE `ack_at IS NULL` AND `expires_at > now()`.
- Kalau ada pending → langsung tampilkan banner.

## UI — Sisi Manager Dashboard

### Tab "PESAN" di sidebar (samping MEJA, CREW, STATISTIK)

**Compose area (atas):**
- Dropdown target: "SEMUA CREW" atau pilih 1 crew dari list crew aktif hari ini.
- Textarea pesan (max 200 char, counter live).
- Tombol **"KIRIM INSTRUKSI"**.

**Message thread list (bawah):**
- List pesan hari ini, terbaru di atas.
- Tiap pesan card:
  - Header: teks pesan + timestamp + badge target ("SEMUA" atau nama crew).
  - Body: list receipt per crew:
    - `✓ Budi — 14:02 WIB` (ACK tanpa reply)
    - `✓ Ani — 14:05 WIB — "Siap pak"` (ACK + reply)
    - `✗ Ciko — belum dibaca` (pending, warna merah/abu)
  - Progress bar mini: "3/5 sudah terima".

**Realtime update:** event `instruction_ack` → receipt list update otomatis.

## Server Functions & RPCs

### RPCs (Postgres, security definer)

1. **`send_manager_instruction(p_manager_token, p_target_type, p_target_role_session_id, p_message)`**
   - Validasi manager session.
   - Insert `manager_instructions` dengan `expires_at` = tengah malam WIB.
   - `all`: query crew aktif hari ini (`crew_role_sessions` WHERE restaurant match + active), bulk insert `instruction_receipts`.
   - `individual`: insert 1 receipt.
   - Return instruction_id.
   - Error `NO_ACTIVE_CREW` kalau target 'all' tapi ga ada crew aktif.

2. **`ack_instruction(p_role_session_token, p_instruction_id, p_reply_text)`**
   - Validasi role session.
   - Update `instruction_receipts` SET `ack_at = now()`, `reply_text`, `replied_at`.
   - Idempotent: skip kalau `ack_at` sudah terisi.

3. **`get_pending_instructions(p_role_session_token)`**
   - Return `instruction_receipts` JOIN `manager_instructions` WHERE `ack_at IS NULL` AND `expires_at > now()` untuk session ini.

4. **`get_instruction_thread(p_manager_token, p_date)`**
   - Return semua `manager_instructions` hari itu + nested `instruction_receipts` dengan `display_name` dari `crew_role_sessions`.

### Server fns (TanStack createServerFn)

- `sendManagerInstruction` — wrapper RPC 1
- `ackInstruction` — wrapper RPC 2
- `getPendingInstructions` — wrapper RPC 3
- `getInstructionThread` — wrapper RPC 4

### DB Triggers (Broadcast)

- AFTER INSERT on `instruction_receipts` → broadcast `instruction` event ke `table-occupancy:{restaurant_id}`.
- AFTER UPDATE on `instruction_receipts` WHERE `ack_at` changed → broadcast `instruction_ack` event.

## Error Handling & Edge Cases

1. **Crew offline saat instruksi dikirim** — Receipt tetap dibuat di DB. Catch-up via `get_pending_instructions` saat reload.
2. **Crew logout mid-shift** — Pending instructions hilang dari view (session ended). Manager lihat status tetap `✗ belum dibaca`.
3. **Manager kirim "SEMUA" tapi ga ada crew aktif** — RPC return error `NO_ACTIVE_CREW`. UI tampil toast.
4. **Double ACK** — Idempotent, skip update, return success.
5. **Pesan expired** — Banner auto-dismiss client-side (timer check `expires_at`). Crew ga perlu ACK pesan expired.
6. **Race condition: crew check-in setelah "SEMUA" dikirim** — Crew baru ga dapat instruksi lama. By design.

## Testing Strategy

1. **Domain unit tests:**
   - `expires_at` calculation (tengah malam WIB)
   - Message length validation (≤200 char instruction, ≤100 char reply)
   - Target type validation

2. **RPC integration tests (source-assertion pattern):**
   - `send_manager_instruction` — insert + correct receipt count
   - `ack_instruction` — updates receipt, idempotent double ACK
   - `get_pending_instructions` — returns only unacked + unexpired
   - `get_instruction_thread` — full thread with receipts

3. **UI component tests:**
   - Blocking banner renders with message + buttons
   - Reply expand/collapse
   - Manager compose form validation
   - Receipt list display (ACK/pending states)

4. **Realtime tests:**
   - Broadcast event `instruction` fired on receipt insert
   - Broadcast event `instruction_ack` fired on ACK update

Testing convention: source-assertion + pure unit (no jsdom).
