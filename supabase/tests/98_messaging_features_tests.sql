\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); end $$;
-- Must be refused; prints the error code so the reason can be checked.
create or replace function pg_temp.refused(label text, stmt text) returns void language plpgsql as $$
begin
  execute stmt;
  raise notice 'FAIL: % allowed', label;
exception when insufficient_privilege or invalid_parameter_value or check_violation or no_data_found
  then raise notice 'OK: % refused (%)', label, sqlstate;
end $$;
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('66666666-6666-6666-6666-666666666666', 'ivan@x.com', '{"full_name":"Ivan Petrov"}');
select id as direct from conversations where direct_key = '11111111-1111-1111-1111-111111111111:22222222-2222-2222-2222-222222222222' \gset
select id as grp from conversations where name like 'Book%' \gset
select username as bobname from profiles where id = '22222222-2222-2222-2222-222222222222' \gset
-- Earlier test files sent many messages a moment ago: start with a clear rate limit.
update messages set created_at = created_at - interval '1 minute' where created_at > now() - interval '1 minute';
set role authenticated;

-- ---- Replies, and fields only the server sets ----
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
insert into messages (id, conversation_id, content) values ('a0000000-0000-0000-0000-00000000000a', :'direct', 'searchable hello');
insert into messages (id, conversation_id, content) values ('a0000000-0000-0000-0000-00000000000b', :'grp', 'group note');
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
insert into messages (conversation_id, content, reply_to_id, edited_at, pinned_at)
values (:'direct', 'a reply', 'a0000000-0000-0000-0000-00000000000a', '2000-01-01', now());
select 'reply saved, fake edit/pin ignored: ' || (edited_at is null and pinned_at is null)
  from messages where reply_to_id = 'a0000000-0000-0000-0000-00000000000a';
select pg_temp.refused('replying to a message from another chat',
  format($$insert into public.messages (conversation_id, content, reply_to_id) values (%L, 'x', 'a0000000-0000-0000-0000-00000000000b')$$, :'direct'));

-- ---- Mentions ----
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
insert into messages (id, conversation_id, content) values ('a0000000-0000-0000-0000-00000000000c', :'grp', 'hi @' || :'bobname' || ', and @nobody_here');
select 'mentions found: ' || (mentions = array['22222222-2222-2222-2222-222222222222']::uuid[]) from messages where id = 'a0000000-0000-0000-0000-00000000000c';
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select set_conversation_muted(:'grp', true);
reset role;
select 'muted bob gets a push when mentioned: ' || count(*) from push_recipients(:'grp', '11111111-1111-1111-1111-111111111111', array['22222222-2222-2222-2222-222222222222']::uuid[]);
select 'muted bob, not mentioned: ' || count(*) from push_recipients(:'grp', '11111111-1111-1111-1111-111111111111');
set role authenticated;
select set_conversation_muted(:'grp', false);

-- ---- Edit and delete for everyone ----
select pg_temp.refused('bob editing alice''s message', $$select public.edit_message('a0000000-0000-0000-0000-00000000000a', 'hacked')$$);
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select edit_message('a0000000-0000-0000-0000-00000000000a', 'searchable hello (edited)');
select 'edited: ' || content || ' / marked: ' || (edited_at is not null) from messages where id = 'a0000000-0000-0000-0000-00000000000a';
reset role;
update messages set created_at = now() - interval '20 minutes' where id = 'a0000000-0000-0000-0000-00000000000b';
set role authenticated;
select pg_temp.refused('editing after 15 minutes', $$select public.edit_message('a0000000-0000-0000-0000-00000000000b', 'late')$$);
insert into messages (id, conversation_id, kind, attachment) values ('a0000000-0000-0000-0000-00000000000d', :'direct', 'location', '{"lat":1,"lng":2}');
select delete_message('a0000000-0000-0000-0000-00000000000d');
select 'deleted location: ' || coalesce(content, 'no content') || ', ' || coalesce(attachment::text, 'no attachment') || ', deleted: ' || (deleted_at is not null)
  from messages where id = 'a0000000-0000-0000-0000-00000000000d';
select 'the list shows it deleted: ' || (last_message ? 'deleted_at') from get_my_conversations() where id = :'direct';
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select pg_temp.refused('bob deleting alice''s message', $$select public.delete_message('a0000000-0000-0000-0000-00000000000a')$$);

