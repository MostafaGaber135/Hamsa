\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
-- Signed in as a real user of project "abc": the token issuer names the project's host.
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, false);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'iss', 'https://abc.supabase.co/auth/v1')::text, false);
end $$;
create or replace function pg_temp.try_avatar(label text, url text) returns void language plpgsql as $$
begin
  update public.profiles set avatar_url = url where id = '11111111-1111-1111-1111-111111111111';
  raise notice 'FAIL: % accepted', label;
exception when check_violation then raise notice 'OK: % rejected', label;
end $$;
create or replace function pg_temp.try_group_avatar(label text, url text) returns void language plpgsql as $$
begin
  perform public.update_group((select id from public.conversations where name like 'Book%'), 'Book Club', url);
  raise notice 'FAIL: % accepted', label;
exception when check_violation then raise notice 'OK: % rejected', label;
end $$;
reset role;
select id as grp from conversations where name like 'Book%' \gset
set role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');

-- Profile photo
update profiles set avatar_url = 'https://abc.supabase.co/storage/v1/object/public/avatars/11111111-1111-1111-1111-111111111111/1759000000000.webp' where id = '11111111-1111-1111-1111-111111111111';
update profiles set avatar_url = 'https://lh3.googleusercontent.com/a/photo=s96-c' where id = '11111111-1111-1111-1111-111111111111';
update profiles set avatar_url = null where id = '11111111-1111-1111-1111-111111111111';
select 'own upload, Google photo and no photo: ok';
select pg_temp.try_avatar('photo on another server', 'https://evil.example/pixel.gif');
select pg_temp.try_avatar('photo in someone else''s folder', 'https://abc.supabase.co/storage/v1/object/public/avatars/22222222-2222-2222-2222-222222222222/1.webp');
select pg_temp.try_avatar('photo from another project', 'https://evil.supabase.co/storage/v1/object/public/avatars/11111111-1111-1111-1111-111111111111/1.webp');
select pg_temp.try_avatar('photo with a query string', 'https://abc.supabase.co/storage/v1/object/public/avatars/11111111-1111-1111-1111-111111111111/1.webp?x=1');
select pg_temp.try_avatar('photo outside the folder', 'https://abc.supabase.co/storage/v1/object/public/avatars/11111111-1111-1111-1111-111111111111/../x/1.webp');

-- Group photo
select update_group(:'grp', 'Book Club', 'https://abc.supabase.co/storage/v1/object/public/avatars/groups/' || :'grp' || '/1759000000000.webp');
select 'group photo from its own folder: ok';
select pg_temp.try_group_avatar('group photo on another server', 'https://evil.example/pixel.gif');
select pg_temp.try_group_avatar('group photo from a profile folder', 'https://abc.supabase.co/storage/v1/object/public/avatars/11111111-1111-1111-1111-111111111111/1.webp');
-- A photo URL saved before this rule existed, written by an admin (no user token).
reset role;
select set_config('request.jwt.claims', '', false);
update conversations set avatar_url = 'https://old.example/legacy.png' where id = :'grp';
set role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select update_group(:'grp', 'Book Club (renamed)', 'https://old.example/legacy.png');
select 'renaming keeps an older photo URL: ok';

-- Last admin
select set_member_role(:'grp', '22222222-2222-2222-2222-222222222222', 'member');
do $$ begin
  perform public.set_member_role((select id from public.conversations where name like 'Book%'), '11111111-1111-1111-1111-111111111111', 'member');
  raise notice 'FAIL: last admin demoted';
exception when invalid_parameter_value then raise notice 'OK: last admin cannot be demoted';
end $$;

-- Chat image limits
reset role;
select 'chat-images limits: ' || file_size_limit || ' ' || array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'chat-images';
