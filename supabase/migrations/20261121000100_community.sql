-- Apply after review. Existing profiles and text-only posts keep their defaults.
alter table public.profiles
  add column banner_path text,
  add column background_path text,
  add column background_color text check (background_color ~ '^#[0-9a-fA-F]{6}$'),
  add column accent_color text check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  add column social_links text[] not null default '{}' check (cardinality(social_links) <= 5);
alter table public.posts add column image_path text,
  add column track text check (track in ('grasscats-pop'));
create policy "Authors can edit posts" on public.posts for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant update (content) on public.posts to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community-images', 'community-images', true, 5242880, array['image/jpeg','image/png']);
create policy "Upload own community images" on storage.objects for insert to authenticated
  with check (bucket_id = 'community-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Read own community file metadata" on storage.objects for select to authenticated
  using (bucket_id in ('community-images','avatars') and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Remove own community images" on storage.objects for delete to authenticated
  using (bucket_id = 'community-images' and (storage.foldername(name))[1] = (select auth.uid())::text
    and not exists (select 1 from public.profiles p where name in (p.banner_path,p.background_path)));


-- Existing avatar files remain readable. Restrict new uploads to the editor's formats.
update storage.buckets set allowed_mime_types = array['image/jpeg','image/png'] where id = 'avatars';
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('post-images','post-images',false,5242880,array['image/jpeg','image/png']);
create policy "Attach own post image" on storage.objects for insert to authenticated
  with check (bucket_id='post-images' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "Read attached post images" on storage.objects for select to authenticated
  using (bucket_id='post-images' and ((storage.foldername(name))[1]=(select auth.uid())::text
    or exists(select 1 from public.posts p where p.image_path=name and p.user_id::text=(storage.foldername(name))[1])));
create policy "Remove own post image" on storage.objects for delete to authenticated
  using (bucket_id='post-images' and (storage.foldername(name))[1]=(select auth.uid())::text
    and not exists(select 1 from public.posts p where p.image_path=name));
alter table public.posts add check (image_path is null or split_part(image_path,'/',1)=user_id::text);
