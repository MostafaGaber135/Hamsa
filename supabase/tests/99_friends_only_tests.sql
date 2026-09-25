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

-- Pat and Quinn are friends, Quinn and Ray are friends; Pat and Ray have never met.
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('b1111111-1111-1111-1111-111111111111', 'pat@x.com',   '{"full_name":"Pat"}'),
  ('b2222222-2222-2222-2222-222222222222', 'quinn@x.com', '{"full_name":"Quinn"}'),
  ('b3333333-3333-3333-3333-333333333333', 'ray@x.com',   '{"full_name":"Ray"}');
update profiles set username = 'pat_one' where id = 'b1111111-1111-1111-1111-111111111111';
update profiles set username = 'quinn'   where id = 'b2222222-2222-2222-2222-222222222222';
update profiles set username = 'ray_q'   where id = 'b3333333-3333-3333-3333-333333333333';
insert into friendships (requester_id, addressee_id, status) values
  ('b1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222', 'accepted'),
  ('b2222222-2222-2222-2222-222222222222', 'b3333333-3333-3333-3333-333333333333', 'accepted');
set role authenticated;
select pg_temp.as_user('b1111111-1111-1111-1111-111111111111');

-- ---- Profiles: only people you're connected to ----
select pg_temp.check('pat sees her own profile', (select count(*) from profiles where id = 'b1111111-1111-1111-1111-111111111111') = 1);
select pg_temp.check('pat sees her friend quinn', (select count(*) from profiles where id = 'b2222222-2222-2222-2222-222222222222') = 1);
select pg_temp.check('pat can''t see ray, a stranger', (select count(*) from profiles where id = 'b3333333-3333-3333-3333-333333333333') = 0);
select pg_temp.check('pat can''t list everyone', (select count(*) from profiles) = 2);

-- ---- Search: the start of a username, at least 3 characters ----
select pg_temp.check('2 characters find nobody', (select count(*) from search_people('ra')) = 0);
select pg_temp.check('"@RAY" finds ray_q', (select string_agg(username, ',') from search_people('@RAY')) = 'ray_q');
select pg_temp.check('a name with a space finds nobody', (select count(*) from search_people('ray q')) = 0);
select pg_temp.check('the middle of a username finds nobody', (select count(*) from search_people('_q')) = 0);
select pg_temp.check('pat doesn''t find herself', (select count(*) from search_people('pat')) = 0);

-- ---- People you may know: friends of friends ----
select pg_temp.check('pat is shown ray, with one mutual friend',
  (select string_agg(username || '/' || mutual_friends, ',') from people_you_may_know()) = 'ray_q/1');

-- ---- New chats and groups need a friendship ----
select pg_temp.refused('pat starting a chat with ray', $$select public.get_or_create_direct_conversation('b3333333-3333-3333-3333-333333333333')$$);
select pg_temp.refused('pat putting ray in a group', $$select public.create_group_conversation('Hi', array['b3333333-3333-3333-3333-333333333333']::uuid[])$$);
select get_or_create_direct_conversation('b2222222-2222-2222-2222-222222222222') as pq \gset
select pg_temp.check('pat can start a chat with quinn', :'pq' is not null);
select remove_friendship('b2222222-2222-2222-2222-222222222222');
select pg_temp.check('after unfriending, the chat they had still opens',
  get_or_create_direct_conversation('b2222222-2222-2222-2222-222222222222') = :'pq');
select pg_temp.check('and quinn is still visible to pat there', (select count(*) from profiles where id = 'b2222222-2222-2222-2222-222222222222') = 1);

-- ---- Usernames and blocks ----
select pg_temp.check('a taken username isn''t available', not is_username_available('ray_q'));
select pg_temp.check('pat''s own username is available to her', is_username_available('pat_one'));
select pg_temp.check('a free username is available', is_username_available('nobody_has_this'));
select pg_temp.as_user('b3333333-3333-3333-3333-333333333333');
select block_user('b1111111-1111-1111-1111-111111111111');
select pg_temp.as_user('b1111111-1111-1111-1111-111111111111');
select pg_temp.check('someone who blocked you isn''t found', (select count(*) from search_people('ray')) = 0);

-- ---- Signed out ----
reset role; set role anon;
do $$ begin perform public.search_people('ray'); raise notice 'FAIL: anon searched';
exception when insufficient_privilege then raise notice 'OK: anon cannot search people'; end $$;
