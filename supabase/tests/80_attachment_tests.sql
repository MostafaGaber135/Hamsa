\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); end $$;
create or replace function pg_temp.try_attachment(label text, k text, a jsonb) returns void language plpgsql as $$
begin
  insert into public.messages (conversation_id, kind, attachment)
  values ((select id from public.conversations where not is_group limit 1), k, a);
  raise notice 'FAIL: % accepted', label;
exception when check_violation then raise notice 'OK: % rejected', label;
end $$;
set role authenticated;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
-- What the app sends is still accepted.
insert into messages (conversation_id, kind, attachment) select id, 'location', '{"lat":-33.86,"lng":151.2}' from conversations where not is_group limit 1;
insert into messages (conversation_id, kind, attachment) select id, 'voice', '{"path":"x/v.webm","mime":"audio/webm","duration_ms":8400,"waveform":[8,40,100]}' from conversations where not is_group limit 1;
insert into messages (conversation_id, kind, attachment) select id, 'file', '{"path":"x/cv.pdf","name":"cv.pdf","size":48213,"mime":"application/pdf"}' from conversations where not is_group limit 1;
select 'valid attachments saved: ok';
-- Crafted attachments are refused.
select pg_temp.try_attachment('text latitude', 'location', '{"lat":"x","lng":31}');
select pg_temp.try_attachment('latitude out of range', 'location', '{"lat":91,"lng":31}');
select pg_temp.try_attachment('location without coordinates', 'location', '{"lat":30}');
select pg_temp.try_attachment('location with no attachment', 'location', null);
select pg_temp.try_attachment('numeric file name', 'file', '{"path":"x/a","name":42}');
select pg_temp.try_attachment('text size', 'file', '{"path":"x/a","size":"big"}');
select pg_temp.try_attachment('array attachment', 'file', '[1,2]');
select pg_temp.try_attachment('text waveform bar', 'voice', '{"path":"x/v","waveform":[1,"a"]}');
select pg_temp.try_attachment('waveform too long', 'voice', jsonb_build_object('path', 'x/v', 'waveform', (select jsonb_agg(i) from generate_series(1, 65) i)));
select pg_temp.try_attachment('huge attachment', 'file', jsonb_build_object('path', 'x/a', 'junk', (select string_agg(md5(i::text), '') from generate_series(1, 400) i)));
