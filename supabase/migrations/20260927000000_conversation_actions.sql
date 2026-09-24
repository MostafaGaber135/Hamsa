-- =====================================================================
-- Hamsa: conversation actions (pin, mute, mark unread, delete chat, leave group)
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (Run it AFTER the three earlier migrations. Don't run those again.)
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Per-person settings for each conversation
-- ---------------------------------------------------------------------
-- These belong to one person: pinning or deleting a chat never affects the others in it.
alter table public.conversation_participants
  add column pinned_at     timestamptz,
  add column marked_unread boolean not null default false,
  -- "Delete chat" hides everything before this moment, for you only.
  add column cleared_at    timestamptz;


-- ---------------------------------------------------------------------
-- 2. Actions (supabase.rpc). Each one only ever touches your own row.
-- ---------------------------------------------------------------------
create function public.set_conversation_pinned(conv_id uuid, pinned boolean)
returns void
language sql
security definer set search_path = ''
as $$
  update public.conversation_participants
     set pinned_at = case when pinned then now() end
   where conversation_id = conv_id and user_id = (select auth.uid());
$$;

create function public.set_conversation_muted(conv_id uuid, is_muted boolean)
returns void
language sql
security definer set search_path = ''
as $$
  update public.conversation_participants
     set muted = is_muted
   where conversation_id = conv_id and user_id = (select auth.uid());
$$;

-- A flag, not a change to last_read_at, so other people's read receipts stay correct.
create function public.mark_conversation_unread(conv_id uuid)
returns void
language sql
security definer set search_path = ''
as $$
  update public.conversation_participants
     set marked_unread = true
   where conversation_id = conv_id and user_id = (select auth.uid());
$$;

-- Opening a conversation also clears the "marked unread" flag.
create or replace function public.mark_conversation_read(conv_id uuid)
returns void
language sql
security definer set search_path = ''
as $$
  update public.conversation_participants
     set last_read_at = now(), marked_unread = false
   where conversation_id = conv_id
     and user_id = (select auth.uid());
$$;

-- Deletes the chat for you: older messages disappear from your view and the
-- conversation leaves your list until someone sends a new message.
create function public.clear_conversation(conv_id uuid)
returns void
language sql
security definer set search_path = ''
as $$
  update public.conversation_participants
     set cleared_at = now(), last_read_at = now(), marked_unread = false, pinned_at = null
   where conversation_id = conv_id and user_id = (select auth.uid());
$$;

-- Leaves a group. If you were the last admin, the longest-standing member becomes
-- admin; if you were the last member, the group is deleted.
create function public.leave_conversation(conv_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if not exists (select 1 from public.conversations where id = conv_id and is_group) then
    raise exception 'You can only leave groups' using errcode = '22023';
  end if;

  delete from public.conversation_participants
   where conversation_id = conv_id and user_id = me;
  if not found then
    raise exception 'You are not in this group' using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.conversation_participants where conversation_id = conv_id) then
    delete from public.conversations where id = conv_id;
  elsif not exists (
    select 1 from public.conversation_participants where conversation_id = conv_id and role = 'admin'
  ) then
    update public.conversation_participants
       set role = 'admin'
     where conversation_id = conv_id
       and user_id = (
         select user_id from public.conversation_participants
          where conversation_id = conv_id
          order by joined_at
          limit 1
       );
  end if;
end;
$$;


-- ---------------------------------------------------------------------
-- 3. The sidebar list, now aware of pins, "marked unread" and deleted chats
-- ---------------------------------------------------------------------
-- The return columns change, so the old version is dropped first.
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
  cleared_at      timestamptz
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
        select m.id, m.sender_id, m.content, m.image_path, m.created_at
        from public.messages m
        where m.conversation_id = c.id
          and (me.cleared_at is null or m.created_at > me.cleared_at)
        order by m.created_at desc
        limit 1
      ) lm
    ),
    me.pinned_at,
    me.marked_unread,
    me.cleared_at
  from public.conversation_participants me
  join public.conversations c on c.id = me.conversation_id
  where me.user_id = (select auth.uid())
    -- A deleted chat comes back only when there's something new in it.
    and (me.cleared_at is null or c.last_message_at > me.cleared_at)
  order by me.pinned_at desc nulls last, coalesce(c.last_message_at, c.created_at) desc;
$$;


-- ---------------------------------------------------------------------
-- 4. Permissions
-- ---------------------------------------------------------------------
revoke execute on function public.set_conversation_pinned(uuid, boolean) from public, anon;
revoke execute on function public.set_conversation_muted(uuid, boolean)  from public, anon;
revoke execute on function public.mark_conversation_unread(uuid)         from public, anon;
revoke execute on function public.clear_conversation(uuid)               from public, anon;
revoke execute on function public.leave_conversation(uuid)               from public, anon;
revoke execute on function public.get_my_conversations()                 from public, anon;
grant  execute on function public.set_conversation_pinned(uuid, boolean) to authenticated;
grant  execute on function public.set_conversation_muted(uuid, boolean)  to authenticated;
grant  execute on function public.mark_conversation_unread(uuid)         to authenticated;
grant  execute on function public.clear_conversation(uuid)               to authenticated;
grant  execute on function public.leave_conversation(uuid)               to authenticated;
grant  execute on function public.get_my_conversations()                 to authenticated;
