-- =====================================================================
-- Hamsa: online status privacy, message requests, rate limit,
-- storage clean-up and account deletion
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (Run it AFTER the ten earlier migrations. Don't run those again.)
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Online status and "last seen" only for the people you chat with
-- ---------------------------------------------------------------------
-- Before: one "online-users" channel that every signed-in user could watch,
-- and last_seen_at readable by anyone. Now presence travels on each
-- conversation's private channel, so only its members see it, and "last seen"
-- is only handed out through visible_last_seen().

alter table public.profiles
  add column presence_visibility text not null default 'contacts'
    check (presence_visibility in ('contacts', 'nobody'));

grant update (presence_visibility) on public.profiles to authenticated;

-- Column privileges: last_seen_at is no longer directly readable.
-- (A new profile column must be added to this list to be readable.)
revoke select on public.profiles from anon, authenticated;
grant  select (id, username, full_name, avatar_url, created_at, group_invites, presence_visibility)
  on public.profiles to authenticated;

-- Conversation channels ("typing:<id>") now carry presence as well as typing.
-- Members only, and not in a one-to-one chat where either person blocked the other.
create or replace function public.is_member_of_topic(topic text)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select case
    when topic ~ '^typing:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.is_member(substr(topic, 8)::uuid) and public.can_send_to(substr(topic, 8)::uuid)
    else false
  end;
$$;

drop policy "Signed-in users can see who is online" on realtime.messages;
drop policy "Signed-in users can appear online"     on realtime.messages;
drop policy "Members can see who is typing"         on realtime.messages;
drop policy "Members can say they are typing"       on realtime.messages;

create policy "Members can see who is typing or online"
  on realtime.messages for select to authenticated
  using (extension in ('broadcast', 'presence') and public.is_member_of_topic(realtime.topic()));

create policy "Members can say they are typing or online"
  on realtime.messages for insert to authenticated
  with check (extension in ('broadcast', 'presence') and public.is_member_of_topic(realtime.topic()));


-- ---------------------------------------------------------------------
-- 2. Message requests
-- ---------------------------------------------------------------------
-- A one-to-one chat someone else started is a "request" for you until you
-- accept it or reply, unless you're friends. Requests don't notify you,
-- and reading one doesn't send a read receipt.
alter table public.conversation_participants
  add column accepted boolean not null default false;

-- Chats that already exist stay where they are.
update public.conversation_participants set accepted = true;

create function public.is_message_request(conv_id uuid, uid uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1
      from public.conversations c
      join public.conversation_participants me
        on me.conversation_id = c.id and me.user_id = uid
      join public.conversation_participants other
        on other.conversation_id = c.id and other.user_id <> uid
     where c.id = conv_id
       and not c.is_group
       and not me.accepted
       and c.created_by is distinct from uid
       and not exists (
         select 1 from public.friendships f
          where f.status = 'accepted'
            and least(f.requester_id, f.addressee_id) = least(uid, other.user_id)
            and greatest(f.requester_id, f.addressee_id) = greatest(uid, other.user_id)
       )
  );
$$;

-- The same question, only ever about yourself (safe to call from the app).
create function public.is_request_for_me(conv_id uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select public.is_message_request(conv_id, (select auth.uid()));
$$;

-- Someone's "last seen", if you may see it: yourself always; otherwise only
-- someone you share a conversation with, who hasn't hidden it or blocked you.
-- A message request they haven't accepted doesn't count: messaging a stranger
-- mustn't reveal when they were last online.
create function public.visible_last_seen(target uuid)
returns timestamptz
language sql
stable
security definer set search_path = ''
as $$
  select p.last_seen_at
    from public.profiles p
   where p.id = target
     and (
       target = (select auth.uid())
       or (
         p.presence_visibility = 'contacts'
         and not public.is_blocked_between((select auth.uid()), target)
         and exists (
           select 1
             from public.conversation_participants mine
             join public.conversation_participants theirs
               on theirs.conversation_id = mine.conversation_id and theirs.user_id = target
            where mine.user_id = (select auth.uid())
              and not public.is_message_request(mine.conversation_id, target)
         )
       )
     );
$$;

create function public.accept_message_request(conv_id uuid)
returns void
language sql
security definer set search_path = ''
as $$
  update public.conversation_participants
     set accepted = true
   where conversation_id = conv_id and user_id = (select auth.uid());
$$;

-- Replying accepts the request.
create or replace function public.after_message_insert()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  update public.conversations
     set last_message_at = new.created_at
   where id = new.conversation_id;

  update public.conversation_participants
     set last_read_at = new.created_at, accepted = true
   where conversation_id = new.conversation_id
     and user_id = new.sender_id;

  return new;
end;
$$;

-- Who gets a push notification for a new message: the other members, minus
-- anyone who muted the chat or hasn't accepted it yet. Only the send-push
-- Edge Function (service role) calls this.
create function public.push_recipients(conv_id uuid, sender uuid)
returns setof uuid
language sql
stable
security definer set search_path = ''
as $$
  select cp.user_id
    from public.conversation_participants cp
   where cp.conversation_id = conv_id
     and cp.user_id <> sender
     and not cp.muted
     and not public.is_message_request(conv_id, cp.user_id);
$$;

-- The sidebar list: adds is_request, and "last seen" only where you may see it.
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
  is_request      boolean
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
    me.role,
    public.is_request_for_me(c.id)
  from public.conversation_participants me
  join public.conversations c on c.id = me.conversation_id
  where me.user_id = (select auth.uid())
    and (me.cleared_at is null or c.last_message_at > me.cleared_at)
  order by me.pinned_at desc nulls last, coalesce(c.last_message_at, c.created_at) desc;
$$;


-- ---------------------------------------------------------------------
-- 3. Rate limit: at most 15 messages per person every 10 seconds
-- ---------------------------------------------------------------------
create index messages_sender_created_idx on public.messages (sender_id, created_at desc);

create function public.limit_message_rate()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if (
    select count(*) from public.messages
     where sender_id = new.sender_id
       and created_at > now() - interval '10 seconds'
  ) >= 15 then
    raise exception 'You''re sending messages too fast. Wait a moment and try again.' using errcode = '54000';
  end if;
  return new;
end;
$$;

create trigger messages_limit_rate
  before insert on public.messages
  for each row execute function public.limit_message_rate();


-- ---------------------------------------------------------------------
-- 4. Files nobody uses any more
-- ---------------------------------------------------------------------
-- Chat files whose message never got saved (or whose conversation is gone),
-- and replaced profile or group photos. Only files older than an hour, so an
-- upload that's about to be sent is never touched. Files must be removed
-- through the Storage API, so the cleanup-storage Edge Function asks for
-- this list and deletes them.
create index messages_image_path_idx on public.messages (image_path) where image_path is not null;
create index messages_attachment_path_idx on public.messages ((attachment ->> 'path')) where attachment ? 'path';

create function public.orphaned_files(max_rows integer default 500)
returns table (bucket_id text, name text)
language sql
stable
security definer set search_path = ''
as $$
  select o.bucket_id, o.name
    from storage.objects o
   where o.created_at < now() - interval '1 hour'
     and (
       (o.bucket_id = 'chat-images'
         and not exists (select 1 from public.messages m where m.image_path = o.name))
       or (o.bucket_id = 'chat-files'
         and not exists (select 1 from public.messages m where m.attachment ->> 'path' = o.name))
       or (o.bucket_id = 'avatars'
         and not exists (select 1 from public.profiles p where p.avatar_url like '%/avatars/' || o.name)
         and not exists (select 1 from public.conversations c where c.avatar_url like '%/avatars/' || o.name))
     )
   limit max_rows;
$$;


-- ---------------------------------------------------------------------
-- 5. Deleting an account
-- ---------------------------------------------------------------------
-- The delete-account Edge Function deletes the auth user; the profile goes
-- with it and takes messages, friendships, blocks and devices along (foreign
-- keys). This trigger tidies the conversations first: one-to-one chats are
-- deleted, and a group that loses its last admin gets a new one.
create function public.before_profile_delete()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  conv uuid;
begin
  delete from public.conversations c
   using public.conversation_participants cp
   where cp.conversation_id = c.id and cp.user_id = old.id and not c.is_group;

  for conv in
    select cp.conversation_id from public.conversation_participants cp where cp.user_id = old.id
  loop
    delete from public.conversation_participants where conversation_id = conv and user_id = old.id;

    if not exists (select 1 from public.conversation_participants where conversation_id = conv) then
      delete from public.conversations where id = conv;
    elsif not exists (
      select 1 from public.conversation_participants where conversation_id = conv and role = 'admin'
    ) then
      update public.conversation_participants
         set role = 'admin'
       where conversation_id = conv
         and user_id = (
           select user_id from public.conversation_participants
            where conversation_id = conv
            order by joined_at
            limit 1
         );
    end if;
  end loop;

  return old;
end;
$$;

create trigger profiles_before_delete
  before delete on public.profiles
  for each row execute function public.before_profile_delete();


-- ---------------------------------------------------------------------
-- 6. Permissions
-- ---------------------------------------------------------------------
-- Would reveal things about other people: server-side only.
revoke execute on function public.is_message_request(uuid, uuid)  from public, anon, authenticated;
revoke execute on function public.push_recipients(uuid, uuid)     from public, anon, authenticated;
revoke execute on function public.orphaned_files(integer)         from public, anon, authenticated;
revoke execute on function public.limit_message_rate()            from public, anon, authenticated;
revoke execute on function public.before_profile_delete()         from public, anon, authenticated;
grant  execute on function public.push_recipients(uuid, uuid)     to service_role;
grant  execute on function public.orphaned_files(integer)         to service_role;

-- Only ever answer about the caller, or about people the caller may see.
revoke execute on function public.visible_last_seen(uuid)         from public, anon;
revoke execute on function public.is_request_for_me(uuid)         from public, anon;
revoke execute on function public.accept_message_request(uuid)    from public, anon;
revoke execute on function public.get_my_conversations()          from public, anon;
grant  execute on function public.visible_last_seen(uuid)         to authenticated;
grant  execute on function public.is_request_for_me(uuid)         to authenticated;
grant  execute on function public.accept_message_request(uuid)    to authenticated;
grant  execute on function public.get_my_conversations()          to authenticated;
