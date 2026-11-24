insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('creator-music','creator-music',true,52428800,array['audio/mpeg']);
create table public.tracks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  title text not null check (length(trim(title)) between 1 and 150),
  release_name text check (length(release_name) <= 150),
  credits text check (length(credits) <= 1000),
  audio_path text unique not null check (audio_path ~ ('^' || user_id::text || '/[a-f0-9-]{36}\.mp3$')),
  created_at timestamptz not null default now()
);
create index tracks_creator on public.tracks(user_id,created_at desc);
alter table public.tracks enable row level security;
revoke all on public.tracks from public, anon, authenticated;
grant select on public.tracks to anon, authenticated;
grant insert (user_id,title,release_name,credits,audio_path) on public.tracks to authenticated;
create policy "Listen to published tracks" on public.tracks for select using (true);
create policy "Publish own track" on public.tracks for insert to authenticated
  with check (user_id = (select auth.uid()) and exists
    (select 1 from storage.objects where bucket_id='creator-music' and name=audio_path));
create policy "Upload own recordings" on storage.objects for insert to authenticated
  with check (bucket_id='creator-music' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "View own recording files" on storage.objects for select to authenticated
  using (bucket_id='creator-music' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "Remove unpublished uploads" on storage.objects for delete to authenticated
  using (bucket_id='creator-music' and (storage.foldername(name))[1]=(select auth.uid())::text
    and not exists (select 1 from public.tracks where audio_path=name));
alter table public.posts add column track_id uuid references public.tracks on delete set null;
