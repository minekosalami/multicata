-- Only the service publishing verified renditions can select a smaller media file.
alter table mc_radio.assets add column stream_path text
    check (stream_path is null or (provider='catalog' and stream_path='radio-streams-v1/streams/'||music::text||'.mp3'));

update mc_radio.assets a
set stream_path=o.name
from storage.objects o
where a.provider='catalog' and o.bucket_id='creator-music'
  and o.name='radio-streams-v1/streams/'||a.music::text||'.mp3';

-- A current broadcast can switch sources when a new listener joins, without moving its clock.
update mc_radio.history h set item=h.item||jsonb_build_object('stream_path',a.stream_path)
from mc_radio.station s,mc_radio.assets a
where h.id=s.current_id and a.id=(h.item->>'id')::uuid and a.stream_path is not null;
