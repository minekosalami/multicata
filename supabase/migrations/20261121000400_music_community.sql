alter table public.tracks add column art_path text check(art_path is null or split_part(art_path,'/',1)=user_id::text);
grant insert(art_path) on public.tracks to authenticated;
-- One stable key for the bundled recording and each uploaded track.
create table public.music_keys (
 id uuid primary key, track_id uuid unique references public.tracks on delete cascade,
 archive_owner uuid references auth.users on delete set null, check(archive_owner is null or track_id is null),
 check (track_id is not null and id=track_id or track_id is null and id='00000000-0000-4000-8000-000000000041')
);
insert into public.music_keys(id,track_id) values ('00000000-0000-4000-8000-000000000041',null);
insert into public.music_keys(id,track_id) select id,id from public.tracks;
create function public.register_music_key() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.music_keys(id,track_id) values(new.id,new.id); return new; end $$;
create trigger register_music_key after insert on public.tracks for each row execute function public.register_music_key();

create table public.music_votes (
 owner uuid not null default auth.uid() references auth.users on delete cascade,
 record_id uuid references public.music_keys on delete cascade,
 value smallint not null check(value in (-1,1)), primary key(owner,record_id)
);
create index votes_by_record on public.music_votes(record_id,value);
create table public.music_favorites (
 owner uuid not null default auth.uid() references auth.users on delete cascade,
 record_id uuid references public.music_keys on delete cascade,
 saved_at timestamptz not null default now(), primary key(owner,record_id)
);
create table public.follows (
 owner uuid not null default auth.uid() references auth.users on delete cascade,
 peer uuid references auth.users on delete cascade, primary key(owner,peer), check(owner<>peer)
);
create index follows_by_peer on public.follows(peer);
create table public.community_comments (
 id uuid primary key default gen_random_uuid(), author uuid not null default auth.uid() references auth.users on delete cascade,
 record_id uuid references public.music_keys on delete cascade, post_id uuid references public.posts on delete cascade,
 profile_user uuid references auth.users on delete cascade, parent_id uuid references public.community_comments on delete cascade,
 body text not null check(length(btrim(body)) between 1 and 1500), created_at timestamptz not null default now(),
 check(num_nonnulls(record_id,post_id,profile_user)=1)
);
create index comments_record on public.community_comments(record_id,created_at);
create index comments_post on public.community_comments(post_id,created_at);
create index comments_profile on public.community_comments(profile_user,created_at);
create index comments_parent on public.community_comments(parent_id);
create table public.community_notices (
 id bigint generated always as identity primary key, recipient uuid not null references auth.users on delete cascade,
 actor uuid not null references auth.users on delete cascade, kind text not null,
 comment_id uuid references public.community_comments on delete cascade, post_id uuid references public.posts on delete cascade,
 seen boolean not null default false, created_at timestamptz not null default now()
);
create index notices_recipient on public.community_notices(recipient,created_at desc);
create unique index notice_follow_once on public.community_notices(recipient,actor) where kind='follow';
create unique index notice_post_mention_once on public.community_notices(recipient,post_id) where kind='mention' and comment_id is null;

create function public.mc_available(peer uuid) returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select from public.message_blocks b where (b.blocker,b.blocked) in ((auth.uid(),peer),(peer,auth.uid())))
$$;
-- Bound bursts even when an actor removes and immediately recreates a row.
create table public.community_limits(owner uuid references auth.users on delete cascade, action text, minute timestamptz, n int, primary key(owner,action));
create function public.mc_limit() returns trigger language plpgsql security definer set search_path='' as $$
declare t timestamptz:=date_trunc('minute',clock_timestamp()); total int;
begin
 insert into public.community_limits as l values(auth.uid(),tg_table_name,t,1)
 on conflict(owner,action) do update set minute=t,n=case when l.minute=t then l.n+1 else 1 end returning n into total;
 if total>tg_argv[0]::int then raise exception 'Please wait a minute before trying again.'; end if;
 return new;
end $$;
create trigger comment_limit before insert on public.community_comments for each row execute function public.mc_limit('12');
create trigger follow_limit before insert on public.follows for each row execute function public.mc_limit('30');
create trigger vote_limit before insert on public.music_votes for each row execute function public.mc_limit('90');

