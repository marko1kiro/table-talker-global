alter table public.restaurants
  add column pin_hash text
  check (pin_hash is null or pin_hash ~ '^[a-f0-9]{64}$');

-- PINs are set by authenticated owner action after deployment. No secret belongs in migration history.
