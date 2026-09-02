do $$
declare
  v_old_prefix constant text := 'https://pub-b2b476c3360c4559bfc048819136744f.r2.dev/';
  v_new_prefix constant text := 'https://static.lihatmeja.com/';
begin
  update public.audio_manifests
  set r2_url = v_new_prefix || substr(r2_url, length(v_old_prefix) + 1)
  where left(r2_url, length(v_old_prefix)) = v_old_prefix;
end;
$$;
