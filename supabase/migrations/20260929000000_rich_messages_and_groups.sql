-- =====================================================================
-- Hamsa: voice notes, files, video, location, stickers, group settings,
-- and chat wallpapers
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (Run it AFTER the five earlier migrations. Don't run those again.)
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Message types
-- ---------------------------------------------------------------------
-- kind:        what the message is. Plain text and images keep working as before.
-- attachment:  details for voice notes, files, videos and locations, e.g.
--              {"path": "...", "name": "cv.pdf", "size": 48213, "mime": "application/pdf"}
--              {"path": "...", "mime": "audio/webm", "duration_ms": 8400}
--              {"lat": 30.04, "lng": 31.23}
-- content:     the text, a caption, or the sticker id.
alter table public.messages
  add column kind text not null default 'text'
    check (kind in ('text', 'image', 'video', 'voice', 'file', 'location', 'sticker')),
  add column attachment jsonb
    check (attachment is null or jsonb_typeof(attachment) = 'object');

-- Old rule: "text or image". New rule: text, image, or an attachment.
alter table public.messages drop constraint if exists messages_check;
alter table public.messages
  add constraint messages_has_something
    check (content is not null or image_path is not null or attachment is not null);

-- Existing image messages get the right kind.
update public.messages set kind = 'image' where image_path is not null and kind = 'text';

create index messages_conversation_kind_idx on public.messages (conversation_id, kind, created_at desc);


-- ---------------------------------------------------------------------
-- 2. Private bucket for voice notes, files and videos
-- ---------------------------------------------------------------------
-- Same rule as chat images: files live at "<conversation_id>/<file>", and only
-- members of that conversation can upload or open them. 50 MB per file.
insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-files', 'chat-files', false, 52428800)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

create policy "Members can upload chat files"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-files' and public.is_member_of_path(name));

create policy "Members can open chat files"
  on storage.objects for select to authenticated
  using (bucket_id = 'chat-files' and public.is_member_of_path(name));


-- ---------------------------------------------------------------------
-- 3. Group photo and per-person chat wallpaper
-- ---------------------------------------------------------------------
alter table public.conversations
  add column avatar_url text;

alter table public.conversation_participants
  add column wallpaper text check (wallpaper is null or char_length(wallpaper) <= 32);

-- Group photos live in the public avatars bucket at "groups/<conversation_id>/<file>".
create function public.is_group_admin(conv_id uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.conversation_participants cp
    join public.conversations c on c.id = cp.conversation_id
    where cp.conversation_id = conv_id
      and cp.user_id = (select auth.uid())
      and cp.role = 'admin'
      and c.is_group
  );
$$;

create function public.is_group_admin_of_path(object_name text)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select case
    when (storage.foldername(object_name))[1] = 'groups'
     and (storage.foldername(object_name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.is_group_admin(((storage.foldername(object_name))[2])::uuid)
    else false
  end;
$$;

create policy "Group admins can upload the group photo"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and public.is_group_admin_of_path(name));

create policy "Group admins can see group photo files"
  on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and public.is_group_admin_of_path(name));

create policy "Group admins can delete the group photo"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and public.is_group_admin_of_path(name));


-- ---------------------------------------------------------------------
-- 4. Group management (admins only)
-- ---------------------------------------------------------------------
create function public.update_group(conv_id uuid, new_name text, new_avatar_url text)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.is_group_admin(conv_id) then
    raise exception 'Only group admins can change the group' using errcode = '42501';
  end if;
  if nullif(trim(new_name), '') is null then
    raise exception 'Give the group a name' using errcode = '22023';
  end if;

  update public.conversations
     set name = left(trim(new_name), 60),
         avatar_url = new_avatar_url
   where id = conv_id;
end;
$$;

create function public.add_group_members(conv_id uuid, member_ids uuid[])
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.is_group_admin(conv_id) then
    raise exception 'Only group admins can add people' using errcode = '42501';
  end if;
  if (select count(*) from public.conversation_participants where conversation_id = conv_id)
     + (select count(distinct m) from unnest(member_ids) m) > 50 then
    raise exception 'Groups can have up to 50 people' using errcode = '22023';
  end if;

  insert into public.conversation_participants (conversation_id, user_id)
  select conv_id, p.id
  from public.profiles p
  where p.id = any (member_ids)
  on conflict do nothing;
end;
$$;

