\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
-- users
insert into auth.users (id, email, raw_user_meta_data) values
 ('11111111-1111-1111-1111-111111111111','alice.w@gmail.com','{"full_name":"Alice Wong"}'),
 ('22222222-2222-2222-2222-222222222222','bo@x.com','{"name":"Bob Stone","avatar_url":"http://a/b.png"}'),
 ('33333333-3333-3333-3333-333333333333','eve@x.com','{}');
select 'profiles: ' || string_agg(username || '/' || full_name, ', ' order by username) from profiles;
-- Chats and groups are only between friends; these three are, for this file only.
insert into friendships (requester_id, addressee_id, status) values
 ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','accepted'),
 ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','accepted'),
 ('22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','accepted');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); end $$;

set role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select 'direct1 created: ' || (get_or_create_direct_conversation('22222222-2222-2222-2222-222222222222') is not null);
\set c1 '(select id from conversations where not is_group limit 1)'
select 'alice sees convs: ' || count(*) from conversations;
insert into messages (id, conversation_id, content, created_at) select 'aaaaaaaa-0000-0000-0000-000000000001', id, 'Hi Bob', '2000-01-01' from conversations limit 1;
select 'created_at forced to now: ' || (created_at > now() - interval '1 minute') from messages;
select 'last_message_at set: ' || (last_message_at is not null) from conversations;

select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select 'bob same conv: ' || (get_or_create_direct_conversation('11111111-1111-1111-1111-111111111111') = (select id from conversations limit 1));
select 'bob unread before: ' || unread_count || ' last msg: ' || (last_message->>'content') || ' members: ' || jsonb_array_length(members) from get_my_conversations();
select mark_conversation_read((select id from conversations limit 1));
select 'bob unread after: ' || unread_count from get_my_conversations();

-- Bob tries to impersonate Alice
do $$ begin
  insert into messages (conversation_id, sender_id, content) select id, '11111111-1111-1111-1111-111111111111', 'fake' from conversations limit 1;
  raise notice 'FAIL: impersonation allowed';
exception when insufficient_privilege then raise notice 'OK: impersonation blocked';
end $$;

-- Eve: outsider
select pg_temp.as_user('33333333-3333-3333-3333-333333333333');
select 'eve sees convs: ' || count(*) from conversations;
select 'eve sees msgs: ' || count(*) from messages;
select 'eve sees participants: ' || count(*) from conversation_participants;
select 'eve get_my: ' || count(*) from get_my_conversations();
do $$ begin
  insert into messages (conversation_id, content) values ((select c.id from public.conversations c limit 1), 'x');
  raise notice 'eve insert with null conv?';
exception when others then raise notice 'OK: eve insert blocked (%)', sqlstate;
end $$;
reset role;
-- Eve tries into the real conversation id (she can't select it, so get it as admin)
select id as convid from conversations limit 1 \gset
select set_config('my.conv', :'convid', false);
set role authenticated;
select pg_temp.as_user('33333333-3333-3333-3333-333333333333');
do $$ begin
  insert into messages (conversation_id, content) values (current_setting('my.conv')::uuid, 'x');
  raise notice 'FAIL: eve inserted';
exception when insufficient_privilege then raise notice 'OK: eve blocked from foreign conversation';
end $$;

select 'eve mark read no-op ok';
select mark_conversation_read(current_setting('my.conv')::uuid);
do $$ begin perform get_or_create_direct_conversation('33333333-3333-3333-3333-333333333333'); raise notice 'FAIL self';
exception when others then raise notice 'OK: self chat blocked (%)', sqlerrm; end $$;
-- group
select 'group: ' || (create_group_conversation('  Frontend Team ', array['11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333']::uuid[]) is not null);
select 'eve convs now: ' || string_agg(coalesce(name,'direct') || ' members=' || jsonb_array_length(members), '; ') from get_my_conversations();
do $$ begin perform create_group_conversation('x', array['33333333-3333-3333-3333-333333333333']::uuid[]); raise notice 'FAIL empty group';
exception when others then raise notice 'OK: group needs people (%)', sqlerrm; end $$;
-- storage
insert into storage.objects (bucket_id, name) values ('chat-images', (select id from conversations where is_group)::text || '/a.png');
select 'eve uploaded to her group: ok';
do $$ begin insert into storage.objects (bucket_id, name) values ('chat-images', current_setting('my.conv') || '/b.png'); raise notice 'FAIL storage';
exception when insufficient_privilege then raise notice 'OK: storage blocked for foreign conversation'; end $$;
do $$ begin insert into storage.objects (bucket_id, name) values ('chat-images', 'not-a-uuid/b.png'); raise notice 'FAIL storage bad path';
exception when insufficient_privilege then raise notice 'OK: bad path blocked'; end $$;
-- anon cannot call rpc
reset role; set role anon;
do $$ begin perform public.get_my_conversations(); raise notice 'FAIL anon rpc';
exception when insufficient_privilege then raise notice 'OK: anon cannot call RPCs'; end $$;
do $$ begin perform count(*) from public.messages; raise notice 'anon message select ran (RLS returns 0 rows): %', (select count(*) from public.messages); end $$;
-- The friends tests start them as strangers.
reset role;
delete from friendships;
