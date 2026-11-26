-- Internal tables and transition helpers are outside the Data API.
create schema mc_radio;
revoke all on schema mc_radio from public, anon, authenticated;

create function public.radio_can_edit() returns boolean language sql stable security definer
set search_path='' as $$
 select coalesce(auth.uid()='fd38626e-243b-43f2-aa00-365b23380bb0' and exists
   (select from public.article_moderators where member=auth.uid()), false)
$$;

create table mc_radio.assets (
 id uuid primary key default gen_random_uuid(),
 music uuid unique references public.music_keys on delete cascade,
 path text unique, title text not null check(length(trim(title)) between 1 and 150),
 artist text not null, profile uuid, art text, provider text not null,
 seconds double precision not null check(seconds >= 1 and seconds < 'Infinity'),
 approved boolean not null default true,
 check ((music is null) = (provider='announcement'))
);
create table mc_radio.queue (
 id bigint generated always as identity primary key, asset uuid not null references mc_radio.assets on delete cascade,
 timing text not null check(timing in ('queue','exact','after')), due timestamptz, position bigint not null,
 check ((due is null) = (timing='queue'))
);
create index radio_due on mc_radio.queue(due);
create table mc_radio.history (
 id bigint generated always as identity primary key, item jsonb not null, started timestamptz not null, ends timestamptz not null
);
create index radio_history_time on mc_radio.history(started desc);
create table mc_radio.station (
 singleton boolean primary key default true check(singleton), manual boolean not null default false,
 current_id bigint references mc_radio.history, round_id uuid, candidates uuid[] not null default '{}',
 held uuid references mc_radio.assets on delete set null
);
insert into mc_radio.station default values;
create table mc_radio.votes (
 round_id uuid not null, member uuid not null references auth.users on delete cascade,
 asset uuid not null references mc_radio.assets on delete cascade, primary key(round_id,member)
);
create table mc_radio.audit (
 id bigint generated always as identity primary key, member uuid, changed timestamptz not null default now(),
 action text not null, details jsonb not null
);

create table public.radio_updates (id boolean primary key check(id), revision bigint not null default 0);
insert into public.radio_updates values(true,0);
alter table public.radio_updates enable row level security;
revoke all on public.radio_updates from public,anon,authenticated;
grant select on public.radio_updates to anon,authenticated;
create policy read_radio_update on public.radio_updates for select using(true);
do $$begin
 if exists(select from pg_publication where pubname='supabase_realtime') then
   alter publication supabase_realtime add table public.radio_updates;
 end if;
end$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('radio-announcements','radio-announcements',true,52428800,
 array['audio/mpeg','audio/wav','audio/flac','audio/mp4','audio/ogg','audio/webm']);
create policy radio_upload on storage.objects for insert to authenticated with check
 (bucket_id='radio-announcements' and public.radio_can_edit() and name ~
 ('^'||auth.uid()::text||'/[0-9a-f-]{36}\.(mp3|wav|flac|m4a|ogg|oga|opus|webm)$'));
create policy radio_read_upload on storage.objects for select to authenticated using
 (bucket_id='radio-announcements' and public.radio_can_edit());

create function mc_radio.open_round() returns void language sql set search_path='' as $$
 update mc_radio.station s set round_id=gen_random_uuid(),
 candidates=array(select a.id from mc_radio.assets a where approved and music is not null
 order by (a.id::text=coalesce((select item->>'id' from mc_radio.history where id=s.current_id),'')),
 exists(select from (select item->>'id' as played from mc_radio.history order by id desc limit 3) r where r.played=a.id::text),
 random() limit 4)
$$;

-- Replay elapsed boundaries using their original time, including when the station had no listeners.
create function mc_radio.advance(horizon timestamptz, skip_current boolean default false, forced_queue bigint default null) returns boolean
language plpgsql set search_path='' as $$
declare s mc_radio.station; h mc_radio.history; picked mc_radio.assets; q mc_radio.queue;
 boundary timestamptz; interruption timestamptz; winner uuid; next_id bigint; changed boolean:=false; steps integer:=0;
