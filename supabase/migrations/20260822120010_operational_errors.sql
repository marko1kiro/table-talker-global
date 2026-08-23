create table public.operational_errors (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid
    constraint operational_errors_restaurant_id_fkey
    references public.restaurants (id) on delete set null,
  stage text not null,
  report_code text not null,
  detail text,
  device_id text,
  crew_session_id text,
  occurred_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index operational_errors_unresolved_idx
  on public.operational_errors (occurred_at desc)
  where resolved_at is null;

create index operational_errors_restaurant_idx
  on public.operational_errors (restaurant_id, occurred_at desc);

alter table public.operational_errors enable row level security;
revoke all on public.operational_errors from anon, authenticated;

-- Error reporting via RPC (service-role)
-- Admin reads via service-role
