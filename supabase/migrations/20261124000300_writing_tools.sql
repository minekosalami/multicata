-- Individual votes are private. Only totals are shared with readers of the target.
create table public.writing_votes (
    voter uuid not null default auth.uid() references auth.users on delete cascade,
    article uuid references public.articles on delete cascade,
    entry uuid references public.community_comments on delete cascade,
    value smallint not null check(value in (-1,1)),
    check(num_nonnulls(article,entry)=1), unique(voter,article), unique(voter,entry)
);
create index writing_votes_articles on public.writing_votes(article);
create index writing_votes_entries on public.writing_votes(entry);
alter table public.writing_votes enable row level security;
revoke all on public.writing_votes from public,anon,authenticated;
grant select,delete,insert(article,entry,value),update(value) on public.writing_votes to authenticated;
create view public.writing_totals as
 select article,entry,count(*) filter(where value=1) as likes,count(*) filter(where value=-1) as dislikes
 from public.writing_votes group by article,entry;
revoke all on public.writing_totals from public,anon,authenticated;
create schema if not exists mc_internal;
revoke all on schema mc_internal from public,anon,authenticated;
alter view public.writing_totals set schema mc_internal;
grant usage on schema mc_internal to anon,authenticated;
grant select on mc_internal.writing_totals to anon,authenticated;
create function public.writing_vote_counts(kind text,targets uuid[]) returns table(target uuid,likes bigint,dislikes bigint)
language sql stable security invoker set search_path='' as $$
 select a.id,v.likes,v.dislikes from public.articles a join mc_internal.writing_totals v on v.article=a.id
 where kind='article' and a.id=any(targets) and a.published
 union all select c.id,v.likes,v.dislikes from public.community_comments c join mc_internal.writing_totals v on v.entry=c.id
 where kind='comment' and c.id=any(targets)
$$;
create function public.my_writing_votes(kind text,targets uuid[]) returns table(target uuid,value smallint)
language sql stable security invoker set search_path='' as $$
 select coalesce(v.article,v.entry),v.value from public.writing_votes v where v.voter=auth.uid()
 and ((kind='article' and v.article=any(targets)) or (kind='comment' and v.entry=any(targets)))
$$;
create policy write_vote on public.writing_votes for all to authenticated using(voter=auth.uid())
 with check(voter=auth.uid() and (exists(select from public.articles a where a.id=article and a.published)
 or exists(select from public.community_comments c where c.id=entry)));
create function public.set_writing_vote(kind text,target uuid,choice integer) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if kind not in ('article','comment') or choice not in (-1,0,1) then raise exception 'Invalid vote'; end if;
 if choice=0 then delete from public.writing_votes v where voter=auth.uid() and (kind='article' and article=target or kind='comment' and entry=target);
 elsif kind='article' then insert into public.writing_votes(article,value) values(target,choice) on conflict(voter,article) do update set value=excluded.value;
 else insert into public.writing_votes(entry,value) values(target,choice) on conflict(voter,entry) do update set value=excluded.value; end if;
end $$;
revoke all on function public.set_writing_vote(text,uuid,integer) from public,anon;
grant execute on function public.set_writing_vote(text,uuid,integer) to authenticated;

alter table public.articles add column updated_at timestamptz not null default now(),
 add column topic text not null default '' check(length(topic)<=80),
 add column series text not null default '' check(length(series)<=120),
 add column summary text not null default '' check(length(summary)<=300),
 add column feature_note text not null default '' check(length(feature_note)<=300);
grant insert(topic,series,summary),update(topic,series,summary) on public.articles to authenticated;
create table public.article_versions (
 id bigint generated always as identity primary key, article uuid not null references public.articles on delete cascade,
 revision integer not null,title text not null,body text not null, saved_at timestamptz not null, topic text,series text,summary text
);
alter table public.article_versions enable row level security;
revoke all on public.article_versions from public,anon,authenticated;
grant select on public.article_versions to authenticated;
create policy author_versions on public.article_versions for select using(exists(select from public.articles a where a.id=article and a.author=auth.uid()));
create or replace function public.reset_article_feature() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (new.title,new.body,new.topic,new.series,new.summary) is distinct from (old.title,old.body,old.topic,old.series,old.summary) then
   insert into public.article_versions(article,revision,title,body,saved_at,topic,series,summary)
   values(old.id,old.revision,old.title,old.body,old.updated_at,old.topic,old.series,old.summary);
   new.updated_at:=now();new.featured:=false;
 end if;
 if not new.published then new.featured:=false;end if;
 if not new.featured then new.feature_note:='';end if;
 return new;
end $$;
create function public.set_article_feature(target uuid,expected_revision integer,enabled boolean,note text default '') returns void
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select from public.article_moderators where member=auth.uid()) then raise exception 'Moderator required';end if;
 update public.articles set featured=enabled,feature_note=trim(note) where id=target and revision=expected_revision and published and public.mc_available(author);
 if not found then raise exception 'Reload the article';end if;
end $$;

create function public.browse_articles(search_text text default '',selected_topic text default '', selected_series text default '',
 writer uuid default null,following_only boolean default false, featured_only boolean default false,
 most_liked boolean default false, start_at integer default 0)
