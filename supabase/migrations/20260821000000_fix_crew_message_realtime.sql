grant select on public.crew_messages to authenticated;

create policy "crew reads targeted messages"
on public.crew_messages
for select
to authenticated
using (target_session_id = auth.uid());
