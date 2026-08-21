create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  display_name text not null check (char_length(display_name) between 1 and 80),
  is_active boolean not null default true,
  deactivated_reason text,
  catalog_version integer not null default 1 check (catalog_version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index restaurants_code_key on public.restaurants (lower(code));

insert into public.restaurants (code, display_name)
values ('KAMPUNG-BULU', 'Mie Gacoan Kampung Bulu')
on conflict (lower(code)) do nothing;

alter table public.restaurants enable row level security;
revoke all on public.restaurants from anon, authenticated;