begin
 select * into s from mc_radio.station for update;
 loop
  select * into h from mc_radio.history where id=s.current_id;
  if h.id is null then
   select min(due) into boundary from mc_radio.queue;
   boundary:=least(horizon,boundary);
  else
   select min(due) into interruption from mc_radio.queue where timing='exact' and due>h.started;
   boundary:=least(h.ends,interruption);
   if skip_current then boundary:=least(boundary,horizon); skip_current:=false; end if;
  end if;
  exit when boundary>horizon;
  -- Commit progress in bounded batches after a long infrastructure suspension.
  if steps=256 then update public.radio_updates set revision=revision+1;return false;end if;
  steps:=steps+1;
  select * into q from mc_radio.queue where due<=boundary or due is null
   order by case when id=forced_queue then -1 when timing='exact' then 0 when timing='after' then 1 else 2 end,due,position,id limit 1;
  select v.asset into winner from mc_radio.votes v join mc_radio.assets a on a.id=v.asset
   where v.round_id=s.round_id and a.approved group by v.asset order by count(*) desc, random() limit 1;
  if q.id is not null then
   select * into picked from mc_radio.assets where id=q.asset and approved;
   delete from mc_radio.queue where id=q.id;
   s.held:=coalesce(s.held,winner);
  else
   select * into picked from mc_radio.assets where approved and music is not null
    order by (id=coalesce(s.held,winner)) desc nulls last,
      (id::text=coalesce(h.item->>'id','')),
      exists(select from (select item->>'id' as played from mc_radio.history order by id desc limit 3) r where r.played=id::text),
      random() limit 1;
   s.held:=null;
  end if;
  if h.id is not null then update mc_radio.history set ends=boundary where id=h.id; end if;
  delete from mc_radio.votes where round_id=s.round_id;
  if picked.id is null then
   if s.current_id is not null or s.round_id is not null then
    changed:=true;
    update mc_radio.station set current_id=null,round_id=null,candidates='{}',held=null;
   end if;
   exit;
  end if;
  insert into mc_radio.history(item,started,ends) values(to_jsonb(picked),boundary,
   boundary+picked.seconds*interval '1 second') returning id into next_id;
  update mc_radio.station set current_id=next_id,held=s.held,round_id=null,candidates='{}';
  if not s.manual and picked.music is not null and s.held is null then perform mc_radio.open_round(); end if;
  changed:=true;
  select * into s from mc_radio.station;
 end loop;
 if changed then update public.radio_updates set revision=revision+1; end if;
 return true;
end$$;

create function public.radio_state() returns jsonb language plpgsql security definer set search_path='' as $$
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
  'scheduled',coalesce((select jsonb_agg(jsonb_build_object('title',a.title,'timing',q.timing,'due',q.due) order by q.due,q.id)
   from mc_radio.queue q join mc_radio.assets a on a.id=q.asset where due is not null),'[]'))
 into result from mc_radio.station s left join mc_radio.history h on h.id=s.current_id;
 return result;
end$$;

