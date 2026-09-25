-- =====================================================================
-- Hamsa: replies, reactions, edit and delete for everyone, mentions,
-- search, pinned and saved messages, reports, link previews,
-- group descriptions and invite links
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (Run it AFTER the twelve earlier migrations. Don't run those again.)
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. New message fields
-- ---------------------------------------------------------------------
alter table public.messages
  add column reply_to_id uuid references public.messages (id) on delete set null,
  add column edited_at   timestamptz,
  add column deleted_at  timestamptz,
  -- Group members named with @username, worked out by the server (not the sender).
  add column mentions    uuid[] not null default '{}',
  add column pinned_at   timestamptz,
  add column pinned_by   uuid references public.profiles (id) on delete set null;

-- A message deleted for everyone keeps its place in the chat, but nothing else.
alter table public.messages drop constraint messages_has_something;
alter table public.messages
  add constraint messages_has_something
    check (deleted_at is not null or content is not null or image_path is not null or attachment is not null);

create index messages_pinned_idx on public.messages (conversation_id, pinned_at desc) where pinned_at is not null;

-- Everything the server decides about a new message, whatever the app sent.
create function public.prepare_message()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  new.edited_at := null;
  new.deleted_at := null;
  new.pinned_at := null;
  new.pinned_by := null;

  -- A reply must quote a message from the same chat.
  if new.reply_to_id is not null and not exists (
    select 1 from public.messages where id = new.reply_to_id and conversation_id = new.conversation_id
  ) then
    raise exception 'You can only reply to a message in this chat' using errcode = '22023';
  end if;

  -- @username of a member of this group (never yourself).
  select coalesce(array_agg(p.id), '{}') into new.mentions
    from public.conversation_participants cp
    join public.conversations c on c.id = cp.conversation_id and c.is_group
    join public.profiles p on p.id = cp.user_id
   where cp.conversation_id = new.conversation_id
     and p.id <> new.sender_id
     and new.content is not null
     and new.content ~ ('(^|[^a-z0-9_])@' || p.username || '([^a-z0-9_]|$)');

  return new;
end;
$$;

create trigger messages_prepare
  before insert on public.messages
  for each row execute function public.prepare_message();


-- ---------------------------------------------------------------------
-- 2. Edit and delete for everyone
-- ---------------------------------------------------------------------
-- Your own text messages, within 15 minutes.
create function public.edit_message(msg_id uuid, new_content text)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if nullif(trim(new_content), '') is null or char_length(new_content) > 4000 then
    raise exception 'A message has 1 to 4000 characters' using errcode = '22023';
  end if;

  update public.messages
     set content = new_content, edited_at = now()
   where id = msg_id
     and sender_id = (select auth.uid())
     and kind = 'text'
     and deleted_at is null
     and created_at > now() - interval '15 minutes';

  if not found then
    raise exception 'You can only edit your own text messages, for 15 minutes' using errcode = '42501';
  end if;
end;
$$;

-- Your own messages, within a day. The file itself is removed later by the storage clean-up.
create function public.delete_message(msg_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  update public.messages
     set deleted_at = now(), kind = 'text', content = null, attachment = null, image_path = null,
         mentions = '{}', pinned_at = null, pinned_by = null
   where id = msg_id
     and sender_id = (select auth.uid())
     and deleted_at is null
     and created_at > now() - interval '1 day';

  if not found then
    raise exception 'You can only delete your own messages, for a day' using errcode = '42501';
  end if;

  delete from public.message_reactions where message_id = msg_id;
  delete from public.saved_messages where message_id = msg_id;
end;
$$;


-- ---------------------------------------------------------------------
-- 3. Reactions: one per person per message
-- ---------------------------------------------------------------------
create table public.message_reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  emoji      text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.message_reactions enable row level security;

-- Visible to the chat's members. Changes go through react().
create policy "Members can see reactions"
  on public.message_reactions for select to authenticated
  using (exists (
    select 1 from public.messages m
     where m.id = message_id and public.is_member(m.conversation_id)
  ));

-- emoji null: remove your reaction.
create function public.react(msg_id uuid, emoji text)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  me   uuid := auth.uid();
  conv uuid;
begin
  select conversation_id into conv from public.messages where id = msg_id and deleted_at is null;
  if conv is null or not public.is_member(conv) or not public.can_send_to(conv) then
    raise exception 'You can''t react to this message' using errcode = '42501';
  end if;

  if emoji is null then
    delete from public.message_reactions where message_id = msg_id and user_id = me;
  else
    insert into public.message_reactions (message_id, user_id, emoji) values (msg_id, me, emoji)
    on conflict (message_id, user_id) do update set emoji = excluded.emoji, created_at = now();
  end if;

  perform public.send_to_members(conv, 'reaction',
    jsonb_build_object('message_id', msg_id, 'conversation_id', conv, 'user_id', me, 'emoji', emoji));
end;
$$;


-- ---------------------------------------------------------------------
-- 4. Pinned messages (for everyone in the chat) and saved messages (just for you)
-- ---------------------------------------------------------------------
-- In a group only admins pin. Up to 3 per chat.
create function public.pin_message(msg_id uuid, pinned boolean)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  conv     uuid;
  is_group boolean;
begin
  select m.conversation_id, c.is_group into conv, is_group
    from public.messages m join public.conversations c on c.id = m.conversation_id
   where m.id = msg_id and m.deleted_at is null;
  if conv is null or not public.is_member(conv) then
    raise exception 'Message not found' using errcode = 'P0002';
  end if;
  if is_group and not public.is_group_admin(conv) then
    raise exception 'Only group admins can pin messages' using errcode = '42501';
  end if;
  if pinned and (
    select count(*) from public.messages where conversation_id = conv and pinned_at is not null and id <> msg_id
  ) >= 3 then
    raise exception 'You can pin up to 3 messages. Unpin one first.' using errcode = '22023';
  end if;

  update public.messages
     set pinned_at = case when pinned then now() end,
         pinned_by = case when pinned then (select auth.uid()) end
   where id = msg_id;
end;
$$;

create table public.saved_messages (
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  message_id uuid not null references public.messages (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);

alter table public.saved_messages enable row level security;

create policy "People see what they saved"
  on public.saved_messages for select to authenticated
  using (user_id = (select auth.uid()));

create policy "People save messages from their chats"
  on public.saved_messages for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.messages m where m.id = message_id and public.is_member(m.conversation_id))
  );

create policy "People unsave their own"
  on public.saved_messages for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, delete on public.saved_messages to authenticated;


-- ---------------------------------------------------------------------
-- 5. Live updates for edits, deletions, pins and reactions
-- ---------------------------------------------------------------------
create function public.broadcast_message_update()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if new.content is distinct from old.content
     or new.deleted_at is distinct from old.deleted_at
     or new.pinned_at is distinct from old.pinned_at then
    perform public.send_to_members(new.conversation_id, 'message_updated', to_jsonb(new));
  end if;
  return null;
end;
$$;

create trigger messages_broadcast_update
  after update on public.messages
  for each row execute function public.broadcast_message_update();


-- ---------------------------------------------------------------------
-- 6. Mentions reach you even in a muted group
-- ---------------------------------------------------------------------
drop function public.push_recipients(uuid, uuid);

create function public.push_recipients(conv_id uuid, sender uuid, mentioned uuid[] default '{}')
returns setof uuid
language sql
stable
security definer set search_path = ''
as $$
  select cp.user_id
    from public.conversation_participants cp
   where cp.conversation_id = conv_id
     and cp.user_id <> sender
     and (not cp.muted or cp.user_id = any (mentioned))
     and not public.is_message_request(conv_id, cp.user_id);
$$;


-- ---------------------------------------------------------------------
-- 7. Search your messages (English and Arabic alike: trigram matching)
-- ---------------------------------------------------------------------
create extension if not exists pg_trgm with schema extensions;

create index messages_content_trgm_idx on public.messages
  using gin (content extensions.gin_trgm_ops) where deleted_at is null;

-- security invoker: RLS decides which chats are searched.
create function public.search_messages(query text, conv_id uuid default null)
returns table (id uuid, conversation_id uuid, sender_id uuid, content text, created_at timestamptz)
language sql
stable
security invoker set search_path = ''
as $$
  select m.id, m.conversation_id, m.sender_id, m.content, m.created_at
    from public.messages m
    join public.conversation_participants me
      on me.conversation_id = m.conversation_id and me.user_id = (select auth.uid())
   where char_length(trim(query)) >= 2
     and m.deleted_at is null
     and (conv_id is null or m.conversation_id = conv_id)
     and (me.cleared_at is null or m.created_at > me.cleared_at)
     and m.content ilike '%' || replace(replace(replace(trim(query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
   order by m.created_at desc
   limit 50;
$$;


-- ---------------------------------------------------------------------
-- 8. Reporting people and messages
-- ---------------------------------------------------------------------
-- Nobody can read reports through the API: they're for whoever runs Hamsa,
-- in the Supabase dashboard. The message text is kept, in case it is deleted later.
create table public.reports (
  id               uuid primary key default gen_random_uuid(),
  reporter_id      uuid not null references public.profiles (id) on delete cascade,
  reported_user_id uuid not null references public.profiles (id) on delete cascade,
  message_id       uuid references public.messages (id) on delete set null,
  message_content  text,
  reason           text not null check (reason in ('spam', 'harassment', 'inappropriate', 'other')),
  details          text check (details is null or char_length(details) <= 500),
  created_at       timestamptz not null default now()
);

create unique index reports_once_per_message_idx on public.reports (reporter_id, message_id) where message_id is not null;

alter table public.reports enable row level security;

create function public.report(target_user uuid, msg_id uuid, reason text, details text default null)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  msg public.messages;
begin
  if me is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if target_user = me then
    raise exception 'You can''t report yourself' using errcode = '22023';
  end if;

  if msg_id is not null then
    select * into msg from public.messages where id = msg_id;
    if not found or msg.sender_id <> target_user or not public.is_member(msg.conversation_id) then
      raise exception 'Message not found' using errcode = 'P0002';
    end if;
  elsif not exists (
    select 1 from public.conversation_participants mine
      join public.conversation_participants theirs
        on theirs.conversation_id = mine.conversation_id and theirs.user_id = target_user
     where mine.user_id = me
  ) then
    raise exception 'You can only report people you chat with' using errcode = '42501';
  end if;

  insert into public.reports (reporter_id, reported_user_id, message_id, message_content, reason, details)
  values (me, target_user, msg_id, msg.content, reason, nullif(trim(details), ''))
  on conflict do nothing;
end;
$$;


-- ---------------------------------------------------------------------
-- 9. Link previews (filled in by the link-preview Edge Function)
-- ---------------------------------------------------------------------
-- Only text: title, description, site. No images, so no third-party server
-- ever learns who read a message.
create table public.link_previews (
  url         text primary key check (char_length(url) <= 2048),
  title       text,
  description text,
  site_name   text,
  fetched_at  timestamptz not null default now()
);

alter table public.link_previews enable row level security;
-- No policies: only the Edge Function (service role) reads and writes it.


-- ---------------------------------------------------------------------
-- 10. Group description and invite links
-- ---------------------------------------------------------------------
alter table public.conversations
  add column description text check (description is null or char_length(description) <= 500),
  add column invite_code text unique;

create function public.set_group_description(conv_id uuid, new_description text)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.is_group_admin(conv_id) then
    raise exception 'Only group admins can change the group' using errcode = '42501';
  end if;
  update public.conversations set description = nullif(trim(new_description), '') where id = conv_id;
end;
$$;

-- A new link (the old one stops working), or none.
create function public.set_group_invite(conv_id uuid, enabled boolean)
returns text
language plpgsql
security definer set search_path = ''
as $$
declare
  code text := case when enabled then replace(gen_random_uuid()::text, '-', '') end;
begin
  if not public.is_group_admin(conv_id) then
    raise exception 'Only group admins can share the group link' using errcode = '42501';
  end if;
  update public.conversations set invite_code = code where id = conv_id;
  return code;
end;
$$;

-- What the invite page shows before you join. Only works with the code.
create function public.get_group_invite(code text)
returns table (conversation_id uuid, name text, avatar_url text, description text, member_count integer, already_member boolean)
language sql
stable
security definer set search_path = ''
as $$
  select c.id, c.name, c.avatar_url, c.description,
         (select count(*)::integer from public.conversation_participants where conversation_id = c.id),
         public.is_member(c.id)
    from public.conversations c
   where c.is_group and c.invite_code = code and code is not null;
$$;

create function public.join_group_by_invite(code text)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  me   uuid := auth.uid();
  conv uuid;
begin
  if me is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  select id into conv from public.conversations where is_group and invite_code = code and code is not null;
  if conv is null then
    raise exception 'This invite link doesn''t work any more' using errcode = 'P0002';
  end if;
  if public.is_member(conv) then
    return conv;
  end if;
  if (select count(*) from public.conversation_participants where conversation_id = conv) >= 50 then
    raise exception 'Groups can have up to 50 people' using errcode = '22023';
  end if;

  insert into public.conversation_participants (conversation_id, user_id, accepted)
  values (conv, me, true);
  return conv;
end;
$$;

-- Renaming, a new photo or description, or a new invite link reloads members' lists.
create or replace function public.broadcast_conversation()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if new.name is distinct from old.name
     or new.avatar_url is distinct from old.avatar_url
     or new.description is distinct from old.description
     or new.invite_code is distinct from old.invite_code then
    perform public.send_to_members(new.id, 'conversations', '{}');
  end if;
  return null;
end;
$$;


-- ---------------------------------------------------------------------
-- 11. The sidebar list: description, invite link (admins), and deleted last messages
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
  my_role         text,
  is_request      boolean,
  description     text,
  invite_code     text
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
                 'last_seen_at', public.visible_last_seen(p.id),
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
        select m.id, m.sender_id, m.content, m.image_path, m.created_at, m.kind, m.attachment,
               m.deleted_at, m.edited_at, m.mentions
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
    me.role,
    public.is_request_for_me(c.id),
    c.description,
    case when me.role = 'admin' then c.invite_code end
  from public.conversation_participants me
  join public.conversations c on c.id = me.conversation_id
  where me.user_id = (select auth.uid())
    and (me.cleared_at is null or c.last_message_at > me.cleared_at)
  order by me.pinned_at desc nulls last, coalesce(c.last_message_at, c.created_at) desc;
$$;


-- ---------------------------------------------------------------------
-- 12. Permissions
-- ---------------------------------------------------------------------
revoke execute on function public.prepare_message()                         from public, anon, authenticated;
revoke execute on function public.broadcast_message_update()                from public, anon, authenticated;
revoke execute on function public.push_recipients(uuid, uuid, uuid[])       from public, anon, authenticated;
grant  execute on function public.push_recipients(uuid, uuid, uuid[])       to service_role;

revoke execute on function public.edit_message(uuid, text)                  from public, anon;
revoke execute on function public.delete_message(uuid)                      from public, anon;
revoke execute on function public.react(uuid, text)                         from public, anon;
revoke execute on function public.pin_message(uuid, boolean)                from public, anon;
revoke execute on function public.search_messages(text, uuid)               from public, anon;
revoke execute on function public.report(uuid, uuid, text, text)            from public, anon;
revoke execute on function public.set_group_description(uuid, text)         from public, anon;
revoke execute on function public.set_group_invite(uuid, boolean)           from public, anon;
revoke execute on function public.get_group_invite(text)                    from public, anon;
revoke execute on function public.join_group_by_invite(text)                from public, anon;
revoke execute on function public.get_my_conversations()                    from public, anon;
grant  execute on function public.edit_message(uuid, text)                  to authenticated;
grant  execute on function public.delete_message(uuid)                      to authenticated;
grant  execute on function public.react(uuid, text)                         to authenticated;
grant  execute on function public.pin_message(uuid, boolean)                to authenticated;
grant  execute on function public.search_messages(text, uuid)               to authenticated;
grant  execute on function public.report(uuid, uuid, text, text)            to authenticated;
grant  execute on function public.set_group_description(uuid, text)         to authenticated;
grant  execute on function public.set_group_invite(uuid, boolean)           to authenticated;
grant  execute on function public.get_group_invite(text)                    to authenticated;
grant  execute on function public.join_group_by_invite(text)                to authenticated;
grant  execute on function public.get_my_conversations()                    to authenticated;
