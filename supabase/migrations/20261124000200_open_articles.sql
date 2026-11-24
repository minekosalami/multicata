-- Keep historical applications, but retire the application workflow.
revoke all on public.writer_applications from authenticated;
alter policy begin_article on public.articles with check (author = auth.uid());
alter policy edit_article on public.articles using (author = auth.uid()) with check (author = auth.uid());
alter policy upload_article_image on storage.objects with check (
    bucket_id = 'article-images' and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
    and exists (select from public.articles a where a.id::text = split_part(name,'/',1) and a.author = auth.uid())
);

-- Existing articles stay readable. New saves, including drafts, must meet both rules.
alter table public.articles
    add column featured boolean not null default false,
    add constraint article_text_minimum check (length(regexp_replace(body, '^\s+|\s+$', '', 'g')) >= 100) not valid,
    add constraint article_title_required check (title ~ '\S') not valid;

create table public.article_moderators (member uuid primary key references auth.users on delete cascade);
alter table public.article_moderators enable row level security;
revoke all on public.article_moderators from public, anon, authenticated;
grant select on public.article_moderators to authenticated;
create policy own_moderator on public.article_moderators for select to authenticated using (member = auth.uid());

-- Verified Multi-Cata account for @lliosette. A later handle change cannot transfer the role.
insert into public.article_moderators(member)
select id from auth.users where id = 'fd38626e-243b-43f2-aa00-365b23380bb0';

create function public.approve_article(target uuid, expected_revision integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
    if not exists(select from public.article_moderators where member = auth.uid()) then
        raise exception 'Article moderator required' using errcode = '42501';
    end if;
    update public.articles set featured = true
    where id = target and published and revision = expected_revision and public.mc_available(author);
    if not found then raise exception 'Article changed. Refresh before approving.'; end if;
end $$;
revoke all on function public.approve_article(uuid,integer) from public, anon;
grant execute on function public.approve_article(uuid,integer) to authenticated;

create function public.reset_article_feature() returns trigger
language plpgsql set search_path = '' as $$
begin
    if not new.published or (new.title,new.body) is distinct from (old.title,old.body) then
        new.featured := false;
    end if;
    return new;
end $$;
create trigger reset_article_feature before update on public.articles
for each row execute function public.reset_article_feature();