create function public.radio_vote(ballot uuid, choice uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(20945,1);
 if not mc_radio.advance(clock_timestamp()) then raise exception 'Station is catching up';end if;
 if auth.uid() is null or not exists(select from mc_radio.station where round_id=ballot and not manual and choice=any(candidates))
 or not exists(select from mc_radio.assets where id=choice and approved) then raise exception 'Voting round closed or choice unavailable'; end if;
 insert into mc_radio.votes values(ballot,auth.uid(),choice) on conflict(round_id,member) do update set asset=excluded.asset;
 update public.radio_updates set revision=revision+1;
end$$;

create function public.radio_manage(action text, args jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare target uuid:=(args->>'id')::uuid; qid bigint:=(args->>'queue')::bigint; asset mc_radio.assets;
 q mc_radio.queue; other mc_radio.queue; duration double precision:=(args->>'seconds')::double precision;
 t timestamptz; when_due timestamptz; kind text; pos bigint; catalog record;
begin
 if not public.radio_can_edit() then raise exception 'Radio owner required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(20945,1);
 t:=clock_timestamp();
 if not mc_radio.advance(t) then raise exception 'Station is catching up';end if;
 case action
 when 'list' then null;
 when 'approve' then
  select * into strict catalog from public.music_page('recent',0,1,target) where id=target;
  insert into mc_radio.assets(id,music,path,title,artist,profile,art,provider,seconds)
   values(target,target,catalog.audio_path,catalog.title,catalog.artist,catalog.user_id,catalog.art,
    case when catalog.audio_path is null then 'bundled' else 'catalog' end,duration)
   on conflict(id) do update set approved=true,seconds=excluded.seconds,title=excluded.title,artist=excluded.artist;
  update mc_radio.station set candidates=array_append(candidates,target)
   where round_id is not null and cardinality(candidates)<4 and not target=any(candidates);
 when 'revoke' then
  update mc_radio.assets set approved=false where id=target and music is not null;
  delete from mc_radio.queue x where x.asset=target;
  delete from mc_radio.votes x where x.asset=target;
  update mc_radio.station set held=case when held=target then null else held end,candidates=array_remove(candidates,target);
  update mc_radio.station s set candidates=s.candidates || array(select a.id from mc_radio.assets a
    where a.approved and a.music is not null and not a.id=any(s.candidates) order by random() limit 4-cardinality(s.candidates))
    where round_id is not null;
 when 'announce' then
  if not exists(select from storage.objects where bucket_id='radio-announcements' and name=args->>'path'
   and split_part(name,'/',1)=auth.uid()::text)
   or not exists(select from mc_radio.verified where path=args->>'path') then raise exception 'Verify the uploaded recording first'; end if;
  insert into mc_radio.assets(path,title,artist,provider,seconds) values(args->>'path',trim(args->>'title'),'LLiosette','announcement',duration);
 when 'mode' then
  if exists(select from mc_radio.station where manual is distinct from (args->>'manual')::boolean) then
   update mc_radio.station set manual=(args->>'manual')::boolean,round_id=null,candidates='{}',held=null;
   delete from mc_radio.votes;
   if exists(select from mc_radio.station s1 join mc_radio.history h on h.id=s1.current_id
     where not s1.manual and h.item->>'music' is not null) then perform mc_radio.open_round(); end if;
  end if;
 when 'enqueue' then
  select * into strict asset from mc_radio.assets where id=target and approved;
  kind:=args->>'timing';
  when_due:=(args->>'due')::timestamptz;
  if kind in ('exact','after') and (when_due is null or when_due<=t) then raise exception 'Choose a future broadcast time'; end if;
  select coalesce(max(position),0)+1 into pos from mc_radio.queue;
  if kind in ('next','now') then
   select coalesce(min(position),0)-1 into pos from mc_radio.queue;
  end if;
  insert into mc_radio.queue(asset,timing,due,position) values(target,case when kind in ('next','now') then 'queue' else kind end,
   case when kind in ('after','exact') then when_due end,pos) returning id into qid;
  if kind='now' then perform mc_radio.advance(t,true,qid); end if;
 when 'skip' then
  if not exists(select from mc_radio.station where current_id=(args->>'current')::bigint) then raise exception 'Broadcast already changed'; end if;
  perform mc_radio.advance(t,true);
 when 'remove' then delete from mc_radio.queue where id=qid;
 when 'move' then
  select * into strict q from mc_radio.queue where id=qid and due is null;
  select * into strict other from mc_radio.queue where id=(args->>'before')::bigint and due is null;
  update mc_radio.queue set position=position+1 where due is null and position>=other.position;
  update mc_radio.queue set position=other.position where id=q.id;
 else raise exception 'Unknown station action';
 end case;
 if action<>'list' then
  insert into mc_radio.audit(member,changed,action,details) values(auth.uid(),t,action,args);
  perform mc_radio.advance(t);
  update public.radio_updates set revision=revision+1;
 end if;
 return jsonb_build_object('assets',coalesce((select jsonb_agg(to_jsonb(a) order by title) from mc_radio.assets a where approved),'[]'),
  'queue',coalesce((select jsonb_agg(to_jsonb(qr) order by due nulls last,position,id) from
   (select q1.*,a.title from mc_radio.queue q1 join mc_radio.assets a on a.id=q1.asset) qr),'[]'));
end$$;

revoke all on function public.radio_manage(text,jsonb),public.radio_vote(uuid,uuid),public.radio_state(),public.radio_can_edit() from public,anon,authenticated;
grant execute on function public.radio_state(),public.radio_can_edit() to anon,authenticated;
grant execute on function public.radio_vote(uuid,uuid),public.radio_manage(text,jsonb) to authenticated;
revoke all on all functions in schema mc_radio from public,anon,authenticated;

create table mc_radio.verified(path text primary key);
create function public.radio_verify_object(object_path text) returns void language sql security definer set search_path='' as $$
 insert into mc_radio.verified values(object_path) on conflict do nothing
$$;
revoke all on function public.radio_verify_object(text) from public,anon,authenticated;
grant execute on function public.radio_verify_object(text) to service_role;

create function mc_radio.tick() returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(20945,1);
 perform mc_radio.advance(clock_timestamp());
end$$;
revoke all on function mc_radio.tick() from public,anon,authenticated;
do $$begin
 if exists (select from pg_available_extensions where name='pg_cron' and installed_version is null) then
  create extension pg_cron;
 end if;
 if to_regprocedure('cron.schedule(text,text,text)') is not null then
  perform cron.schedule('mc-radio-clock','* * * * *','select mc_radio.tick()');
 end if;
end$$;
