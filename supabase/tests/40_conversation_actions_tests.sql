\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
-- Run after 30_profile_tests.sql.
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); end $$;
set role authenticated;

-- Bob: direct chat with Alice (from test 10) + the group
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select id as direct from conversations where not is_group \gset
select id as grp from conversations where is_group \gset
select 'bob order before: ' || string_agg(coalesce(name,'direct'), ', ') from get_my_conversations();
select set_conversation_pinned(:'direct', true);
select 'bob order after pin: ' || string_agg(coalesce(name,'direct') || case when pinned_at is not null then '(pinned)' else '' end, ', ') from get_my_conversations();
select set_conversation_muted(:'grp', true);
select mark_conversation_unread(:'direct');
select 'direct unread flag: ' || marked_unread || ', group muted: ' || (select muted from get_my_conversations() where id = :'grp') from get_my_conversations() where id = :'direct';
select 'alice read receipt untouched: ' || (last_read_at is not null) from conversation_participants where conversation_id = :'direct' and user_id = '22222222-2222-2222-2222-222222222222';
select mark_conversation_read(:'direct');
select 'after open, flag: ' || marked_unread from get_my_conversations() where id = :'direct';

-- Delete chat for Bob only
select clear_conversation(:'direct');
select 'bob list after delete: ' || coalesce(string_agg(coalesce(name,'direct'), ', '), '(none)') from get_my_conversations();
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select 'alice still has it: ' || count(*) from get_my_conversations() where id = :'direct';
insert into messages (conversation_id, content) values (:'direct', 'New one');
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select 'bob list after new msg: ' || string_agg(coalesce(name,'direct') || ' last=' || (last_message->>'content') || ' unread=' || unread_count, ', ') from get_my_conversations() where id = :'direct';

-- Leave group
do $$ begin perform leave_conversation((select id from public.conversations where not is_group limit 1)); raise notice 'FAIL left direct';
exception when others then raise notice 'OK: cannot leave a 1:1 chat (%)', sqlerrm; end $$;
select pg_temp.as_user('33333333-3333-3333-3333-333333333333');  -- Eve is the group admin
select leave_conversation(:'grp');
select 'eve groups now: ' || count(*) from get_my_conversations() where is_group;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select 'new admin exists: ' || count(*) from conversation_participants where conversation_id = :'grp' and role = 'admin';
-- Nobody can pin someone else's row
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select set_conversation_pinned(:'direct', true);
reset role;
select 'bob pin still off (unaffected by alice): ' || (pinned_at is null) from conversation_participants where conversation_id = :'direct' and user_id = '22222222-2222-2222-2222-222222222222';