create function public.remove_group_member(conv_id uuid, member_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.is_group_admin(conv_id) then
    raise exception 'Only group admins can remove people' using errcode = '42501';
  end if;
  if member_id = auth.uid() then
    raise exception 'Use "Leave group" to leave' using errcode = '22023';
  end if;

  delete from public.conversation_participants
   where conversation_id = conv_id and user_id = member_id;
end;
$$;

create function public.set_member_role(conv_id uuid, member_id uuid, new_role text)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.is_group_admin(conv_id) then
    raise exception 'Only group admins can change roles' using errcode = '42501';
  end if;
  if new_role not in ('member', 'admin') then
    raise exception 'Unknown role' using errcode = '22023';
  end if;

  update public.conversation_participants
     set role = new_role
   where conversation_id = conv_id and user_id = member_id;
end;
$$;

create function public.set_conversation_wallpaper(conv_id uuid, new_wallpaper text)
returns void
language sql
security definer set search_path = ''
as $$
  update public.conversation_participants
     set wallpaper = nullif(new_wallpaper, 'default')
   where conversation_id = conv_id and user_id = (select auth.uid());
$$;


-- ---------------------------------------------------------------------
-- 5. The sidebar list, now with group photos, wallpapers and message kinds
-- ---------------------------------------------------------------------
drop function public.get_my_conversations();

create function public.get_my_conversations()
returns table (
  id              uuid,
  is_group        boolean,
  name            text,
  created_at      timestamptz,
  last_message_at timestamptz,
  muted           boolean,
  last_read_at    timestamptz,
  unread_count    integer,
  members         jsonb,
  last_message    jsonb,
  pinned_at       timestamptz,
  marked_unread   boolean,
  cleared_at      timestamptz,
  avatar_url      text,
  wallpaper       text,
  my_role         text
)
language sql
stable
security invoker set search_path = ''
as $$
  select
    c.id,
    c.is_group,
    c.name,
    c.created_at,
    c.last_message_at,
    me.muted,
    me.last_read_at,
    (
      select count(*)::integer
      from public.messages m
      where m.conversation_id = c.id
        and m.created_at > me.last_read_at
        and m.sender_id <> me.user_id
    ),
    (
      select jsonb_agg(
               jsonb_build_object(
                 'id', p.id,
                 'username', p.username,
                 'full_name', p.full_name,
                 'avatar_url', p.avatar_url,
                 'last_seen_at', p.last_seen_at,
                 'last_read_at', cp.last_read_at,
                 'role', cp.role
               )
               order by p.full_name
             )
      from public.conversation_participants cp
      join public.profiles p on p.id = cp.user_id
      where cp.conversation_id = c.id
    ),
    (
      select to_jsonb(lm)
      from (
        select m.id, m.sender_id, m.content, m.image_path, m.created_at, m.kind, m.attachment
        from public.messages m
        where m.conversation_id = c.id
          and (me.cleared_at is null or m.created_at > me.cleared_at)
        order by m.created_at desc
        limit 1
      ) lm
    ),
    me.pinned_at,
    me.marked_unread,
    me.cleared_at,
    c.avatar_url,
    me.wallpaper,
    me.role
  from public.conversation_participants me
  join public.conversations c on c.id = me.conversation_id
  where me.user_id = (select auth.uid())
    and (me.cleared_at is null or c.last_message_at > me.cleared_at)
  order by me.pinned_at desc nulls last, coalesce(c.last_message_at, c.created_at) desc;
$$;


-- ---------------------------------------------------------------------
-- 6. Permissions and Realtime
-- ---------------------------------------------------------------------
revoke execute on function public.is_group_admin(uuid)                      from public, anon;
revoke execute on function public.is_group_admin_of_path(text)              from public, anon;
revoke execute on function public.update_group(uuid, text, text)            from public, anon;
revoke execute on function public.add_group_members(uuid, uuid[])           from public, anon;
revoke execute on function public.remove_group_member(uuid, uuid)           from public, anon;
revoke execute on function public.set_member_role(uuid, uuid, text)         from public, anon;
revoke execute on function public.set_conversation_wallpaper(uuid, text)    from public, anon;
revoke execute on function public.get_my_conversations()                    from public, anon;
grant  execute on function public.is_group_admin(uuid)                      to authenticated;
grant  execute on function public.is_group_admin_of_path(text)              to authenticated;
grant  execute on function public.update_group(uuid, text, text)            to authenticated;
grant  execute on function public.add_group_members(uuid, uuid[])           to authenticated;
grant  execute on function public.remove_group_member(uuid, uuid)           to authenticated;
grant  execute on function public.set_member_role(uuid, uuid, text)         to authenticated;
grant  execute on function public.set_conversation_wallpaper(uuid, text)    to authenticated;
grant  execute on function public.get_my_conversations()                    to authenticated;

-- A renamed group or a new group photo shows up live for its members.
alter publication supabase_realtime add table public.conversations;
