\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); end $$;
reset role;
select id as direct from conversations where not is_group limit 1 \gset
select 'old image messages became kind=image: ' || count(*) from messages where image_path is not null and kind <> 'image';
set role authenticated;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
insert into messages (conversation_id, kind, attachment) values (:'direct', 'voice', '{"path":"x/v.webm","mime":"audio/webm","duration_ms":8400}');
insert into messages (conversation_id, kind, attachment) values (:'direct', 'location', '{"lat":30.04,"lng":31.23}');
insert into messages (conversation_id, kind, content) values (:'direct', 'sticker', 'hi');
select 'rich messages saved: ' || count(*) from messages where kind in ('voice','location','sticker');
do $$ begin insert into public.messages (conversation_id, kind) values ((select id from public.conversations where not is_group limit 1), 'voice'); raise notice 'FAIL empty message';
exception when check_violation then raise notice 'OK: empty message rejected'; end $$;
do $$ begin insert into public.messages (conversation_id, kind, content) values ((select id from public.conversations where not is_group limit 1), 'gif', 'x'); raise notice 'FAIL unknown kind';
exception when check_violation then raise notice 'OK: unknown kind rejected'; end $$;
select 'sidebar sees kind: ' || (last_message->>'kind') from get_my_conversations() where id = :'direct';
-- chat files bucket
insert into storage.objects (bucket_id, name) values ('chat-files', :'direct' || '/cv.pdf');
select 'member uploaded a file: ok';
select pg_temp.as_user('44444444-4444-4444-4444-444444444444');
do $$ begin insert into storage.objects (bucket_id, name) values ('chat-files', (select id from public.conversations where not is_group limit 1)::text || '/x.pdf'); raise notice 'FAIL outsider file';
exception when others then raise notice 'OK: outsider cannot upload files (%)', sqlstate; end $$;
-- wallpaper is per person
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select set_conversation_wallpaper(:'direct', 'sage');
select 'bob wallpaper: ' || wallpaper from get_my_conversations() where id = :'direct';
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select 'alice wallpaper: ' || coalesce(wallpaper, 'default') from get_my_conversations() where id = :'direct';
-- group management: alice creates a group, bob is a plain member
select create_group_conversation('Book club', array['22222222-2222-2222-2222-222222222222']::uuid[]) as grp \gset
select update_group(:'grp', 'Book Club 📚', 'https://x/avatars/groups/g.webp');
select 'renamed: ' || name || ' photo: ' || (avatar_url is not null) || ' my role: ' || my_role from get_my_conversations() where id = :'grp';
reset role;
insert into friendships (requester_id, addressee_id, status)
values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'accepted');
set role authenticated;
select add_group_members(:'grp', array['33333333-3333-3333-3333-333333333333']::uuid[]);
select 'members now: ' || jsonb_array_length(members) from get_my_conversations() where id = :'grp';
insert into storage.objects (bucket_id, name) values ('avatars', 'groups/' || :'grp' || '/p.webp');
select 'admin uploaded group photo: ok';
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
do $$ begin perform update_group((select c.id from public.conversations c where c.name like 'Book%'), 'Hacked', null); raise notice 'FAIL member renamed';
exception when insufficient_privilege then raise notice 'OK: members cannot rename the group'; end $$;
do $$ begin perform remove_group_member((select c.id from public.conversations c where c.name like 'Book%'), '11111111-1111-1111-1111-111111111111'); raise notice 'FAIL member removed admin';
exception when insufficient_privilege then raise notice 'OK: members cannot remove people'; end $$;
do $$ begin insert into storage.objects (bucket_id, name) values ('avatars', 'groups/' || (select c.id from public.conversations c where c.name like 'Book%')::text || '/h.webp'); raise notice 'FAIL member photo';
exception when insufficient_privilege then raise notice 'OK: members cannot change the group photo'; end $$;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select set_member_role(:'grp', '22222222-2222-2222-2222-222222222222', 'admin');
select remove_group_member(:'grp', '33333333-3333-3333-3333-333333333333');
select 'after promote + remove: ' || string_agg((m->>'full_name') || '=' || (m->>'role'), ', ') from get_my_conversations(), jsonb_array_elements(members) m where id = :'grp';
