revoke select on public.audio_manifests from authenticated;
drop policy if exists "crew reads restaurant manifests" on public.audio_manifests;
