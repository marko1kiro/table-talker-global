update public.playback_events pe
set restaurant_id = cs.restaurant_id
from public.crew_sessions cs
where pe.restaurant_id is null and pe.crew_session_id = cs.id;

delete from public.playback_events where restaurant_id is null;

alter table public.playback_events
  alter column restaurant_id set not null;