alter table public.music_keys enable row level security;
alter table public.music_votes enable row level security;
alter table public.music_favorites enable row level security;
alter table public.follows enable row level security;
alter table public.community_comments enable row level security;
alter table public.community_notices enable row level security;
alter table public.community_limits enable row level security;
revoke all on public.music_keys,public.music_votes,public.music_favorites,public.follows,public.community_comments,public.community_notices,public.community_limits from public,anon,authenticated;
grant select on public.music_keys,public.community_comments,public.follows to anon,authenticated;
grant select,delete on public.music_votes,public.music_favorites,public.community_comments,public.follows to authenticated;
grant insert(record_id,value),update(value) on public.music_votes to authenticated;
grant insert(record_id) on public.music_favorites to authenticated;
grant insert(peer) on public.follows to authenticated;
grant insert(record_id,post_id,profile_user,parent_id,body) on public.community_comments to authenticated;
grant select,update(seen) on public.community_notices to authenticated;
create policy catalog_keys on public.music_keys for select using(true);
create policy own_votes on public.music_votes for all to authenticated using(owner=auth.uid())
 with check(owner=auth.uid() and not exists(select from public.music_keys k left join public.tracks t on t.id=k.track_id where k.id=record_id and not public.mc_available(coalesce(t.user_id,k.archive_owner))));
create policy own_favorites on public.music_favorites for all to authenticated using(owner=auth.uid())
 with check(owner=auth.uid() and not exists(select from public.music_keys k left join public.tracks t on t.id=k.track_id where k.id=record_id and not public.mc_available(coalesce(t.user_id,k.archive_owner))));
create policy visible_follows on public.follows for select using(public.mc_available(owner) and public.mc_available(peer));
create policy start_follow on public.follows for insert to authenticated with check(owner=auth.uid() and public.mc_available(peer));
create policy stop_follow on public.follows for delete to authenticated using(owner=auth.uid());

create function public.mc_target_owner(rec uuid,post uuid,profile uuid) returns uuid language sql stable security definer set search_path='' as $$
 select coalesce(profile,(select coalesce(t.user_id,k.archive_owner) from public.music_keys k left join public.tracks t on t.id=k.track_id where k.id=rec),(select p.user_id from public.posts p where p.id=post and auth.uid() is not null))
$$;
create policy read_comments on public.community_comments for select using
 ((post_id is null or auth.uid() is not null) and public.mc_available(author) and public.mc_available(public.mc_target_owner(record_id,post_id,profile_user)));
create policy write_comments on public.community_comments for insert to authenticated with check
 (author=auth.uid() and public.mc_available(public.mc_target_owner(record_id,post_id,profile_user)));
create policy moderate_comments on public.community_comments for delete to authenticated using(author=auth.uid() or profile_user=auth.uid());
create function public.mc_reply_check() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.parent_id is not null and not exists(select from public.community_comments c where c.id=new.parent_id and c.parent_id is null
 and (c.record_id,c.post_id,c.profile_user) is not distinct from (new.record_id,new.post_id,new.profile_user) and public.mc_available(c.author))
 then raise exception 'Reply must belong to an available top-level comment in this discussion.'; end if;
 return new;
end $$;
create trigger reply_check before insert on public.community_comments for each row execute function public.mc_reply_check();

