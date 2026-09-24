\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
-- Run after 20_friends_tests.sql.
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); end $$;

set role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
update profiles set full_name = 'Alice W.', username = 'alice' where id = '11111111-1111-1111-1111-111111111111';
select 'alice renamed: ' || full_name || ' @' || username from profiles where id = '11111111-1111-1111-1111-111111111111';
update profiles set full_name = 'hacked' where id = '22222222-2222-2222-2222-222222222222';
select 'bob untouched: ' || full_name from profiles where id = '22222222-2222-2222-2222-222222222222';
do $$ begin update public.profiles set last_seen_at = '2000-01-01' where id = '11111111-1111-1111-1111-111111111111'; raise notice 'FAIL last_seen editable';
exception when insufficient_privilege then raise notice 'OK: last_seen_at not editable'; end $$;
do $$ begin update public.profiles set username = 'Bad Name!' where id = '11111111-1111-1111-1111-111111111111'; raise notice 'FAIL bad username';
exception when check_violation then raise notice 'OK: invalid username rejected'; end $$;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
do $$ begin update public.profiles set username = 'alice' where id = '22222222-2222-2222-2222-222222222222'; raise notice 'FAIL duplicate username';
exception when unique_violation then raise notice 'OK: taken username rejected'; end $$;
-- storage
insert into storage.objects (bucket_id, name) values ('avatars', '22222222-2222-2222-2222-222222222222/1.webp');
select 'bob uploaded own avatar';
do $$ begin insert into storage.objects (bucket_id, name) values ('avatars', '11111111-1111-1111-1111-111111111111/x.webp'); raise notice 'FAIL upload to other folder';
exception when insufficient_privilege then raise notice 'OK: cannot upload into someone else''s folder'; end $$;
reset role;
-- removed photo stays removed on re-login with same Google photo
update profiles set avatar_url = null where id = '44444444-4444-4444-4444-444444444444';
update auth.users set raw_user_meta_data = raw_user_meta_data || '{"iss":"again"}' where id = '44444444-4444-4444-4444-444444444444';
select 'gina after re-login: ' || coalesce(avatar_url, 'still removed') from profiles where id = '44444444-4444-4444-4444-444444444444';
update auth.users set raw_user_meta_data = raw_user_meta_data || '{"picture":"https://lh3.googleusercontent.com/a/new"}' where id = '44444444-4444-4444-4444-444444444444';
select 'gina after new Google photo: ' || coalesce(avatar_url, 'null') from profiles where id = '44444444-4444-4444-4444-444444444444';
