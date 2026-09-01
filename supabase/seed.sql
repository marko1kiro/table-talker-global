-- Dev/CI seed data (H-03, 2026-09-02). Only ever applied by
-- `supabase db reset` against a local/CI database -- `supabase db push`
-- against a linked project (production) never touches this file.
--
-- Restaurant identity + Kode Resto values below are the same 9 real rows
-- that used to be backfilled inline inside
-- supabase/migrations/20260831000000_plaintext_restaurant_code.sql (moved
-- here unchanged, per Kode Resto's established "not a secret" status --
-- see src/lib/restaurant-code.server.ts). PINs (ID Resto) are the actual
-- security boundary added in this Fase-1 change and are NEVER put in git in
-- any form, hashed or not: a 4-digit PIN space is only 10,000 values, so a
-- committed sha256 hash of a real PIN would be trivially brute-forceable
-- offline by anyone who can read this file. Every seeded restaurant below
-- instead gets an obviously-fake, sequential dev PIN (9001-9009, chosen to
-- not collide with any real production PIN range), hashed inline by
-- Postgres at seed time -- never written out as a literal hash. They must
-- be distinct because restaurants.pin_hash carries a unique constraint
-- (restaurants_pin_hash_unique). Anyone restoring real production PINs into
-- a non-production database must do so out-of-band via the same admin flow
-- used in production, never by editing this file.

insert into public.restaurants (id, code, display_name, is_active, code_version, credential_rotated_at, pin_hash)
values
  ('b519a58f-1ecb-4131-9c69-4fa2a1bae18a', 'BKSBAN', 'Bantar Gebang Sétu', true, 1, now(), encode(extensions.digest('9001', 'sha256'), 'hex')),
  ('08da5334-4244-4db7-9f63-74a0d675529c', 'BKSMUT', 'Cut Mutia', true, 1, now(), encode(extensions.digest('9002', 'sha256'), 'hex')),
  ('19b17c7c-8847-466e-a2f7-215787d361c6', 'CKRTHA', 'M.H. Thamrin', true, 1, now(), encode(extensions.digest('9003', 'sha256'), 'hex')),
  ('09828e0e-77f1-432c-81bc-3f5b82bf7ba3', 'CKRTAR', 'Tarum Barat', true, 1, now(), encode(extensions.digest('9004', 'sha256'), 'hex')),
  ('51a23c85-7e72-4395-ba88-710cfbc200e8', 'CKRMAR', 'R.E. Martadinata', true, 1, now(), encode(extensions.digest('9005', 'sha256'), 'hex')),
  ('10587808-9ab2-42b2-a190-e2205c25c2a2', 'CKRCIK', 'Cikoronjo Cibarusah', true, 1, now(), encode(extensions.digest('9006', 'sha256'), 'hex')),
  ('33916a05-7e95-42fa-bc3c-050bed2402c5', 'CKRBUL', 'Kampung Bulu', true, 1, now(), encode(extensions.digest('9007', 'sha256'), 'hex')),
  ('98aa2a5c-560c-42e3-ace6-e8561cb40f62', 'BKSGOL', 'Golden City', true, 1, now(), encode(extensions.digest('9008', 'sha256'), 'hex')),
  ('fa2dea0f-8c68-4c2f-bb72-17c34825c61e', 'CKRBOS', 'Bosih Raya', true, 1, now(), encode(extensions.digest('9009', 'sha256'), 'hex'))
on conflict (id) do nothing;
