create table public.message_blocks (
  blocker uuid not null references auth.users on delete cascade,
  blocked uuid not null references auth.users on delete cascade,
  primary key (blocker, blocked), check (blocker <> blocked)
);
create table public.private_messages (
  id uuid primary key default gen_random_uuid(),
  sender uuid not null references auth.users on delete cascade,
  recipient uuid not null references auth.users on delete cascade,
  body text not null check (length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  is_read boolean not null default false,
  check (sender <> recipient)
);
create index private_messages_sender on public.private_messages(sender, created_at desc);
create index private_messages_recipient on public.private_messages(recipient, created_at desc);
create table public.message_reports (
  message_id uuid primary key references public.private_messages on delete cascade,
  reporter uuid not null references auth.users on delete cascade,
  reason text not null check (length(trim(reason)) between 1 and 500),
  created_at timestamptz not null default now()
);

alter table public.message_blocks enable row level security;
alter table public.private_messages enable row level security;
alter table public.message_reports enable row level security;
revoke all on public.private_messages, public.message_blocks, public.message_reports from public, anon, authenticated;
grant select, insert, delete on public.message_blocks to authenticated;
grant select, insert (sender, recipient, body), update (is_read) on public.private_messages to authenticated;
grant insert (message_id, reporter, reason) on public.message_reports to authenticated;
grant select on public.message_reports to service_role;

create policy "Own blocks" on public.message_blocks for all to authenticated
  using (blocker = (select auth.uid())) with check (blocker = (select auth.uid()));
-- Check both directions without exposing another member's block list.
create function public.can_message(peer uuid) returns boolean language sql stable security definer
set search_path = '' as $$
  select auth.uid() is not null and peer <> auth.uid() and not exists
    (select 1 from public.message_blocks where (blocker,blocked) in ((auth.uid(),peer),(peer,auth.uid())))
$$;
revoke all on function public.can_message(uuid) from public;
grant execute on function public.can_message(uuid) to authenticated;
create policy "Participants read history" on public.private_messages for select to authenticated
  using ((select auth.uid()) in (sender, recipient));
create policy "Send to allowed recipient" on public.private_messages for insert to authenticated
  with check (sender = (select auth.uid()) and public.can_message(recipient));
create policy "Recipient marks read" on public.private_messages for update to authenticated
  using (recipient = (select auth.uid())) with check (recipient = (select auth.uid()) and is_read);
create policy "Recipient reports received message" on public.message_reports for insert to authenticated
  with check (reporter = (select auth.uid()) and exists (select 1 from public.private_messages m
    where m.id = message_id and m.recipient = (select auth.uid())));
create function public.inbox_threads() returns table(peer uuid, latest timestamptz, unread bigint)
language sql stable security invoker set search_path = '' as $$
  select case when sender = auth.uid() then recipient else sender end,
         max(created_at), count(*) filter (where recipient = auth.uid() and not is_read)
  from public.private_messages where auth.uid() in (sender,recipient)
  group by 1 order by 2 desc
$$;
revoke all on function public.inbox_threads() from public;
grant execute on function public.inbox_threads() to authenticated;
