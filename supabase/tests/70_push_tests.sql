\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); end $$;
set role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select save_push_subscription('https://fcm.googleapis.com/fcm/send/abc', 'p', 'a', 'Chrome');
select 'alice devices: ' || count(*) from push_subscriptions;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select 'bob sees alice devices: ' || count(*) from push_subscriptions;
-- same browser, now signed in as bob: moves over
select save_push_subscription('https://fcm.googleapis.com/fcm/send/abc', 'p2', 'a2', 'Chrome');
select 'bob devices: ' || count(*) from push_subscriptions;
reset role;
select 'total rows for that endpoint: ' || count(*) || ' owner is bob: ' || bool_and(user_id = '22222222-2222-2222-2222-222222222222') from push_subscriptions where endpoint like '%abc';
set role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select delete_push_subscription('https://fcm.googleapis.com/fcm/send/abc');
reset role;
select 'alice cannot delete bob''s device: ' || count(*) from push_subscriptions;
set role authenticated;
do $$ begin perform save_push_subscription('http://evil.example', 'p', 'a', 'x'); raise notice 'FAIL http endpoint';
exception when others then raise notice 'OK: non-https endpoint rejected'; end $$;
do $$ begin insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ('22222222-2222-2222-2222-222222222222', 'https://x', 'p', 'a'); raise notice 'FAIL direct insert';
exception when insufficient_privilege then raise notice 'OK: direct insert blocked'; end $$;
