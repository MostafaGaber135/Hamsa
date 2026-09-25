-- =====================================================================
-- Hamsa: live updates through one private channel per person
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (Run it AFTER the eleven earlier migrations. Don't run those again.)
-- =====================================================================

-- Before: every browser listened to Postgres Changes on whole tables, so the
-- server checked every new row against every connected user's permissions,
-- and any change to a conversation (including each new message bumping
-- last_message_at) made every member reload their whole chat list.
--
-- Now: triggers send each change only to the people it concerns, on their own
-- private channel "user:<id>" (Supabase Realtime "Broadcast from Database").
-- Events:
--   message        a new message (the row)                 → every member
--   read           {conversation_id, user_id, last_read_at} → the other members
--   conversations  {} "reload your chat list"               → affected members
--   friends        {} "reload your friends"                 → both people


-- ---------------------------------------------------------------------
-- 1. Sending
-- ---------------------------------------------------------------------
create function public.send_to_user(uid uuid, event text, payload jsonb)
returns void
language sql
security definer set search_path = ''
as $$
  select realtime.send(payload, event, 'user:' || uid::text, true);
$$;

create function public.send_to_members(conv_id uuid, event text, payload jsonb, skip uuid default null)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  member uuid;
begin
  for member in
    select user_id from public.conversation_participants
     where conversation_id = conv_id and user_id is distinct from skip
  loop
    perform public.send_to_user(member, event, payload);
  end loop;
end;
$$;


-- ---------------------------------------------------------------------
-- 2. What triggers an update
-- ---------------------------------------------------------------------
create function public.broadcast_message()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  perform public.send_to_members(new.conversation_id, 'message', to_jsonb(new));
  return null;
end;
$$;

create trigger messages_broadcast
  after insert on public.messages
  for each row execute function public.broadcast_message();

create function public.broadcast_participant()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- Someone read the chat: the others' ticks turn to "read".
    if new.last_read_at is distinct from old.last_read_at then
      perform public.send_to_members(
        new.conversation_id, 'read',
        jsonb_build_object('conversation_id', new.conversation_id, 'user_id', new.user_id, 'last_read_at', new.last_read_at),
        new.user_id
      );
    end if;
    -- Promoted or demoted: everyone's member list changes.
    if new.role is distinct from old.role then
      perform public.send_to_members(new.conversation_id, 'conversations', '{}');
    end if;
  elsif tg_op = 'INSERT' then
    -- A new chat, or someone joined a group (they get it too).
    perform public.send_to_members(new.conversation_id, 'conversations', '{}');
  else
    -- Someone left or was removed: the others, and the person who's gone.
    perform public.send_to_members(old.conversation_id, 'conversations', '{}');
    perform public.send_to_user(old.user_id, 'conversations', '{}');
  end if;
  return null;
end;
$$;

create trigger conversation_participants_broadcast
  after insert or update or delete on public.conversation_participants
  for each row execute function public.broadcast_participant();

-- Only a new name or photo matters: last_message_at changes with every
-- message, and the message event already covers that.
create function public.broadcast_conversation()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if new.name is distinct from old.name or new.avatar_url is distinct from old.avatar_url then
    perform public.send_to_members(new.id, 'conversations', '{}');
  end if;
  return null;
end;
$$;

create trigger conversations_broadcast
  after update on public.conversations
  for each row execute function public.broadcast_conversation();

create function public.broadcast_friendship()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  pair public.friendships;
begin
  pair := case when tg_op = 'DELETE' then old else new end;
  perform public.send_to_user(pair.requester_id, 'friends', '{}');
  perform public.send_to_user(pair.addressee_id, 'friends', '{}');
  return null;
end;
$$;

create trigger friendships_broadcast
  after insert or update or delete on public.friendships
  for each row execute function public.broadcast_friendship();


-- ---------------------------------------------------------------------
-- 3. Who can listen
-- ---------------------------------------------------------------------
-- Your own channel only. Nobody can send on it from the app: only the triggers above.
create policy "People receive their own live updates"
  on realtime.messages for select to authenticated
  using (extension = 'broadcast' and realtime.topic() = 'user:' || (select auth.uid())::text);


-- ---------------------------------------------------------------------
-- 4. Postgres Changes are no longer used
-- ---------------------------------------------------------------------
alter publication supabase_realtime
  drop table public.messages, public.conversation_participants, public.conversations, public.friendships;


-- ---------------------------------------------------------------------
-- 5. Permissions
-- ---------------------------------------------------------------------
revoke execute on function public.send_to_user(uuid, text, jsonb)               from public, anon, authenticated;
revoke execute on function public.send_to_members(uuid, text, jsonb, uuid)      from public, anon, authenticated;
revoke execute on function public.broadcast_message()                          from public, anon, authenticated;
revoke execute on function public.broadcast_participant()                      from public, anon, authenticated;
revoke execute on function public.broadcast_conversation()                     from public, anon, authenticated;
revoke execute on function public.broadcast_friendship()                       from public, anon, authenticated;
