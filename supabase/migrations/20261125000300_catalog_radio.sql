alter table public.tracks add column duration_seconds double precision
    check (duration_seconds >= 1 and duration_seconds < 'Infinity');
grant insert(duration_seconds) on public.tracks to authenticated;

-- Registration runs after the catalog key exists, in the same publishing transaction.
create function mc_radio.include_track() returns trigger
language plpgsql security definer set search_path='' as $$
begin
    if new.track_id is not null then
        insert into mc_radio.assets(id,music,path,title,artist,profile,art,provider,seconds)
        select new.id,new.id,t.audio_path,t.title,coalesce(p.username,'Member'),
               t.user_id,t.art_path,'catalog',t.duration_seconds
        from public.tracks t
        left join lateral (
            select username from public.profiles where user_id=t.user_id
            order by username nulls last,id limit 1
        ) p on true
        where t.id=new.track_id and t.duration_seconds is not null;
    end if;
    return new;
end
$$;
revoke all on function mc_radio.include_track() from public,anon,authenticated;
create trigger radio_include_track after insert on public.music_keys
for each row execute function mc_radio.include_track();

-- Retain existing moderator exclusions when updating the catalog.
insert into mc_radio.assets(id,music,title,artist,profile,provider,seconds)
select id,id,'GrassCats Pop','LLiosette',archive_owner,'bundled',104.10
from public.music_keys where track_id is null
on conflict(id) do nothing;

-- Durations measured once from the published recordings. No listener-side probing.
update public.tracks t set duration_seconds=m.seconds
from (values
    ('02360375-db0d-4a7d-8f2d-b7ec832aeeee'::uuid,197.837833),
    ('10587b92-2c6a-40e0-b664-d6f8a35769f8'::uuid,63.738776),
    ('15050833-d6df-4ef3-b401-c33141773b05'::uuid,45.635918),
    ('1655acbc-2526-4839-84fe-dae4e3659ffc'::uuid,196.363625),
    ('188cbf26-a2b6-4442-abb9-e884f342c999'::uuid,176),
    ('21b5c8ef-3734-4da5-8027-c4169763191c'::uuid,201),
    ('299386f6-e42c-45ce-9089-75e131f714f3'::uuid,184.918021),
    ('352e920d-61b0-4f04-9984-6ebd85c178f0'::uuid,173.913042),
    ('37bbda98-fea4-4951-a44f-cb30331ed464'::uuid,162.121723),
    ('39028601-dc97-431b-a336-410cc2962eab'::uuid,174.01034),
    ('3ab3c0ac-8c9d-4761-bdc1-8469aedc3e21'::uuid,165.209977),
    ('42a29887-a329-4736-aab9-da16c4635d14'::uuid,103.384604),
    ('48de278f-58c7-4eee-a91b-f625ae508943'::uuid,162.307483),
    ('540bf585-0d55-4b1f-905a-bdbf919e8609'::uuid,183.553741),
    ('620ec6e0-605e-400b-95c6-8c8e1c836d3c'::uuid,32.276054),
    ('62bcd34d-5079-43e3-9cd8-cbc17f615d2d'::uuid,211.843563),
    ('65aff146-205b-4ceb-af9a-0e1900c65282'::uuid,126.486479),
    ('7b3903d3-d416-4d3c-b310-6df7a95a8e3b'::uuid,93.333333),
    ('8a7e7340-1264-46ac-809a-b46b39bde567'::uuid,111.483854),
    ('8f9a76ac-5e87-42a5-a734-780b2d618f60'::uuid,145.371417),
    ('9a9267c3-6535-4420-9398-1ddfcf95df1f'::uuid,224),
    ('a623c4b2-0c2c-4dcd-8ca3-21d2ff66c9e6'::uuid,162.352938),
    ('a8a4d0c9-4733-4ebb-8401-8cfae0f6b6c7'::uuid,160.307302),
    ('acfdf03f-9ad2-43e8-ab10-70c4799b0e95'::uuid,146.610794),
    ('ada05205-c763-482a-87fa-4564c50a58be'::uuid,168.600091),
    ('bc1a5e50-8374-4057-bdad-d88a5bd73d12'::uuid,113.684208),
    ('cbc0706d-6648-43a5-8baf-16cb244cc288'::uuid,84.705875),
    ('cc95ead5-70dd-49ee-818f-0d39e7bde0a8'::uuid,220),
    ('e208a45f-7d32-4148-ac82-629fcf59d014'::uuid,166.788934),
    ('f35dfca7-7dbc-48ba-b1b0-8855601dd762'::uuid,153.019501),
    ('f386d692-3fd7-4713-89e6-97c71edf0955'::uuid,85.714271)
) as m(id,seconds) where t.id=m.id;

update public.tracks t set duration_seconds=a.seconds
from mc_radio.assets a where a.music=t.id and t.duration_seconds is null;

insert into mc_radio.assets(id,music,path,title,artist,profile,art,provider,seconds)
select k.id,k.id,t.audio_path,t.title,coalesce(p.username,'Member'),
       t.user_id,t.art_path,'catalog',t.duration_seconds
from public.music_keys k join public.tracks t on t.id=k.track_id
left join lateral (
    select username from public.profiles where user_id=t.user_id
    order by username nulls last,id limit 1
) p on true
where t.duration_seconds is not null
on conflict(id) do nothing;

alter table public.tracks add constraint tracks_new_upload_duration_required
    check (duration_seconds is not null) not valid;
