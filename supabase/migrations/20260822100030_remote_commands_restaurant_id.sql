-- Add restaurant_id to remote_commands
alter table public.remote_commands
  add column restaurant_id uuid;

-- Backfill from crew_sessions via target_session_id
update public.remote_commands rc
  set restaurant_id = cs.restaurant_id
  from public.crew_sessions cs
  where rc.target_session_id = cs.id;

-- Set NOT NULL after backfill
alter table public.remote_commands
  alter column restaurant_id set not null;

alter table public.remote_commands
  add constraint remote_commands_restaurant_id_fkey
  foreign key (restaurant_id) references public.restaurants (id) on delete restrict;
