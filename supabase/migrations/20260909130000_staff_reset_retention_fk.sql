-- Preserve reset business rows when retention removes their limiter reservation.
-- The immutable attempt ledger and reservation are bounded-lived; a submitted
-- reset request remains the durable business record after those rows expire.

alter table public.manager_reset_requests
  drop constraint if exists manager_reset_requests_reservation_id_fkey;
alter table public.manager_reset_requests
  add constraint manager_reset_requests_reservation_id_fkey
  foreign key (reservation_id)
  references public.owner_login_rate_limit_reservations(id)
  on delete set null;

alter table public.am_reset_requests
  drop constraint if exists am_reset_requests_reservation_id_fkey;
alter table public.am_reset_requests
  add constraint am_reset_requests_reservation_id_fkey
  foreign key (reservation_id)
  references public.owner_login_rate_limit_reservations(id)
  on delete set null;