create policy read_notice on public.community_notices for select to authenticated using(recipient=auth.uid() and public.mc_available(actor));
create policy see_notice on public.community_notices for update to authenticated using(recipient=auth.uid() and public.mc_available(actor)) with check(recipient=auth.uid() and seen);
create function public.mc_notify() returns trigger language plpgsql security definer set search_path='' as $$
declare actor_id uuid; target uuid; replied uuid; cid uuid; pid uuid; msg text;
begin
 if tg_table_name='follows' then
   insert into public.community_notices(recipient,actor,kind) values(new.peer,new.owner,'follow') on conflict do nothing;
   return new;
 elsif tg_table_name='community_comments' then
   actor_id:=new.author; cid:=new.id; msg:=new.body;
   target:=public.mc_target_owner(new.record_id,new.post_id,new.profile_user);
   select author into replied from public.community_comments where id=new.parent_id;
   insert into public.community_notices(recipient,actor,kind,comment_id)
   select dest,actor_id,case when dest=replied then 'reply' else 'comment' end,cid
   from (select distinct unnest(array[target,replied]) dest) d
   where dest<>actor_id and public.mc_available(dest);
 else
   actor_id:=new.user_id; pid:=new.id; msg:=new.content;
 end if;
 insert into public.community_notices(recipient,actor,kind,comment_id,post_id)
 select distinct p.user_id,actor_id,'mention',cid,pid from regexp_matches(msg,'(?:^|[^[:alnum:]_@])@([A-Za-z0-9_]{1,20})(?![A-Za-z0-9_])','g') m
 join public.profiles p on p.username=m[1] where p.user_id<>actor_id and p.user_id is distinct from target and p.user_id is distinct from replied
 and public.mc_available(p.user_id) on conflict do nothing;
 return new;
end $$;
create trigger notify_follow after insert on public.follows for each row execute function public.mc_notify();
create trigger notify_comment after insert on public.community_comments for each row execute function public.mc_notify();
create trigger notify_post after insert or update of content on public.posts for each row execute function public.mc_notify();

-- Aggregate public counts here; individual ballots and collections remain private.
create function public.music_page(mode text default 'recent', start_at int default 0, take int default 12, wanted uuid default null)
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
 order by case when mode='liked' then v.likes end desc,case when mode='favorites' then f.saved_at end desc,t.created_at desc nulls last,k.id
 limit least(greatest(take,1),100) offset greatest(start_at,0)
$$;
-- The client supplies the desired final state, never a counter increment.
create function public.music_reaction(rec uuid, choice text) returns void language plpgsql security invoker set search_path='' as $$
begin
 case choice
 when 'like','dislike' then
   insert into public.music_votes(record_id,value) values(rec,case choice when 'like' then 1 else -1 end)
   on conflict(owner,record_id) do update set value=excluded.value;
 when 'unvote' then delete from public.music_votes where owner=auth.uid() and record_id=rec;
 when 'save' then insert into public.music_favorites(record_id) values(rec) on conflict do nothing;
 when 'unsave' then delete from public.music_favorites where owner=auth.uid() and record_id=rec;
 else raise exception 'Unknown reaction'; end case;
end $$;
create function public.change_follow(person uuid, desired boolean) returns void language plpgsql security invoker set search_path='' as $$
begin
 if desired then insert into public.follows(peer) values(person) on conflict do nothing;
 else delete from public.follows where owner=auth.uid() and peer=person; end if;
end $$;
create function public.community_people(person uuid, direction text) returns table(user_id uuid,username text)
language sql stable security invoker set search_path='' as $$
 select distinct q.member,p.username from (
 select case direction when 'followers' then f.owner else f.peer end member from public.follows f
 where (direction='followers' and f.peer=person) or (direction='following' and f.owner=person)) q
 left join lateral(select pr.username from public.profiles pr where pr.user_id=q.member order by pr.username nulls last,pr.id limit 1)p on true
 order by p.username nulls last,q.member
$$;
create function public.discussion(topic text,target uuid) returns table(id uuid,author uuid,username text,parent_id uuid,body text,created_at timestamptz)
language sql stable security invoker set search_path='' as $$
 select c.id,c.author,p.username,c.parent_id,c.body,c.created_at from public.community_comments c
 left join lateral(select pr.username from public.profiles pr where pr.user_id=c.author order by pr.username nulls last,pr.id limit 1)p on true
 where case topic when 'track' then c.record_id when 'post' then c.post_id when 'guestbook' then c.profile_user end=target order by c.created_at,c.id
$$;
create function public.leave_comment(topic text,target uuid,message text,parent uuid default null) returns uuid language plpgsql security invoker set search_path='' as $$
declare result uuid;
begin
 insert into public.community_comments(record_id,post_id,profile_user,parent_id,body)
 values(case when topic='track' then target end,case when topic='post' then target end,case when topic='guestbook' then target end,parent,btrim(message))
 returning id into result; return result;