returns table(id uuid,title text,author uuid,published_at timestamptz,excerpt text,featured boolean,revision integer,topic text,series text)
language sql stable security invoker set search_path='' as $$
 select a.id,a.title,a.author,a.published_at,coalesce(nullif(a.summary,''),a.excerpt),a.featured,a.revision,a.topic,a.series
 from public.articles a where a.published and (not featured_only or a.featured)
 and (writer is null or a.author=writer) and (selected_topic='' or lower(a.topic)=lower(selected_topic))
 and (selected_series='' or lower(a.series)=lower(selected_series))
 and (not following_only or exists(select from public.follows f where f.owner=auth.uid() and f.peer=a.author))
 and (search_text='' or strpos(lower(a.title||' '||a.body),lower(search_text))>0 or exists(select from public.profiles p where p.user_id=a.author and strpos(lower(p.username),lower(ltrim(search_text,'@')))>0))
 order by case when most_liked then coalesce((select likes from mc_internal.writing_totals v where v.article=a.id),0) end desc,
 a.published_at desc,a.id limit 13 offset greatest(start_at,0)
$$;
create table public.article_shares(article uuid primary key references public.articles on delete cascade, token uuid not null unique default gen_random_uuid());
alter table public.article_shares enable row level security;
revoke all on public.article_shares from public,anon,authenticated;
grant select,delete,insert(article) on public.article_shares to authenticated;
create policy author_share on public.article_shares for all to authenticated using(exists(select from public.articles a where a.id=article and a.author=auth.uid()))
 with check(exists(select from public.articles a where a.id=article and a.author=auth.uid()));
create function public.preview_article(access_key uuid) returns table(id uuid,title text,body text)
language sql stable security definer set search_path='' as $$
 select a.id,a.title,a.body from public.article_shares s join public.articles a on a.id=s.article where s.token=access_key and public.mc_available(a.author)
$$;
alter table public.community_comments add column edited_at timestamptz;
grant update(body) on public.community_comments to authenticated;
create policy edit_own_comment on public.community_comments for update to authenticated using(author=auth.uid()) with check(author=auth.uid());
create function public.stamp_comment_edit() returns trigger language plpgsql set search_path='' as $$
begin new.edited_at:=now();return new;end $$;
create trigger comment_edit before update of body on public.community_comments for each row execute function public.stamp_comment_edit();
create table public.writing_reports (
 reporter uuid not null default auth.uid() references auth.users on delete cascade,
 article uuid references public.articles on delete cascade,entry uuid references public.community_comments on delete cascade,
 reason text not null check(length(trim(reason)) between 1 and 500), check(num_nonnulls(article,entry)=1),
 unique(reporter,article),unique(reporter,entry)
);
alter table public.writing_reports enable row level security;
revoke all on public.writing_reports from public,anon,authenticated;
grant insert(article,entry,reason),select on public.writing_reports to authenticated;
create policy submit_writing_report on public.writing_reports for insert with check(reporter=auth.uid() and
 (exists(select from public.articles a where a.id=article and a.published) or exists(select from public.community_comments c where c.id=entry)));
create policy moderate_reports on public.writing_reports for select using(exists(select from public.article_moderators));
create table public.feature_history(article uuid references public.articles on delete cascade,featured_at timestamptz not null default now(), note text);
alter table public.feature_history enable row level security;
revoke all on public.feature_history from public,anon,authenticated;
grant select on public.feature_history to anon,authenticated;
create policy published_history on public.feature_history for select using(exists(select from public.articles a where a.id=article and a.published));
create function public.log_feature() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.feature_history values(new.id,now(),new.feature_note);return new;end $$;
create trigger log_feature after update on public.articles for each row when(new.featured and not old.featured) execute function public.log_feature();
create function public.thread_entries(topic text,target uuid) returns table(id uuid,author uuid,username text,parent_id uuid,body text,created_at timestamptz,edited_at timestamptz)
language sql stable security invoker set search_path='' as $$
 select d.*,c.edited_at from public.discussion(topic,target) d join public.community_comments c on c.id=d.id order by d.created_at,d.id
$$;
create table public.muted_discussions(member uuid default auth.uid() references auth.users on delete cascade,topic text,target uuid,primary key(member,topic,target));
alter table public.muted_discussions enable row level security;
revoke all on public.muted_discussions from public,anon,authenticated;
grant select,delete,insert(topic,target) on public.muted_discussions to authenticated;
create policy manage_muted on public.muted_discussions for all to authenticated using(member=auth.uid()) with check(member=auth.uid());
create policy unmuted_notices on public.community_notices as restrictive for select to authenticated using(not exists(
 select from public.community_comments c join public.muted_discussions m on m.target=coalesce(c.article_id,c.record_id,c.post_id,c.profile_user)
 and m.topic=case when c.article_id is not null then 'article' when c.record_id is not null then 'track' when c.post_id is not null then 'post' else 'guestbook' end
 where c.id=comment_id and m.member=auth.uid()));
-- A release belongs to its uploader; same-name releases by other artists stay separate.
create function public.release_liner_notes(recording uuid, start_at integer default 0)
returns table(id uuid,title text,author uuid,published_at timestamptz,excerpt text,featured boolean,revision integer,topic text,series text)
language sql stable security invoker set search_path='' as $$
 select a.id,a.title,a.author,a.published_at,coalesce(nullif(a.summary,''),a.excerpt),a.featured,a.revision,a.topic,a.series
 from public.articles a where a.published and exists(
 select from public.tracks t join public.tracks source on source.id=recording
 where t.user_id=source.user_id and t.release_name=source.release_name and coalesce(source.release_name,'')<>''
 and strpos(a.body,'[track:'||t.id::text||']')>0)
 order by a.published_at desc,a.id limit 13 offset greatest(start_at,0)
$$;
