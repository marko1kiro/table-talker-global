alter table public.restaurants
  add column pin_hash text
  check (pin_hash is null or pin_hash ~ '^[a-f0-9]{64}$');

-- Deployment must set app.pilot_restaurant_pin_hash to SHA-256(PILOT_RESTAURANT_PIN).
-- No plaintext PIN is stored in source, migration, or database history.
update public.restaurants
set pin_hash = current_setting('app.pilot_restaurant_pin_hash', true)
where lower(code) = 'kampung-bulu'
  and pin_hash is null
  and current_setting('app.pilot_restaurant_pin_hash', true) ~ '^[a-f0-9]{64}$';
