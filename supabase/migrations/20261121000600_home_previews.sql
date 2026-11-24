-- Bounded homepage reads use the same RLS and block rules as the full sections.
create function public.home_creators()
returns table(user_id uuid, username text, recordings bigint, articles bigint)
language sql stable security invoker set search_path='' as $$
 with work as (
   select t.user_id, count(*) recordings, 0::bigint articles, max(t.created_at) latest
   from public.tracks t group by t.user_id
   union all
   select a.author,0,count(*),max(a.published_at) from public.articles a where a.published group by a.author
 ), creators as (
   select w.user_id,sum(w.recordings)::bigint recordings,sum(w.articles)::bigint articles,max(w.latest) latest
   from work w where public.mc_available(w.user_id) group by w.user_id
 )
 select c.user_id,p.username,c.recordings,c.articles from creators c
 join lateral(select pr.username from public.profiles pr where pr.user_id=c.user_id order by pr.username nulls last,pr.id limit 1)p on true
 order by c.latest desc,c.user_id limit 8
$$;
create function public.home_articles()
returns table(id uuid,title text,author uuid,username text,published_at timestamptz,excerpt text,image_alt text,image_key text)
language sql stable security invoker set search_path='' as $$
 select a.id,a.title,a.author,p.username,a.published_at,a.excerpt,i.m[1],i.m[2]
 from (select * from public.articles where published order by published_at desc,id limit 6) a
 left join lateral(select pr.username from public.profiles pr where pr.user_id=a.author order by pr.username nulls last,pr.id limit 1)p on true
 left join lateral(select regexp_match(a.body,'(?n)^!\[([^]\n]{1,200})\]\(image:('||a.id::text||'/[0-9a-f-]{36}\.(?:png|jpg|webp))\)$') m)i on true
 order by a.published_at desc,a.id
$$;
create function public.home_threads()
returns table(peer uuid,username text,latest timestamptz,unread bigint)
language sql stable security invoker set search_path='' as $$
 select t.peer,p.username,t.latest,t.unread from public.inbox_threads() t
 left join lateral(select pr.username from public.profiles pr where pr.user_id=t.peer order by pr.username nulls last,pr.id limit 1)p on true
 where public.mc_available(t.peer) order by t.latest desc,t.peer limit 7
$$;
create function public.home_posts()
returns table(id uuid,author uuid,username text,created_at timestamptz,excerpt text)
language sql stable security invoker set search_path='' as $$
 select post.id,post.user_id,p.username,post.created_at,left(post.content,220)
 from public.posts post left join lateral(select pr.username from public.profiles pr where pr.user_id=post.user_id order by pr.username nulls last,pr.id limit 1)p on true
 where public.mc_available(post.user_id) order by post.created_at desc,post.id limit 9
$$;
revoke all on function public.home_creators(),public.home_articles(),public.home_threads(),public.home_posts() from public,anon,authenticated;
grant execute on function public.home_creators(),public.home_articles() to anon,authenticated;
grant execute on function public.home_threads(),public.home_posts() to authenticated;
