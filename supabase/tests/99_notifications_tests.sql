\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); end $$;
create or replace function pg_temp.check(label text, passed boolean) returns void language plpgsql as $$
begin
  if passed then raise notice 'OK: %', label; else raise notice 'FAIL: %', label; end if;
end $$;
create or replace function pg_temp.refused(label text, stmt text) returns void language plpgsql as $$
begin
  execute stmt;
  raise notice 'FAIL: % allowed', label;
exception when insufficient_privilege then raise notice 'OK: % refused', label;
end $$;
-- Someone's unread notifications, oldest first: "kind/actor username/emoji".
create or replace function pg_temp.bell() returns text language sql as $$
  select coalesce(string_agg(kind || '/' || actor_username || coalesce('/' || emoji, ''), ', ' order by created_at, kind), '')
    from public.get_my_notifications() where read_at is null;
$$;

-- Nour, Omar and Sami, new to each other.
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('c1111111-1111-1111-1111-111111111111', 'nour@x.com', '{"full_name":"Nour"}'),
  ('c2222222-2222-2222-2222-222222222222', 'omar@x.com', '{"full_name":"Omar"}'),
  ('c3333333-3333-3333-3333-333333333333', 'sami@x.com', '{"full_name":"Sami"}');
update profiles set username = 'nour' where id = 'c1111111-1111-1111-1111-111111111111';
update profiles set username = 'omar' where id = 'c2222222-2222-2222-2222-222222222222';
update profiles set username = 'sami' where id = 'c3333333-3333-3333-3333-333333333333';
set role authenticated;

-- ---- Friend requests ----
select pg_temp.as_user('c1111111-1111-1111-1111-111111111111');
select send_friend_request('c2222222-2222-2222-2222-222222222222');
select pg_temp.check('nour isn''t notified of her own request', pg_temp.bell() = '');
select pg_temp.as_user('c2222222-2222-2222-2222-222222222222');
select pg_temp.check('omar is notified of the request', pg_temp.bell() = 'friend_request/nour');
select respond_friend_request('c1111111-1111-1111-1111-111111111111', true);
select pg_temp.check('accepting clears the request', pg_temp.bell() = '');
select pg_temp.as_user('c1111111-1111-1111-1111-111111111111');
select pg_temp.check('nour is told omar accepted', pg_temp.bell() = 'friend_accepted/omar');
select pg_temp.as_user('c3333333-3333-3333-3333-333333333333');
select send_friend_request('c1111111-1111-1111-1111-111111111111');
select remove_friendship('c1111111-1111-1111-1111-111111111111');
select pg_temp.as_user('c1111111-1111-1111-1111-111111111111');
select pg_temp.check('a cancelled request disappears', pg_temp.bell() = 'friend_accepted/omar');
select mark_notifications_read();
select pg_temp.check('marking read', pg_temp.bell() = '' and (select count(*) from get_my_notifications()) = 1);

-- ---- Groups ----
select create_group_conversation('Study', array['c2222222-2222-2222-2222-222222222222']::uuid[]) as grp \gset
select set_member_role(:'grp', 'c2222222-2222-2222-2222-222222222222', 'admin');
select pg_temp.as_user('c2222222-2222-2222-2222-222222222222');
select pg_temp.check('omar is told he was added, then made admin', pg_temp.bell() = 'added_to_group/nour, made_admin/nour');
select pg_temp.check('with the group''s name', (select bool_and(group_name = 'Study') from get_my_notifications()));
select mark_notifications_read();

-- ---- Reactions, mentions and replies ----
insert into messages (conversation_id, content) values (:'grp', 'Exam on Monday') returning id as omars \gset
select pg_temp.as_user('c1111111-1111-1111-1111-111111111111');
select react(:'omars', '👍');
select react(:'omars', '❤️');
select pg_temp.as_user('c2222222-2222-2222-2222-222222222222');
select pg_temp.check('a changed reaction replaces the old one', pg_temp.bell() = 'reaction/nour/❤️');
select pg_temp.check('with the message', (select message_text from get_my_notifications() where kind = 'reaction') = 'Exam on Monday');
select pg_temp.as_user('c1111111-1111-1111-1111-111111111111');
select react(:'omars', null);
select pg_temp.as_user('c2222222-2222-2222-2222-222222222222');
select pg_temp.check('a removed reaction disappears', pg_temp.bell() = '');
select pg_temp.as_user('c1111111-1111-1111-1111-111111111111');
insert into messages (conversation_id, content) values (:'grp', 'Thanks @omar');
insert into messages (conversation_id, content, reply_to_id) values (:'grp', 'Which room?', :'omars');
insert into messages (conversation_id, content) values (:'grp', 'Mine') returning id as nours \gset
select react(:'nours', '😂');
select pg_temp.check('nothing for reacting to your own message', pg_temp.bell() = '');
select pg_temp.as_user('c2222222-2222-2222-2222-222222222222');
select pg_temp.check('omar gets the mention and the reply', pg_temp.bell() = 'mention/nour, reply/nour');

-- ---- Privacy ----
select block_user('c1111111-1111-1111-1111-111111111111');
select mark_notifications_read();
select pg_temp.as_user('c1111111-1111-1111-1111-111111111111');
select react(:'omars', '👍');
select pg_temp.as_user('c2222222-2222-2222-2222-222222222222');
select pg_temp.check('nothing from someone you blocked', pg_temp.bell() = '');
select pg_temp.check('only your own rows are readable', (select count(*) from notifications where user_id <> 'c2222222-2222-2222-2222-222222222222') = 0);
select pg_temp.refused('notifying someone directly',
  $$select public.notify('c1111111-1111-1111-1111-111111111111', 'c2222222-2222-2222-2222-222222222222', 'reaction')$$);
select pg_temp.refused('writing a notification', $$insert into public.notifications (user_id, actor_id, kind) values ('c1111111-1111-1111-1111-111111111111', 'c2222222-2222-2222-2222-222222222222', 'reaction')$$);
