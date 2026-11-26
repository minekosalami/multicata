-- The Data API enforces safe updates. Target the singleton station, revision row,
-- or active voting round explicitly during listener and owner requests.

create or replace function mc_radio.open_round() returns void language sql set search_path='' as $$
 update mc_radio.station s set round_id=gen_random_uuid(),
 candidates=array(select a.id from mc_radio.assets a where approved and music is not null
 order by (a.id::text=coalesce((select item->>'id' from mc_radio.history where id=s.current_id),'')),
 exists(select from (select item->>'id' as played from mc_radio.history order by id desc limit 3) r where r.played=a.id::text),
 random() limit 4)
 where s.singleton
$$;

create or replace function mc_radio.advance(horizon timestamptz, skip_current boolean default false, forced_queue bigint default null) returns boolean
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
  if steps=256 then update public.radio_updates set revision=revision+1 where id;return false;end if;
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
    update mc_radio.station set current_id=null,round_id=null,candidates='{}',held=null where singleton;
   end if;
   exit;
  end if;
  insert into mc_radio.history(item,started,ends) values(to_jsonb(picked),boundary,
   boundary+picked.seconds*interval '1 second') returning id into next_id;
  update mc_radio.station set current_id=next_id,held=s.held,round_id=null,candidates='{}' where singleton;
  if not s.manual and picked.music is not null and s.held is null then perform mc_radio.open_round(); end if;
  changed:=true;
  select * into s from mc_radio.station;
 end loop;
 if changed then update public.radio_updates set revision=revision+1 where id; end if;
 return true;
end$$;

create or replace function public.radio_vote(ballot uuid, choice uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(20945,1);
 if not mc_radio.advance(clock_timestamp()) then raise exception 'Station is catching up';end if;
 if auth.uid() is null or not exists(select from mc_radio.station where round_id=ballot and not manual and choice=any(candidates))
 or not exists(select from mc_radio.assets where id=choice and approved) then raise exception 'Voting round closed or choice unavailable'; end if;
 insert into mc_radio.votes values(ballot,auth.uid(),choice) on conflict(round_id,member) do update set asset=excluded.asset;
 update public.radio_updates set revision=revision+1 where id;
end$$;

create or replace function public.radio_manage(action text, args jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
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
  update mc_radio.station set held=case when held=target then null else held end,candidates=array_remove(candidates,target) where singleton;
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
   delete from mc_radio.votes where round_id=(select round_id from mc_radio.station where singleton);
   update mc_radio.station set manual=(args->>'manual')::boolean,round_id=null,candidates='{}',held=null where singleton;

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
  update public.radio_updates set revision=revision+1 where id;
 end if;
 return jsonb_build_object('assets',coalesce((select jsonb_agg(to_jsonb(a) order by title) from mc_radio.assets a where approved),'[]'),
  'queue',coalesce((select jsonb_agg(to_jsonb(qr) order by due nulls last,position,id) from
   (select q1.*,a.title from mc_radio.queue q1 join mc_radio.assets a on a.id=q1.asset) qr),'[]'));
end$$;