-- ---- Reactions ----
reset role;
select coalesce(max(id), 0) as mark from realtime.messages \gset
set role authenticated;
select react('a0000000-0000-0000-0000-00000000000a', '👍');
select react('a0000000-0000-0000-0000-00000000000a', '❤️');
select 'bob''s reaction: ' || string_agg(emoji, ',') from message_reactions where message_id = 'a0000000-0000-0000-0000-00000000000a';
reset role;
select 'reaction events sent: ' || count(*) from realtime.messages where id > :mark and payload ->> 'event' = 'reaction';
set role authenticated;
select react('a0000000-0000-0000-0000-00000000000a', null);
select 'after removing: ' || count(*) from message_reactions where message_id = 'a0000000-0000-0000-0000-00000000000a';
select pg_temp.as_user('33333333-3333-3333-3333-333333333333');
select pg_temp.refused('eve reacting in a chat she isn''t in', $$select public.react('a0000000-0000-0000-0000-00000000000a', '😀')$$);

-- ---- Pins ----
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select pg_temp.refused('a group member (not admin) pinning', $$select public.pin_message('a0000000-0000-0000-0000-00000000000b', true)$$);
select pin_message('a0000000-0000-0000-0000-00000000000a', true);
select 'pinned in the 1:1 chat: ' || (pinned_at is not null) from messages where id = 'a0000000-0000-0000-0000-00000000000a';
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
insert into messages (id, conversation_id, content) values
  ('a0000000-0000-0000-0000-0000000000e1', :'direct', 'p1'), ('a0000000-0000-0000-0000-0000000000e2', :'direct', 'p2'),
  ('a0000000-0000-0000-0000-0000000000e3', :'direct', 'p3');
select pin_message('a0000000-0000-0000-0000-0000000000e1', true);
select pin_message('a0000000-0000-0000-0000-0000000000e2', true);
select pg_temp.refused('a fourth pin', $$select public.pin_message('a0000000-0000-0000-0000-0000000000e3', true)$$);

-- ---- Saved messages ----
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
insert into saved_messages (message_id) values ('a0000000-0000-0000-0000-00000000000a');
select 'bob saved: ' || count(*) from saved_messages;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select 'alice sees bob''s saved: ' || count(*) from saved_messages;
select pg_temp.as_user('33333333-3333-3333-3333-333333333333');
select pg_temp.refused('eve saving a message from a chat she isn''t in',
  $$insert into public.saved_messages (message_id) values ('a0000000-0000-0000-0000-00000000000a')$$);

-- ---- Search ----
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
insert into messages (conversation_id, content) values (:'direct', 'مرحبا بك في همسة');
select 'alice finds: ' || count(*) from search_messages('SEARCHABLE');
select 'arabic search: ' || count(*) from search_messages('رحبا');
select '"%" matches literally: ' || count(*) from search_messages('%%');
select delete_message('a0000000-0000-0000-0000-0000000000e3');
select 'deleted messages aren''t found: ' || count(*) from search_messages('p3');
select pg_temp.as_user('33333333-3333-3333-3333-333333333333');
select 'eve (not in the chat) finds: ' || count(*) from search_messages('searchable');

-- ---- Reports ----
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select report('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-00000000000a', 'spam', 'test');
select report('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-00000000000a', 'spam');
select 'bob can read reports: ' || count(*) from reports;
select pg_temp.refused('reporting a stranger', $$select public.report('66666666-6666-6666-6666-666666666666', null, 'spam')$$);
reset role;
select 'reports stored (once): ' || count(*) || ', text kept: ' || bool_and(message_content is not null) from reports;
set role authenticated;

-- ---- Group description and invite link ----
select pg_temp.refused('a member changing the description', format($$select public.set_group_description(%L, 'x')$$, :'grp'));
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select set_group_description(:'grp', 'We read one book a month');
select set_group_invite(:'grp', true) as code \gset
select 'admin sees the link: ' || (invite_code = :'code') from get_my_conversations() where id = :'grp';
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select 'member sees the link: ' || coalesce(invite_code, 'hidden') || ', description: ' || description from get_my_conversations() where id = :'grp';
select pg_temp.as_user('66666666-6666-6666-6666-666666666666');
select 'invite preview: ' || name || ', ' || member_count || ' members, already in: ' || already_member from get_group_invite(:'code');
select 'ivan joined: ' || (join_group_by_invite(:'code') = :'grp');
select 'wrong code shows nothing: ' || count(*) from get_group_invite('nope');
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select set_group_invite(:'grp', false);
select pg_temp.as_user('66666666-6666-6666-6666-666666666666');
select pg_temp.refused('joining with a revoked link', format($$select public.join_group_by_invite(%L)$$, :'code'));
