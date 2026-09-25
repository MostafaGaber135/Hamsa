\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); end $$;
-- Live update events sent since a mark, as "topic:event" pairs.
create or replace function pg_temp.sent_since(mark integer) returns text language sql as $$
  select coalesce(string_agg(
    replace(replace(replace(topic, 'user:11111111-1111-1111-1111-111111111111', 'alice'),
      'user:22222222-2222-2222-2222-222222222222', 'bob'), 'user:33333333-3333-3333-3333-333333333333', 'eve')
    || ':' || (payload ->> 'event'), ', ' order by topic, id), 'nothing')
  from realtime.messages where id > mark and topic like 'user:%' $$;
reset role;
select id as direct from conversations where direct_key = '11111111-1111-1111-1111-111111111111:22222222-2222-2222-2222-222222222222' \gset
select id as grp from conversations where name like 'Book%' \gset

-- A new message reaches both people, and only them. No chat-list reload.
select coalesce(max(id), 0) as mark from realtime.messages \gset
set role authenticated;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
insert into messages (conversation_id, content) values (:'direct', 'live!');
reset role;
select 'new message: ' || pg_temp.sent_since(:mark);
select 'the message travels with it: ' || (payload -> 'payload' ->> 'content') from realtime.messages
 where id > :mark and topic = 'user:11111111-1111-1111-1111-111111111111' and payload ->> 'event' = 'message';

-- Reading a chat tells the other person, not yourself.
select coalesce(max(id), 0) as mark from realtime.messages \gset
set role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select mark_conversation_read(:'direct');
reset role;
select 'alice reads: ' || pg_temp.sent_since(:mark);

-- Pinning changes nothing for anyone else.
select coalesce(max(id), 0) as mark from realtime.messages \gset
set role authenticated;
select set_conversation_pinned(:'direct', true);
reset role;
select 'alice pins: ' || pg_temp.sent_since(:mark);

-- Renaming a group reloads its members' lists.
select coalesce(max(id), 0) as mark from realtime.messages \gset
set role authenticated;
select update_group(:'grp', 'Book Club 2', null);
reset role;
select 'group renamed: ' || pg_temp.sent_since(:mark);

-- A friend request reaches both people.
set role authenticated;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select remove_friendship('33333333-3333-3333-3333-333333333333');
reset role;
select coalesce(max(id), 0) as mark from realtime.messages \gset
set role authenticated;
select send_friend_request('33333333-3333-3333-3333-333333333333');
reset role;
select 'friend request: ' || pg_temp.sent_since(:mark);

-- Only you can listen on your channel, and nobody can post to it from the app.
set role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select set_config('realtime.topic', 'user:11111111-1111-1111-1111-111111111111', false);
select 'alice can listen on her channel: ' || (count(*) > 0) from realtime.messages;
select set_config('realtime.topic', 'user:22222222-2222-2222-2222-222222222222', false);
select 'alice listening on bob''s channel sees: ' || count(*) from realtime.messages;
do $$ begin
  insert into realtime.messages (topic, extension) values ('user:22222222-2222-2222-2222-222222222222', 'broadcast');
  raise notice 'FAIL: alice posted to bob''s channel';
exception when insufficient_privilege then raise notice 'OK: nobody can post to someone''s channel';
end $$;

reset role;
select 'tables still on Postgres Changes: ' || count(*) from pg_publication_tables where pubname = 'supabase_realtime';
