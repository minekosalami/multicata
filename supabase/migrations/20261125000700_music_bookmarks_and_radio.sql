create function public.search_music(mode text, start_at int, take int, wanted uuid, search_text text)
returns table(id uuid,user_id uuid,title text,artist text,release_name text,credits text,audio_path text,art text,likes bigint,my_vote int,saved boolean)
language sql stable security definer set search_path='' as $$
 select k.id,coalesce(t.user_id,k.archive_owner),coalesce(t.title,'GrassCats Pop'),coalesce(p.username,case when k.track_id is null then 'LLiosette' else 'Member' end),
 coalesce(t.release_name,case when k.track_id is null then 'GrassCats' end),coalesce(t.credits,case when k.track_id is null then 'Unmixed & Unmastered' end),
 t.audio_path,t.art_path,v.likes,coalesce(m.value,0)::int,f.owner is not null
 from public.music_keys k left join public.tracks t on t.id=k.track_id
 left join lateral(select pr.username,pr.profile_picture from public.profiles pr where pr.user_id=coalesce(t.user_id,k.archive_owner) order by pr.username nulls last,pr.id limit 1)p on true
 cross join lateral(select count(*) likes from public.music_votes x where x.record_id=k.id and x.value=1)v
 left join public.music_votes m on m.record_id=k.id and m.owner=auth.uid()
 left join public.music_favorites f on f.record_id=k.id and f.owner=auth.uid()
 where (wanted is null or k.id=wanted) and public.mc_available(coalesce(t.user_id,k.archive_owner)) and mode in ('recent','liked','favorites','following')
 and (mode<>'favorites' or f.owner is not null) and (mode<>'following' or exists(select from public.follows w where w.owner=auth.uid() and w.peer=coalesce(t.user_id,k.archive_owner)))
 and (coalesce(trim(search_text),'')='' or
      strpos(lower(coalesce(t.title,'GrassCats Pop')),lower(trim(search_text)))>0 or
      strpos(lower(coalesce(p.username,case when k.track_id is null then 'LLiosette' else 'Member' end)),
            lower(coalesce(nullif(ltrim(trim(search_text),'@'),''),trim(search_text))))>0 or
      strpos(lower(coalesce(t.release_name,case when k.track_id is null then 'GrassCats' else '' end)),lower(trim(search_text)))>0)
 order by case when mode='liked' then v.likes end desc,case when mode='favorites' then f.saved_at end desc,t.created_at desc nulls last,k.id
 limit least(greatest(take,1),100) offset greatest(start_at,0)
$$;

-- Keep the existing public RPC signature for track links, profiles and older clients.
create or replace function public.music_page(mode text default 'recent', start_at int default 0, take int default 12, wanted uuid default null)
returns table(id uuid,user_id uuid,title text,artist text,release_name text,credits text,audio_path text,art text,likes bigint,my_vote int,saved boolean)
language sql stable security definer set search_path='' as $$
 select * from public.search_music(mode,start_at,take,wanted,'')
$$;
revoke all on function public.search_music(text,int,int,uuid,text) from public;
grant execute on function public.search_music(text,int,int,uuid,text) to anon,authenticated;

create table public.article_bookmarks (
 member uuid not null default auth.uid() references auth.users on delete cascade,
 article uuid not null references public.articles on delete cascade,
 saved boolean not null default true,
 saved_at timestamptz not null default now(),
 primary key(member,article)
);
alter table public.article_bookmarks enable row level security;
revoke all on public.article_bookmarks from public,anon,authenticated;
grant select,insert(article,saved),update(saved,saved_at) on public.article_bookmarks to authenticated;
create policy read_bookmarks on public.article_bookmarks for select to authenticated using(member=auth.uid());
create policy change_bookmarks on public.article_bookmarks for update to authenticated using(member=auth.uid()) with check(member=auth.uid());
create policy save_bookmarks on public.article_bookmarks for insert to authenticated with check
 (member=auth.uid() and exists(select from public.articles a where a.id=article and a.published));

-- Import never overwrites a later explicit save or removal on another device.
create function public.import_article_bookmarks(items uuid[]) returns void
language sql security invoker set search_path='' as $$
 insert into public.article_bookmarks(article)
 select a.id from public.articles a where a.id=any(items) and a.published
 on conflict do nothing
$$;
create function public.set_article_bookmark(target uuid, desired boolean) returns void
language sql security invoker set search_path='' as $$
 insert into public.article_bookmarks(article,saved) values(target,desired)
 on conflict(member,article) do update set saved=excluded.saved,saved_at=now()
$$;
create function public.saved_articles(start_at int default 0) returns table(id uuid,title text)
language sql stable security invoker set search_path='' as $$
 select a.id,a.title from public.article_bookmarks b join public.articles a on a.id=b.article
 where b.member=auth.uid() and b.saved and a.published order by b.saved_at desc,a.id limit 50 offset greatest(start_at,0)
$$;
revoke all on function public.import_article_bookmarks(uuid[]),public.set_article_bookmark(uuid,boolean),public.saved_articles(int) from public,anon;
grant execute on function public.import_article_bookmarks(uuid[]),public.set_article_bookmark(uuid,boolean),public.saved_articles(int) to authenticated;

create or replace function public.radio_state() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; t timestamptz;
begin
 perform pg_advisory_xact_lock(20945,1);
 t:=clock_timestamp();
 if not mc_radio.advance(t) then
  return jsonb_build_object('recovering',true,'server_time',t,'votes','[]'::jsonb,'scheduled','[]'::jsonb,'history','[]'::jsonb);
 end if;
 select jsonb_build_object('server_time',t,'manual',s.manual,'current',to_jsonb(h),'round',s.round_id,
  'votes',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'artist',a.artist,
   'count',(select count(*) from mc_radio.votes where round_id=s.round_id and asset=a.id),
   'selected',exists(select from mc_radio.votes where round_id=s.round_id and member=auth.uid() and asset=a.id)) order by i.n)
   from unnest(s.candidates) with ordinality i(id,n) join mc_radio.assets a on a.id=i.id where a.approved),'[]'),
  'history',coalesce((select jsonb_agg(to_jsonb(r) order by id desc) from
    (select * from mc_radio.history where id is distinct from s.current_id order by id desc limit 6) r),'[]'),
  'up_next',(select a.title from mc_radio.queue q join mc_radio.assets a on a.id=q.asset and a.approved
    where q.due is null or q.due<=least(h.ends,(select min(due) from mc_radio.queue where timing='exact' and due>h.started))
    order by case q.timing when 'exact' then 0 when 'after' then 1 else 2 end,q.due,q.position,q.id limit 1),
  'scheduled',coalesce((select jsonb_agg(jsonb_build_object('title',a.title,'timing',q.timing,'due',q.due) order by q.due,q.id)
   from mc_radio.queue q join mc_radio.assets a on a.id=q.asset where due is not null),'[]'))
 into result from mc_radio.station s left join mc_radio.history h on h.id=s.current_id;
 return result;
end$$;
