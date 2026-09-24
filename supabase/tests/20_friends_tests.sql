\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
-- Run after 10_security_tests.sql (uses its three users).
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); end $$;

-- Google sign-up gets a photo
insert into auth.users (id, email, raw_user_meta_data) values
 ('44444444-4444-4444-4444-444444444444','gina@gmail.com','{"full_name":"Gina G","picture":"https://lh3.googleusercontent.com/a/x"}');
select 'google avatar: ' || avatar_url from profiles where id = '44444444-4444-4444-4444-444444444444';
-- email user later links Google
update auth.users set raw_user_meta_data = raw_user_meta_data || '{"avatar_url":"https://lh3.googleusercontent.com/a/eve"}' where id = '33333333-3333-3333-3333-333333333333';
select 'linked avatar: ' || avatar_url from profiles where id = '33333333-3333-3333-3333-333333333333';

set role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select 'alice → bob: ' || send_friend_request('22222222-2222-2222-2222-222222222222');
select 'alice again: ' || send_friend_request('22222222-2222-2222-2222-222222222222');
select 'alice list: ' || string_agg(full_name || '/' || status || '/' || direction, ', ') from get_my_friendships();

select pg_temp.as_user('33333333-3333-3333-3333-333333333333');
select 'eve sees alice-bob rows: ' || count(*) from friendships;
do $$ begin perform respond_friend_request('11111111-1111-1111-1111-111111111111', true); raise notice 'FAIL eve accepted';
exception when others then raise notice 'OK: eve cannot accept others'' request (%)', sqlerrm; end $$;
do $$ begin insert into public.friendships (requester_id, addressee_id) values ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111'); raise notice 'FAIL direct insert';
exception when insufficient_privilege then raise notice 'OK: direct insert blocked'; end $$;

select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select 'bob list: ' || string_agg(full_name || '/' || status || '/' || direction, ', ') from get_my_friendships();
select respond_friend_request('11111111-1111-1111-1111-111111111111', true);
select 'bob after accept: ' || string_agg(full_name || '/' || status, ', ') from get_my_friendships();

-- mutual request auto-accepts
select pg_temp.as_user('33333333-3333-3333-3333-333333333333');
select 'eve → bob: ' || send_friend_request('22222222-2222-2222-2222-222222222222');
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select 'bob → eve (mutual): ' || send_friend_request('33333333-3333-3333-3333-333333333333');
-- decline + remove
select pg_temp.as_user('44444444-4444-4444-4444-444444444444');
select 'gina → bob: ' || send_friend_request('22222222-2222-2222-2222-222222222222');
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select respond_friend_request('44444444-4444-4444-4444-444444444444', false);
select remove_friendship('33333333-3333-3333-3333-333333333333');
select 'bob final: ' || string_agg(full_name || '/' || status, ', ') from get_my_friendships();
do $$ begin perform send_friend_request('22222222-2222-2222-2222-222222222222'); raise notice 'FAIL self';
exception when others then raise notice 'OK: self add blocked (%)', sqlerrm; end $$;