end $$;
create function public.remove_comment(entry uuid) returns void language sql security invoker set search_path='' as $$
 delete from public.community_comments where id=entry
$$;
create function public.notice_feed() returns table(id bigint,actor uuid,username text,kind text,seen boolean,topic text,target uuid,entry uuid)
language sql stable security invoker set search_path='' as $$
 select n.id,n.actor,p.username,n.kind,n.seen,
 case when c.record_id is not null then 'track' when coalesce(c.post_id,n.post_id) is not null then 'post' else 'guestbook' end,
 coalesce(c.record_id,c.post_id,n.post_id,c.profile_user,n.actor),c.id
 from public.community_notices n left join public.community_comments c on c.id=n.comment_id
 left join lateral(select pr.username from public.profiles pr where pr.user_id=n.actor order by pr.username nulls last,pr.id limit 1)p on true
 where n.comment_id is null or c.id is not null order by n.created_at desc,n.id desc limit 100
$$;
create function public.mark_notices(items bigint[]) returns void language sql security invoker set search_path='' as $$
 update public.community_notices set seen=true where recipient=auth.uid() and id=any(items)
$$;
revoke all on function public.mc_target_owner(uuid,uuid,uuid) from public;
grant execute on function public.mc_target_owner(uuid,uuid,uuid) to anon,authenticated;
-- Anonymous public guestbooks need a target-block check but no private post lookup.
revoke all on function public.music_reaction(uuid,text),public.change_follow(uuid,boolean),public.leave_comment(text,uuid,text,uuid),
 public.remove_comment(uuid),public.mark_notices(bigint[]),public.notice_feed() from public,anon;
grant execute on function public.music_reaction(uuid,text),public.change_follow(uuid,boolean),public.leave_comment(text,uuid,text,uuid),
 public.remove_comment(uuid),public.mark_notices(bigint[]),public.notice_feed() to authenticated;


create function public.followed_posts() returns setof public.posts language sql stable security invoker set search_path='' as $$
 select p.* from public.posts p join public.follows f on f.peer=p.user_id and f.owner=auth.uid()
 order by p.created_at desc,p.id
$$;
revoke all on function public.followed_posts() from public,anon;
grant execute on function public.followed_posts() to authenticated;
create policy protect_release_art on storage.objects as restrictive for delete to authenticated
 using(bucket_id<>'community-images' or not exists(select 1 from public.tracks t where t.art_path=name));
create function public.mc_end_follow() returns trigger language plpgsql security definer set search_path='' as $$
begin
 delete from public.follows where (owner,peer) in ((new.blocker,new.blocked),(new.blocked,new.blocker));
 return new;
end $$;
create trigger detach_blocked_follow after insert on public.message_blocks for each row execute function public.mc_end_follow();

grant execute on function public.music_page(text,int,int,uuid),public.discussion(text,uuid),
 public.community_people(uuid,text),public.mc_available(uuid) to anon,authenticated;
revoke all on function public.register_music_key(),public.mc_limit(),public.mc_reply_check(),
 public.mc_notify(),public.mc_end_follow() from public,anon,authenticated;

-- A claim serializes first registration without merging any existing profile rows.
create table public.profile_registrations(owner uuid primary key references auth.users(id) on delete cascade);
alter table public.profile_registrations enable row level security;
revoke all on public.profile_registrations from public,anon,authenticated;
lock table public.profiles in share row exclusive mode;
insert into public.profile_registrations select distinct user_id from public.profiles where user_id is not null;
create function public.mc_register_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
   insert into public.profile_registrations(owner) values(new.user_id);
 elsif tg_op='UPDATE' and new.user_id is distinct from old.user_id then
   raise exception 'A profile owner cannot change';
 elsif tg_op='DELETE' and not exists(select from public.profiles where user_id=old.user_id) then
   delete from public.profile_registrations where owner=old.user_id;
 end if;
 return null;
end $$;
create trigger register_profile after insert or update of user_id or delete on public.profiles
 for each row execute function public.mc_register_profile();
revoke all on function public.mc_register_profile() from public,anon,authenticated;
