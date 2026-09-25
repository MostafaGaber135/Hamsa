\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); end $$;
create or replace function pg_temp.refused(label text, stmt text) returns void language plpgsql as $$
begin
  execute stmt;
  raise notice 'FAIL: % allowed', label;
exception when insufficient_privilege then raise notice 'OK: % refused', label;
end $$;
-- Hana: a brand-new user nobody is friends with.
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('55555555-5555-5555-5555-555555555555', 'hana@x.com', '{"full_name":"Hana Ali"}');
select id as direct from conversations where direct_key = '11111111-1111-1111-1111-111111111111:22222222-2222-2222-2222-222222222222' \gset
set role authenticated;

-- ---- Last seen and online status ----
select pg_temp.as_user('44444444-4444-4444-4444-444444444444');
select pg_temp.refused('reading anyone''s last_seen_at directly', $$select last_seen_at from public.profiles limit 1$$);
select 'gina sees a stranger''s last seen: ' || coalesce(visible_last_seen('11111111-1111-1111-1111-111111111111')::text, 'hidden');
select 'gina sees her own last seen: ' || (visible_last_seen('44444444-4444-4444-4444-444444444444') is not null);
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select 'alice sees bob''s last seen: ' || (m->>'last_seen_at' is not null)
  from get_my_conversations(), jsonb_array_elements(members) m where id = :'direct' and m->>'id' = '22222222-2222-2222-2222-222222222222';
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
update profiles set presence_visibility = 'nobody' where id = '22222222-2222-2222-2222-222222222222';
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select 'after bob hides it: ' || coalesce(m->>'last_seen_at', 'hidden')
  from get_my_conversations(), jsonb_array_elements(members) m where id = :'direct' and m->>'id' = '22222222-2222-2222-2222-222222222222';
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
update profiles set presence_visibility = 'contacts' where id = '22222222-2222-2222-2222-222222222222';
select block_user('11111111-1111-1111-1111-111111111111');
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select set_config('realtime.topic', 'typing:' || :'direct', false);
select pg_temp.refused('alice seeing typing/online in a chat with bob who blocked her',
  $$insert into realtime.messages (topic, extension) values (current_setting('realtime.topic'), 'presence')$$);
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select unblock_user('11111111-1111-1111-1111-111111111111');

-- ---- Message requests ----
select pg_temp.as_user('55555555-5555-5555-5555-555555555555');
select get_or_create_direct_conversation('44444444-4444-4444-4444-444444444444') as req \gset
insert into messages (conversation_id, content) values (:'req', 'Hi, we haven''t met');
select 'hana (who started it) sees a request: ' || is_request from get_my_conversations() where id = :'req';
select 'a stranger sees gina''s last seen: ' || coalesce(m->>'last_seen_at', 'hidden')
  from get_my_conversations(), jsonb_array_elements(members) m where id = :'req' and m->>'id' = '44444444-4444-4444-4444-444444444444';
select pg_temp.as_user('44444444-4444-4444-4444-444444444444');
select 'gina sees a request: ' || is_request from get_my_conversations() where id = :'req';
select pg_temp.refused('asking the server about someone else''s requests',
  format($$select public.is_message_request(%L, '55555555-5555-5555-5555-555555555555')$$, :'req'));
select pg_temp.refused('calling the push function from the app',
  format($$select public.push_recipients(%L, '55555555-5555-5555-5555-555555555555')$$, :'req'));
reset role;
select 'push goes to (request): ' || count(*) from push_recipients(:'req', '55555555-5555-5555-5555-555555555555');
set role authenticated;
insert into messages (conversation_id, content) values (:'req', 'Hello Hana');
select 'after gina replies: ' || is_request from get_my_conversations() where id = :'req';
select pg_temp.as_user('55555555-5555-5555-5555-555555555555');
select 'once accepted, hana sees gina''s last seen: ' || (m->>'last_seen_at' is not null)
  from get_my_conversations(), jsonb_array_elements(members) m where id = :'req' and m->>'id' = '44444444-4444-4444-4444-444444444444';
reset role;
select 'push goes to (accepted): ' || count(*) from push_recipients(:'req', '55555555-5555-5555-5555-555555555555');
set role authenticated;

-- ---- Rate limit ----
select pg_temp.as_user('55555555-5555-5555-5555-555555555555');
do $$
declare sent integer := 0;
begin
  for i in 1..30 loop
    insert into public.messages (conversation_id, content)
    values ((select id from public.conversations where direct_key like '%55555555-5555-5555-5555-555555555555%'), 'spam ' || i);
    sent := sent + 1;
  end loop;
  raise notice 'FAIL: no rate limit (% sent)', sent;
exception when program_limit_exceeded then
  raise notice 'OK: stopped after % more messages (15 in 10 s, counting the first one)', sent;
end $$;

-- ---- Files nobody uses ----
reset role;
insert into storage.objects (bucket_id, name, created_at) values
  ('chat-images', :'req' || '/lost.webp',  now() - interval '2 hours'),
  ('chat-images', :'req' || '/fresh.webp', now()),
  ('chat-images', :'req' || '/used.webp',  now() - interval '2 hours'),
  ('chat-files',  :'req' || '/m1/cv.pdf',  now() - interval '2 hours'),
  ('avatars', '55555555-5555-5555-5555-555555555555/old.webp', now() - interval '2 hours'),
  ('avatars', '55555555-5555-5555-5555-555555555555/current.webp', now() - interval '2 hours');
insert into messages (conversation_id, sender_id, kind, image_path) values
  (:'req', '44444444-4444-4444-4444-444444444444', 'image', :'req' || '/used.webp');
update profiles set avatar_url = 'https://abc.supabase.co/storage/v1/object/public/avatars/55555555-5555-5555-5555-555555555555/current.webp'
 where id = '55555555-5555-5555-5555-555555555555';
select 'orphans: ' || string_agg(bucket_id || ':' || regexp_replace(name, '^[^/]+/', ''), ', ' order by bucket_id, name) from orphaned_files();

-- ---- Deleting an account ----
set role authenticated;
select pg_temp.as_user('55555555-5555-5555-5555-555555555555');
select create_group_conversation('Hana''s group', array['44444444-4444-4444-4444-444444444444']::uuid[]) as hgrp \gset
reset role;
delete from auth.users where id = '55555555-5555-5555-5555-555555555555';
select 'profile gone: ' || (count(*) = 0) from profiles where id = '55555555-5555-5555-5555-555555555555';
select 'their one-to-one chat gone: ' || (count(*) = 0) from conversations where id = :'req';
select 'their group kept, gina is admin now: ' || role from conversation_participants where conversation_id = :'hgrp';
select 'their messages gone: ' || (count(*) = 0) from messages where sender_id = '55555555-5555-5555-5555-555555555555';
