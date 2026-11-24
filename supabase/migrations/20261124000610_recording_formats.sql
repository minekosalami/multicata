alter table public.tracks
  drop constraint tracks_check,
  add constraint tracks_audio_path_format check (
    audio_path ~ ('^' || user_id::text || '/[a-f0-9-]{36}\.(mp3|wav|flac|m4a|ogg|oga|opus)$')
  );

update storage.buckets
set allowed_mime_types = array['audio/mpeg', 'audio/wav', 'audio/flac', 'audio/mp4', 'audio/ogg']
where id = 'creator-music';
