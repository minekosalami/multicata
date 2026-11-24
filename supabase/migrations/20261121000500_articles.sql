-- Editorial administration is bootstrapped by the database owner using a verified auth.users id.
create table public.editorial_admins (member uuid primary key references auth.users on delete cascade);
create table public.writer_applications (
 member uuid primary key default auth.uid() references auth.users on delete cascade,
 statement text not null check(length(trim(statement)) between 1 and 800),
 status text not null default 'pending' check(status in ('pending','approved','rejected','revoked')),
 submitted_at timestamptz not null default now()
);
create table public.articles (
 id uuid primary key default gen_random_uuid(), author uuid not null default auth.uid() references auth.users on delete cascade,
 title text not null check(length(trim(title)) between 1 and 160), body text not null default '' check(length(body)<=50000),
 excerpt text generated always as (left(body,600)) stored,
 published boolean not null default false, published_at timestamptz, revision integer not null default 1,
 check(not published or length(trim(body))>0)
);
create index articles_by_date on public.articles(published_at desc) where published;
create index articles_by_author on public.articles(author);
alter table public.editorial_admins enable row level security;
alter table public.writer_applications enable row level security;
alter table public.articles enable row level security;
revoke all on public.editorial_admins, public.writer_applications, public.articles from public, anon, authenticated;
grant select on public.editorial_admins,public.writer_applications to authenticated;
grant insert(statement), update(status) on public.writer_applications to authenticated;
grant select on public.articles to anon,authenticated;
grant insert(title,body,published),update(title,body,published) on public.articles to authenticated;
create policy own_admin_flag on public.editorial_admins for select to authenticated using(member=auth.uid());
create policy view_application on public.writer_applications for select to authenticated using(member=auth.uid() or exists(select from public.editorial_admins));
create policy apply on public.writer_applications for insert to authenticated with check(member=auth.uid() and status='pending');
create policy review_application on public.writer_applications for update to authenticated using(exists(select from public.editorial_admins))
 with check(exists(select from public.editorial_admins));
create policy read_article on public.articles for select using ((published and public.mc_available(author)) or author=auth.uid());
create policy begin_article on public.articles for insert to authenticated with check(author=auth.uid() and exists(select from public.writer_applications where member=auth.uid() and status='approved'));
create policy edit_article on public.articles for update to authenticated using(author=auth.uid() and exists(select from public.writer_applications where member=auth.uid() and status='approved')) with check(author=auth.uid());
create function public.article_revision() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' then new.revision:=old.revision+1; end if;
 if new.published and new.published_at is null then new.published_at:=now(); end if;
 return new;
end $$;
create trigger article_revision before insert or update on public.articles for each row execute function public.article_revision();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('article-images','article-images',false,5242880,array['image/png','image/jpeg','image/webp']);
-- Key = article UUID / random UUID.ext. Only referenced files on published pages are readable by visitors.
create policy upload_article_image on storage.objects for insert to authenticated with check(
 bucket_id='article-images' and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
 and exists(select from public.articles a where a.id::text=split_part(name,'/',1) and a.author=auth.uid())
 and exists(select from public.writer_applications where member=auth.uid() and status='approved'));
create policy read_article_image on storage.objects for select to anon,authenticated using(
 bucket_id='article-images' and exists(select from public.articles a where a.id::text=split_part(name,'/',1)
 and (a.author=auth.uid() or (a.published and strpos(a.body,'](image:'||name||')')>0))));

alter table public.community_comments add column article_id uuid references public.articles on delete cascade;
alter table public.community_comments drop constraint community_comments_check,
 add constraint one_comment_target check(num_nonnulls(record_id,post_id,profile_user,article_id)=1);
create index comments_article on public.community_comments(article_id,created_at) where article_id is not null;
grant insert(article_id) on public.community_comments to authenticated;
create policy available_article_comment on public.community_comments as restrictive for all using(article_id is null or exists(select from public.articles a where a.id=article_id and a.published))
 with check(article_id is null or exists(select from public.articles a where a.id=article_id and a.published));


create or replace function public.mc_reply_check() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.parent_id is not null and not exists(select from public.community_comments c where c.id=new.parent_id and c.parent_id is null
 and (c.record_id,c.post_id,c.profile_user,c.article_id) is not distinct from (new.record_id,new.post_id,new.profile_user,new.article_id) and public.mc_available(c.author))
 then raise exception 'Reply must belong to an available top-level comment in this discussion.'; end if;
 return new;
end $$;

create or replace function public.mc_notify() returns trigger language plpgsql security definer set search_path='' as $$
declare actor_id uuid; target uuid; replied uuid; cid uuid; pid uuid; msg text;
begin
 if tg_table_name='follows' then
   insert into public.community_notices(recipient,actor,kind) values(new.peer,new.owner,'follow') on conflict do nothing;
   return new;
 elsif tg_table_name='community_comments' then
   actor_id:=new.author; cid:=new.id; msg:=new.body;
   target:=coalesce((select author from public.articles where id=new.article_id),public.mc_target_owner(new.record_id,new.post_id,new.profile_user));
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

create or replace function public.discussion(topic text,target uuid) returns table(id uuid,author uuid,username text,parent_id uuid,body text,created_at timestamptz)
language sql stable security invoker set search_path='' as $$
 select c.id,c.author,p.username,c.parent_id,c.body,c.created_at from public.community_comments c
 left join lateral(select pr.username from public.profiles pr where pr.user_id=c.author order by pr.username nulls last,pr.id limit 1)p on true
 where case topic when 'track' then c.record_id when 'post' then c.post_id when 'guestbook' then c.profile_user when 'article' then c.article_id end=target order by c.created_at,c.id
$$;
-- Keep the header count and notification list aligned when a discussion becomes private.
create policy available_notice_comment on public.community_notices as restrictive for select
 using(comment_id is null or exists(select from public.community_comments c where c.id=comment_id));

create or replace function public.leave_comment(topic text,target uuid,message text,parent uuid default null) returns uuid language plpgsql security invoker set search_path='' as $$
declare result uuid;
begin
 insert into public.community_comments(record_id,post_id,profile_user,article_id,parent_id,body)
 values(case when topic='track' then target end,case when topic='post' then target end,case when topic='guestbook' then target end,case when topic='article' then target end,parent,btrim(message))
 returning id into result; return result;
end $$;

create or replace function public.notice_feed() returns table(id bigint,actor uuid,username text,kind text,seen boolean,topic text,target uuid,entry uuid)
language sql stable security invoker set search_path='' as $$
 select n.id,n.actor,p.username,n.kind,n.seen,
 case when c.article_id is not null then 'article' when c.record_id is not null then 'track' when coalesce(c.post_id,n.post_id) is not null then 'post' else 'guestbook' end,
 coalesce(c.article_id,c.record_id,c.post_id,n.post_id,c.profile_user,n.actor),c.id
 from public.community_notices n left join public.community_comments c on c.id=n.comment_id
 left join lateral(select pr.username from public.profiles pr where pr.user_id=n.actor order by pr.username nulls last,pr.id limit 1)p on true
 where n.comment_id is null or c.id is not null order by n.created_at desc,n.id desc limit 100
$$;
