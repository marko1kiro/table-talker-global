create table public.restaurant_sessions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null
    constraint restaurant_sessions_restaurant_id_fkey
    references public.restaurants (id) on delete restrict,
  session_date date not null default current_date,
  created_at timestamptz not null default now()
);

create unique index restaurant_sessions_restaurant_date_key
  on public.restaurant_sessions (restaurant_id, session_date);

alter table public.restaurant_sessions enable row level security;
revoke all on public.restaurant_sessions from anon, authenticated;
