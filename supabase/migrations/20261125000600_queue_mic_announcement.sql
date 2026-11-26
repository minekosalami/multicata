-- A verified upload is the idempotency key for publishing one announcement.
create function public.radio_announce_next(object_path text, announcement_title text, seconds double precision)
returns uuid language plpgsql security definer set search_path='' as $$
declare
    recording uuid;
begin
    if not public.radio_can_edit() then
        raise exception 'Radio owner required' using errcode='42501';
    end if;
    perform pg_advisory_xact_lock(20945,1);
    select id into recording from mc_radio.assets where path=object_path and provider='announcement';
    if recording is not null then return recording; end if;

    -- Keep verification, registration and queuing in one transaction.
    perform public.radio_manage('announce',jsonb_build_object(
        'path',object_path,'title',announcement_title,'seconds',seconds));
    select id into strict recording from mc_radio.assets where path=object_path and provider='announcement';
    perform public.radio_manage('enqueue',jsonb_build_object('id',recording,'timing','next'));
    return recording;
end
$$;
revoke all on function public.radio_announce_next(text,text,double precision) from public,anon,authenticated;
grant execute on function public.radio_announce_next(text,text,double precision) to authenticated;
