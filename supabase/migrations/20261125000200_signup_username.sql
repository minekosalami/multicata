-- Persist the chosen public handle in the same transaction as the new account.
create function public.mc_signup_username() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
    handle text := btrim(new.raw_user_meta_data->>'username');
begin
    -- Older clients and providers can finish username setup on the Account page.
    if handle is null then return new; end if;
    if handle !~ '^[A-Za-z0-9_]{1,20}$' then
        raise exception 'Invalid username' using errcode = '22023';
    end if;
    insert into public.profiles (user_id, username) values (new.id, handle);
    return new;
end
$$;
revoke all on function public.mc_signup_username() from public, anon, authenticated;
create trigger mc_signup_username after insert on auth.users
for each row execute function public.mc_signup_username();
