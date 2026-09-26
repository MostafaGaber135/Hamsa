-- =====================================================================
-- Hamsa: notifications: friend requests, groups, reactions, mentions and
-- replies, kept for the bell in the app and sent as push notifications
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (Run it AFTER the fourteen earlier migrations. Don't run those again.)
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------
-- Rows are only ever written by the triggers below (as the owner), never by
-- the app, so nobody can make a notification appear for someone else.
create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  actor_id        uuid not null references public.profiles (id) on delete cascade,
  kind            text not null check (kind in (
                    'friend_request', 'friend_accepted', 'added_to_group', 'made_admin',
                    'reaction', 'mention', 'reply')),
  conversation_id uuid references public.conversations (id) on delete cascade,
  message_id      uuid references public.messages (id) on delete cascade,
  emoji           text check (char_length(emoji) between 1 and 16),
  created_at      timestamptz not null default now(),
  read_at         timestamptz
);

create index notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

create policy "Users can see their own notifications"
  on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));


-- ---------------------------------------------------------------------
-- 2. Notifying
-- ---------------------------------------------------------------------
-- Nobody is notified about their own actions, or by someone either of them blocked.
-- Each person keeps their newest 100.
create function public.notify(
  recipient uuid,
  actor uuid,
  what text,
  conv_id uuid default null,
  msg_id uuid default null,
  reaction text default null
)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if recipient is null or actor is null or recipient = actor then
    return;
  end if;
  if public.is_blocked_between(recipient, actor) then
    return;
  end if;

  insert into public.notifications (user_id, actor_id, kind, conversation_id, message_id, emoji)
  values (recipient, actor, what, conv_id, msg_id, reaction);

  delete from public.notifications
   where user_id = recipient
     and id not in (
       select id from public.notifications where user_id = recipient order by created_at desc limit 100
     );

  perform public.send_to_user(recipient, 'notification', '{}');
end;
$$;


-- ---------------------------------------------------------------------
-- 3. What makes a notification
-- ---------------------------------------------------------------------
-- A request sent, a request accepted. A request that's answered or cancelled
-- takes its notification with it.
create function public.notify_friendship()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform public.notify(new.addressee_id, new.requester_id, 'friend_request');
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    delete from public.notifications
     where kind = 'friend_request' and user_id = new.addressee_id and actor_id = new.requester_id;
    perform public.notify(new.requester_id, new.addressee_id, 'friend_accepted');
  elsif tg_op = 'DELETE' and old.status = 'pending' then
    delete from public.notifications
     where kind = 'friend_request' and user_id = old.addressee_id and actor_id = old.requester_id;
    perform public.send_to_user(old.addressee_id, 'notification', '{}');
  end if;
  return null;
end;
$$;

create trigger friendships_notify
  after insert or update or delete on public.friendships
  for each row execute function public.notify_friendship();

-- Put in a group by someone else (joining by invite link is your own doing),
-- or made an admin.
create function public.notify_participant()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.conversations where id = new.conversation_id and is_group) then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform public.notify(new.user_id, auth.uid(), 'added_to_group', new.conversation_id);
  elsif new.role = 'admin' and old.role <> 'admin' then
    perform public.notify(new.user_id, auth.uid(), 'made_admin', new.conversation_id);
  end if;
  return null;
end;
$$;

create trigger participants_notify
  after insert or update of role on public.conversation_participants
  for each row execute function public.notify_participant();

-- A reaction to your message. A changed reaction replaces the old notification;
-- a removed one takes it away.
create function public.notify_reaction()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  msg public.messages;
begin
  select * into msg from public.messages where id = coalesce(new.message_id, old.message_id);
  if msg.id is null then
    return null;
  end if;

  delete from public.notifications
   where kind = 'reaction'
     and user_id = msg.sender_id
     and actor_id = coalesce(new.user_id, old.user_id)
     and message_id = msg.id;

  if tg_op = 'DELETE' then
    perform public.send_to_user(msg.sender_id, 'notification', '{}');
  else
    perform public.notify(msg.sender_id, new.user_id, 'reaction', msg.conversation_id, msg.id, new.emoji);
  end if;
  return null;
end;
$$;

create trigger reactions_notify
  after insert or update or delete on public.message_reactions
  for each row execute function public.notify_reaction();

-- @mentions (worked out by the server before the insert), and replies to your message.
create function public.notify_message()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  mentioned uuid;
  replied_to uuid;
begin
  foreach mentioned in array new.mentions loop
    perform public.notify(mentioned, new.sender_id, 'mention', new.conversation_id, new.id);
  end loop;

  if new.reply_to_id is not null then
    select sender_id into replied_to from public.messages where id = new.reply_to_id;
    if not replied_to = any (new.mentions) then
      perform public.notify(replied_to, new.sender_id, 'reply', new.conversation_id, new.id);
    end if;
  end if;
  return null;
end;
$$;

create trigger messages_notify
  after insert on public.messages
  for each row execute function public.notify_message();


-- ---------------------------------------------------------------------
-- 4. Reading them
-- ---------------------------------------------------------------------
-- Everything the bell shows in one call: who did it, where, and a preview of the message.
create function public.get_my_notifications()
returns table (
  id              uuid,
  kind            text,
  created_at      timestamptz,
  read_at         timestamptz,
  actor_id        uuid,
  actor_name      text,
  actor_username  text,
  actor_avatar    text,
  conversation_id uuid,
  group_name      text,
  message_id      uuid,
  message_kind    text,
  message_text    text,
  message_deleted boolean,
  emoji           text
)
language sql
stable
security definer set search_path = ''
as $$
  select n.id, n.kind, n.created_at, n.read_at,
         a.id, a.full_name, a.username, a.avatar_url,
         n.conversation_id, case when c.is_group then c.name end,
         n.message_id, m.kind, case when m.deleted_at is null then m.content end, m.deleted_at is not null,
         n.emoji
    from public.notifications n
    join public.profiles a on a.id = n.actor_id
    left join public.conversations c on c.id = n.conversation_id
    left join public.messages m on m.id = n.message_id
   where n.user_id = (select auth.uid())
   order by n.created_at desc;
$$;

-- Opening the bell marks everything read (on your other devices too).
create function public.mark_notifications_read()
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  update public.notifications set read_at = now()
   where user_id = (select auth.uid()) and read_at is null;
  perform public.send_to_user((select auth.uid()), 'notification', '{}');
end;
$$;


-- ---------------------------------------------------------------------
-- 5. Permissions
-- ---------------------------------------------------------------------
revoke all on public.notifications from anon, authenticated;
grant  select on public.notifications to authenticated;

-- Internal: only the triggers above (which run as the owner) notify.
revoke execute on function public.notify(uuid, uuid, text, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.notify_friendship()        from public, anon, authenticated;
revoke execute on function public.notify_participant()       from public, anon, authenticated;
revoke execute on function public.notify_reaction()          from public, anon, authenticated;
revoke execute on function public.notify_message()           from public, anon, authenticated;
revoke execute on function public.get_my_notifications()     from public, anon;
revoke execute on function public.mark_notifications_read()  from public, anon;
grant  execute on function public.get_my_notifications()     to authenticated;
grant  execute on function public.mark_notifications_read()  to authenticated;
