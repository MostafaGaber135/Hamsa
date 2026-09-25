\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); end $$;
-- Runs a statement that must be refused; any permission or validation error counts.
create or replace function pg_temp.refused(label text, stmt text) returns void language plpgsql as $$
begin
  execute stmt;
  raise notice 'FAIL: % allowed', label;
exception when insufficient_privilege or check_violation then raise notice 'OK: % refused', label;
end $$;
reset role;
select id as direct from conversations where not is_group and direct_key = '11111111-1111-1111-1111-111111111111:22222222-2222-2222-2222-222222222222' \gset
select id as grp from conversations where name like 'Book%' \gset
set role authenticated;

-- Alice blocks Eve: no new chat and no friend request, either way.
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select block_user('33333333-3333-3333-3333-333333333333');
select pg_temp.refused('alice starting a chat with blocked eve', $$select public.get_or_create_direct_conversation('33333333-3333-3333-3333-333333333333')$$);
select pg_temp.as_user('33333333-3333-3333-3333-333333333333');
select pg_temp.refused('eve starting a chat with alice who blocked her', $$select public.get_or_create_direct_conversation('11111111-1111-1111-1111-111111111111')$$);
select pg_temp.refused('eve sending a friend request to alice', $$select public.send_friend_request('11111111-1111-1111-1111-111111111111')$$);
select 'eve cannot see alice''s blocks: ' || count(*) from blocks;
select pg_temp.refused('eve asking who blocked whom', $$select public.is_blocked_between('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333')$$);

-- Bob blocks Alice: their existing chat stays readable but nobody can write in it.
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select send_friend_request('22222222-2222-2222-2222-222222222222');
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select block_user('11111111-1111-1111-1111-111111111111');
select 'bob blocks: ' || string_agg(full_name, ', ') from get_my_blocks();
select 'friendship removed by the block: ' || (count(*) = 0) from friendships
 where '11111111-1111-1111-1111-111111111111' in (requester_id, addressee_id) and '22222222-2222-2222-2222-222222222222' in (requester_id, addressee_id);
select pg_temp.refused('bob writing to alice after blocking her', format($$insert into public.messages (conversation_id, content) values (%L, 'hi')$$, :'direct'));
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select pg_temp.refused('alice writing to bob who blocked her', format($$insert into public.messages (conversation_id, content) values (%L, 'hi')$$, :'direct'));
select 'alice can still open the old chat: ' || (get_or_create_direct_conversation('22222222-2222-2222-2222-222222222222') = :'direct');
select 'alice sees it as blocked: ' || (:'direct' in (select get_blocked_conversations()));
insert into messages (conversation_id, content) values (:'grp', 'groups still work');
select 'alice can still write in a shared group: ok';
select pg_temp.refused('alice adding bob (who blocked her) to a new group', $$select public.create_group_conversation('New', array['22222222-2222-2222-2222-222222222222']::uuid[])$$);

-- Bob unblocks Alice: they can talk again.
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select unblock_user('11111111-1111-1111-1111-111111111111');
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
insert into messages (conversation_id, content) values (:'direct', 'hello again');
select 'after unblock alice can write: ok';
select 'no blocked chats left for alice: ' || count(*) from get_blocked_conversations();

-- Only friends can add eve to groups.
select unblock_user('33333333-3333-3333-3333-333333333333');
select pg_temp.refused('a stranger adding eve to a group', $$select public.create_group_conversation('Strangers', array['33333333-3333-3333-3333-333333333333']::uuid[])$$);
select send_friend_request('33333333-3333-3333-3333-333333333333');
select pg_temp.as_user('33333333-3333-3333-3333-333333333333');
select send_friend_request('11111111-1111-1111-1111-111111111111');
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select 'a friend can add eve: ' || (create_group_conversation('Friends', array['33333333-3333-3333-3333-333333333333']::uuid[]) is not null);
