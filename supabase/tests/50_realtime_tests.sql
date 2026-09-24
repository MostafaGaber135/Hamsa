\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); end $$;
reset role;
update profiles set last_seen_at = '2000-01-01' where id in ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');
set role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select touch_last_seen();
reset role;
select 'alice touched: ' || (last_seen_at > now() - interval '1 minute') from profiles where id = '11111111-1111-1111-1111-111111111111';
select 'bob untouched: ' || (last_seen_at < '2001-01-01') from profiles where id = '22222222-2222-2222-2222-222222222222';
set role anon;
do $$ begin perform public.touch_last_seen(); raise notice 'FAIL anon'; exception when insufficient_privilege then raise notice 'OK: anon blocked'; end $$;
-- Realtime channel policies
reset role;
select c.id as direct from conversations c where not c.is_group limit 1 \gset
set role authenticated;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');  -- bob, a member of the direct chat
select set_config('realtime.topic', 'typing:' || :'direct', false);
insert into realtime.messages (topic, extension) values (current_setting('realtime.topic'), 'broadcast');
select 'bob can type in his chat: ok';
select pg_temp.as_user('44444444-4444-4444-4444-444444444444');  -- gina, not a member
do $$ begin insert into realtime.messages (topic, extension) values (current_setting('realtime.topic'), 'broadcast'); raise notice 'FAIL gina typed';
exception when insufficient_privilege then raise notice 'OK: outsider cannot send typing events'; end $$;
select 'gina sees typing rows: ' || count(*) from realtime.messages;
select set_config('realtime.topic', 'online-users', false);
insert into realtime.messages (topic, extension) values ('online-users', 'presence');
select 'gina can appear online: ok';
do $$ begin insert into realtime.messages (topic, extension) values ('online-users', 'broadcast'); raise notice 'FAIL broadcast on presence topic';
exception when insufficient_privilege then raise notice 'OK: online channel is presence only'; end $$;
select set_config('realtime.topic', 'typing:not-a-uuid', false);
do $$ begin insert into realtime.messages (topic, extension) values ('typing:not-a-uuid', 'broadcast'); raise notice 'FAIL bad topic';
exception when insufficient_privilege then raise notice 'OK: malformed topic rejected'; end $$;
reset role; set role anon;
select set_config('realtime.topic', 'online-users', false);
do $$ begin insert into realtime.messages (topic, extension) values ('online-users', 'presence'); raise notice 'FAIL anon online';
exception when insufficient_privilege then raise notice 'OK: signed-out visitors cannot join'; end $$;
