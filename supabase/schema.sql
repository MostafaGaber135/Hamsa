-- =====================================================================
-- Hamsa: complete database schema (all migrations in one file)
--
-- FOR A NEW, EMPTY SUPABASE PROJECT ONLY.
-- If you already ran the separate migration files, don't run this: it would
-- fail with "already exists". It creates exactly the same result.
--
-- Contents
--   1–11  Profiles, conversations, messages, RLS, chat functions,
--         Realtime and chat image storage
--   12    Profile photos from Google
--   13–14 Friendships and friend functions
--   15–16 Profile editing: editable columns and the avatars bucket
--   17–20 Conversation actions: pin, mute, mark unread, delete chat, leave group
--   21–22 Realtime: "last seen", and who may join the online / typing channels
--   23–28 Voice notes, files, video, location and stickers; group photo, admins
--         and members; per-person chat wallpaper
--   29    Push notification subscriptions
--   30    Attachment validation
--   31    Hardening: photo URLs, chat image limits, last group admin
--   32    Blocking people, and who can add you to groups
--   33    Online status privacy, message requests, rate limit, storage clean-up,
--         account deletion
--   34    Live updates through one private channel per person
--   35    Replies, reactions, edit/delete for everyone, mentions, search, pins,
--         saved messages, reports, link previews, group description and invites
--
-- Run once: SQL Editor → New query → paste → Run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Profiles: one row per user, created automatically on sign-up
-- ---------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  full_name    text not null check (char_length(full_name) between 1 and 60),
  avatar_url   text,
  last_seen_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

-- Works for email sign-up (full_name comes from signUp options.data)
-- and Google (which sends full_name / name and a photo in avatar_url or picture).
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  base text;
  display_name text;
begin
  base := left(regexp_replace(lower(split_part(coalesce(new.email, ''), '@', 1)), '[^a-z0-9_]', '', 'g'), 16);
  if char_length(base) < 3 then
    base := 'user';
  end if;

  display_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    base
  );

  insert into public.profiles (id, username, full_name, avatar_url)
  values (
    new.id,
    base || '_' || substr(replace(new.id::text, '-', ''), 1, 6),
    left(display_name, 60),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------------------------------------------------------------------
-- 2. Conversations
-- ---------------------------------------------------------------------
create table public.conversations (
  id              uuid primary key default gen_random_uuid(),
  is_group        boolean not null default false,
  name            text check (name is null or char_length(name) between 1 and 60),
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz,
  -- 1:1 chats store both user ids, sorted ("a:b"). The unique constraint means
  -- the same two people can never end up with two separate conversations.
  direct_key      text unique,
  check (is_group = (direct_key is null)),
  check (not is_group or name is not null)
);


-- ---------------------------------------------------------------------
-- 3. Participants: who is in which conversation
-- ---------------------------------------------------------------------
create table public.conversation_participants (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  role            text not null default 'member' check (role in ('member', 'admin')),
  muted           boolean not null default false,
  -- One timestamp per person per conversation drives both unread counts and
  -- read receipts, instead of a "read" flag on every single message.
  last_read_at    timestamptz not null default now(),
  joined_at       timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index conversation_participants_user_idx on public.conversation_participants (user_id);


-- ---------------------------------------------------------------------
-- 4. Messages
-- ---------------------------------------------------------------------
create table public.messages (
  -- The client generates the id (crypto.randomUUID) so the optimistic message
  -- and the Realtime echo of the same insert can be matched and de-duplicated.
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  content         text check (content is null or char_length(content) between 1 and 4000),
  image_path      text,
  created_at      timestamptz not null default now(),
  check (content is not null or image_path is not null)
);

-- Serves "latest 30 messages of this conversation" and the pages before it.
create index messages_conversation_created_idx on public.messages (conversation_id, created_at desc);


-- ---------------------------------------------------------------------
-- 5. Membership check used by every policy
-- ---------------------------------------------------------------------
-- security definer: it reads conversation_participants without going through that
-- table's own policy, which would otherwise call is_member again (infinite recursion).
create function public.is_member(conv_id uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.conversation_participants
    where conversation_id = conv_id
      and user_id = (select auth.uid())
  );
$$;


-- ---------------------------------------------------------------------
-- 6. Message triggers
-- ---------------------------------------------------------------------
-- The server decides the time, so nobody can back-date a message
-- and the order is the same for everyone.
create function public.set_message_created_at()
returns trigger
language plpgsql
as $$
begin
  new.created_at := now();
  return new;
end;
$$;

create trigger messages_set_created_at
  before insert on public.messages
  for each row execute function public.set_message_created_at();

-- Keeps the conversation list sortable, and marks the conversation as read
-- for the sender (you have obviously seen your own message).
create function public.after_message_insert()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  update public.conversations
     set last_message_at = new.created_at
   where id = new.conversation_id;

  update public.conversation_participants
     set last_read_at = new.created_at
   where conversation_id = new.conversation_id
     and user_id = new.sender_id;

  return new;
end;
$$;

create trigger messages_after_insert
  after insert on public.messages
  for each row execute function public.after_message_insert();


-- ---------------------------------------------------------------------
-- 7. Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles                  enable row level security;
alter table public.conversations             enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages                  enable row level security;

-- Profiles: everyone signed in can find people; you can only edit yourself.
create policy "Signed-in users can see profiles"
  on public.profiles for select to authenticated
  using (true);

create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Conversations and participants: visible only to members.
-- No insert/update policies: creating and reading go through the functions below.
create policy "Members can see their conversations"
  on public.conversations for select to authenticated
  using (public.is_member(id));

create policy "Members can see who is in their conversations"
  on public.conversation_participants for select to authenticated
  using (public.is_member(conversation_id));

-- Messages: members read; members send, and only as themselves.
create policy "Members can read messages"
  on public.messages for select to authenticated
  using (public.is_member(conversation_id));

create policy "Members can send messages as themselves"
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and public.is_member(conversation_id)
  );


-- ---------------------------------------------------------------------
-- 8. Functions the app calls (supabase.rpc)
-- ---------------------------------------------------------------------

-- Opens the 1:1 conversation with someone, creating it the first time.
create function public.get_or_create_direct_conversation(other_user_id uuid)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  me      uuid := auth.uid();
  pair    text;
  conv_id uuid;
begin
  if me is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if other_user_id = me then
    raise exception 'You can''t start a conversation with yourself' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = other_user_id) then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  pair := least(me::text, other_user_id::text) || ':' || greatest(me::text, other_user_id::text);

  select id into conv_id from public.conversations where direct_key = pair;
  if conv_id is not null then
    return conv_id;
  end if;

  insert into public.conversations (is_group, created_by, direct_key)
  values (false, me, pair)
  on conflict (direct_key) do nothing
  returning id into conv_id;

  if conv_id is null then
    -- Both people pressed "New chat" at the same moment: the other insert won.
    select id into conv_id from public.conversations where direct_key = pair;
  else
    insert into public.conversation_participants (conversation_id, user_id)
    values (conv_id, me), (conv_id, other_user_id);
  end if;

  return conv_id;
end;
$$;

-- Creates a group with you as admin.
create function public.create_group_conversation(group_name text, member_ids uuid[])
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  me      uuid := auth.uid();
  members uuid[];
  conv_id uuid;
begin
  if me is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if nullif(trim(group_name), '') is null then
    raise exception 'Give the group a name' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct m), '{}') into members
  from unnest(member_ids) as m
  where m <> me;

  if cardinality(members) = 0 then
    raise exception 'Add at least one person' using errcode = '22023';
  end if;
  if cardinality(members) > 49 then
    raise exception 'Groups can have up to 50 people' using errcode = '22023';
  end if;
  if (select count(*) from public.profiles where id = any (members)) <> cardinality(members) then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  insert into public.conversations (is_group, name, created_by)
  values (true, trim(group_name), me)
  returning id into conv_id;

  insert into public.conversation_participants (conversation_id, user_id, role)
  values (conv_id, me, 'admin');

  insert into public.conversation_participants (conversation_id, user_id)
  select conv_id, m from unnest(members) as m;

  return conv_id;
end;
$$;

-- Called when you open a conversation (and when a message arrives while it is open).
create function public.mark_conversation_read(conv_id uuid)
returns void
language sql
security definer set search_path = ''
as $$
  update public.conversation_participants
     set last_read_at = now()
   where conversation_id = conv_id
     and user_id = (select auth.uid());
$$;

-- Everything the sidebar needs in one request: members, last message, unread count.
-- security invoker: runs with the caller's permissions, so RLS still applies.
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
  last_message    jsonb
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
        order by m.created_at desc
        limit 1
      ) lm
    )
  from public.conversation_participants me
  join public.conversations c on c.id = me.conversation_id
  where me.user_id = (select auth.uid())
  order by coalesce(c.last_message_at, c.created_at) desc;
$$;


-- ---------------------------------------------------------------------
-- 9. Permissions on functions
-- ---------------------------------------------------------------------
-- Only signed-in users can call the app's functions; internal helpers aren't callable at all.
revoke execute on function public.get_or_create_direct_conversation(uuid) from public, anon;
revoke execute on function public.create_group_conversation(text, uuid[]) from public, anon;
revoke execute on function public.mark_conversation_read(uuid)            from public, anon;
revoke execute on function public.get_my_conversations()                  from public, anon;
grant  execute on function public.get_or_create_direct_conversation(uuid) to authenticated;
grant  execute on function public.create_group_conversation(text, uuid[]) to authenticated;
grant  execute on function public.mark_conversation_read(uuid)            to authenticated;
grant  execute on function public.get_my_conversations()                  to authenticated;

revoke execute on function public.handle_new_user()        from public, anon, authenticated;
revoke execute on function public.after_message_insert()   from public, anon, authenticated;
revoke execute on function public.set_message_created_at() from public, anon, authenticated;
-- is_member stays executable by authenticated: policies run as the caller.
revoke execute on function public.is_member(uuid) from public, anon;
grant  execute on function public.is_member(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 10. Realtime
-- ---------------------------------------------------------------------
-- New messages, and last_read_at changes for read receipts. Realtime applies
-- the select policies above, so people only receive rows they're allowed to see.
alter publication supabase_realtime add table public.messages, public.conversation_participants;


-- ---------------------------------------------------------------------
-- 11. Image storage
-- ---------------------------------------------------------------------
-- Private bucket. Files live at "<conversation_id>/<file>", and only members of that
-- conversation can upload or view them.
insert into storage.buckets (id, name, public)
values ('chat-images', 'chat-images', false)
on conflict (id) do nothing;

create function public.is_member_of_path(object_name text)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select case
    when (storage.foldername(object_name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.is_member(((storage.foldername(object_name))[1])::uuid)
    else false
  end;
$$;

revoke execute on function public.is_member_of_path(text) from public, anon;
grant  execute on function public.is_member_of_path(text) to authenticated;

create policy "Members can upload chat images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-images' and public.is_member_of_path(name));

create policy "Members can view chat images"
  on storage.objects for select to authenticated
  using (bucket_id = 'chat-images' and public.is_member_of_path(name));


-- ---------------------------------------------------------------------
-- 12. Profile photos from Google (email accounts that later sign in with Google)
-- ---------------------------------------------------------------------
-- Someone who signed up with email and later signs in with Google gets the
-- Google photo too, as long as they don't already have one.
create function public.sync_avatar_from_auth()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  update public.profiles
     set avatar_url = coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
   where id = new.id
     and avatar_url is null
     and coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture') is not null;
  return new;
end;
$$;

-- Google resends the same photo URL on every sign-in, so only react when the
-- Google photo actually changed. That way "Remove photo" stays removed.
create trigger on_auth_user_updated
  after update of raw_user_meta_data on auth.users
  for each row
  when (
    coalesce(old.raw_user_meta_data ->> 'avatar_url', old.raw_user_meta_data ->> 'picture')
      is distinct from
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  execute function public.sync_avatar_from_auth();

revoke execute on function public.sync_avatar_from_auth() from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 13. Friendships
-- ---------------------------------------------------------------------
-- One row per pair of people. "pending" = a request waiting for an answer;
-- "accepted" = friends. Declining or removing deletes the row, so either
-- person can send a new request later.
create table public.friendships (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> addressee_id)
);

-- A and B can only ever have one row, whoever asked first.
create unique index friendships_pair_idx
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index friendships_addressee_idx on public.friendships (addressee_id, status);

alter table public.friendships enable row level security;

-- You see only the requests and friendships you're part of.
-- No insert/update/delete policies: all changes go through the functions below.
create policy "People can see their own friendships"
  on public.friendships for select to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));


-- ---------------------------------------------------------------------
-- 14. Friend functions (supabase.rpc)
-- ---------------------------------------------------------------------

-- Sends a request. If they already sent you one, this accepts it instead.
-- Returns the resulting status: 'pending' or 'accepted'.
create function public.send_friend_request(target_id uuid)
returns text
language plpgsql
security definer set search_path = ''
as $$
declare
  me       uuid := auth.uid();
  existing public.friendships;
begin
  if me is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if target_id = me then
    raise exception 'You can''t add yourself' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = target_id) then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  select * into existing
  from public.friendships
  where least(requester_id, addressee_id) = least(me, target_id)
    and greatest(requester_id, addressee_id) = greatest(me, target_id);

  if found then
    if existing.status = 'pending' and existing.requester_id = target_id then
      update public.friendships
         set status = 'accepted', responded_at = now()
       where id = existing.id;
      return 'accepted';
    end if;
    return existing.status;
  end if;

  insert into public.friendships (requester_id, addressee_id) values (me, target_id);
  return 'pending';
exception
  when unique_violation then
    -- Both people pressed "Add" at the same moment: the other request won.
    return (
      select status from public.friendships
      where least(requester_id, addressee_id) = least(me, target_id)
        and greatest(requester_id, addressee_id) = greatest(me, target_id)
    );
end;
$$;

-- Accepts or declines a request someone sent you.
create function public.respond_friend_request(requester uuid, accept boolean)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if accept then
    update public.friendships
       set status = 'accepted', responded_at = now()
     where requester_id = requester and addressee_id = me and status = 'pending';
  else
    delete from public.friendships
     where requester_id = requester and addressee_id = me and status = 'pending';
  end if;

  if not found then
    raise exception 'No friend request from this person' using errcode = 'P0002';
  end if;
end;
$$;

-- Removes a friend, or cancels a request you sent.
create function public.remove_friendship(other_user_id uuid)
returns void
language sql
security definer set search_path = ''
as $$
  delete from public.friendships
  where least(requester_id, addressee_id) = least((select auth.uid()), other_user_id)
    and greatest(requester_id, addressee_id) = greatest((select auth.uid()), other_user_id);
$$;

-- Your friends and requests, with the other person's profile.
-- direction: 'incoming' (they asked you) or 'outgoing' (you asked them).
create function public.get_my_friendships()
returns table (
  user_id    uuid,
  username   text,
  full_name  text,
  avatar_url text,
  status     text,
  direction  text,
  created_at timestamptz
)
language sql
stable
security invoker set search_path = ''
as $$
  select
    p.id,
    p.username,
    p.full_name,
    p.avatar_url,
    f.status,
    case when f.requester_id = (select auth.uid()) then 'outgoing' else 'incoming' end,
    coalesce(f.responded_at, f.created_at)
  from public.friendships f
  join public.profiles p
    on p.id = case when f.requester_id = (select auth.uid()) then f.addressee_id else f.requester_id end
  where (select auth.uid()) in (f.requester_id, f.addressee_id)
  order by p.full_name;
$$;

revoke execute on function public.send_friend_request(uuid)             from public, anon;
revoke execute on function public.respond_friend_request(uuid, boolean) from public, anon;
revoke execute on function public.remove_friendship(uuid)               from public, anon;
revoke execute on function public.get_my_friendships()                  from public, anon;
grant  execute on function public.send_friend_request(uuid)             to authenticated;
grant  execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant  execute on function public.remove_friendship(uuid)               to authenticated;
grant  execute on function public.get_my_friendships()                  to authenticated;

-- Live friend requests.
alter publication supabase_realtime add table public.friendships;


-- ---------------------------------------------------------------------
-- 15. Only these columns can be edited from the app
-- ---------------------------------------------------------------------
-- The update policy already limits you to your own row. Column privileges
-- also stop anyone from changing their id, created_at or last_seen_at.
revoke update on public.profiles from anon, authenticated;
grant  update (full_name, username, avatar_url) on public.profiles to authenticated;


-- ---------------------------------------------------------------------
-- 16. Profile photos bucket
-- ---------------------------------------------------------------------
-- Public, so a photo URL works in an <img> tag for everyone. Files live at
-- "<user_id>/<file>", and only you can add or delete files in your folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "Users can upload their own avatar"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users can see their own avatar files"
  on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users can delete their own avatar"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);


-- ---------------------------------------------------------------------
-- 17. Per-person settings for each conversation
-- ---------------------------------------------------------------------
-- These belong to one person: pinning or deleting a chat never affects the others in it.
alter table public.conversation_participants
  add column pinned_at     timestamptz,
  add column marked_unread boolean not null default false,
  -- "Delete chat" hides everything before this moment, for you only.
  add column cleared_at    timestamptz;


-- ---------------------------------------------------------------------
-- 18. Actions (supabase.rpc). Each one only ever touches your own row.
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
-- 19. The sidebar list, now aware of pins, "marked unread" and deleted chats
-- ---------------------------------------------------------------------
-- Replaces the version from section 8: the return columns change, so drop it first.
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
-- 20. Permissions for the conversation actions
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


-- ---------------------------------------------------------------------
-- 21. "Last seen"
-- ---------------------------------------------------------------------
-- The app calls this every minute while you're using it, and when you leave.
-- "Online" itself comes from Realtime Presence; this is what others see once you go.
-- A function, because last_seen_at isn't directly editable (see profile editing).
create function public.touch_last_seen()
returns void
language sql
security definer set search_path = ''
as $$
  update public.profiles
     set last_seen_at = now()
   where id = (select auth.uid());
$$;

revoke execute on function public.touch_last_seen() from public, anon;
grant  execute on function public.touch_last_seen() to authenticated;


-- ---------------------------------------------------------------------
-- 22. Who can join which Realtime channel
-- ---------------------------------------------------------------------
-- The app uses private channels, so Realtime checks these policies before letting
-- anyone in. (Database changes are protected separately, by the tables' own RLS.)

-- "typing:<conversation id>" → is the caller a member of that conversation?
create function public.is_member_of_topic(topic text)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select case
    when topic ~ '^typing:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.is_member(substr(topic, 8)::uuid)
    else false
  end;
$$;

revoke execute on function public.is_member_of_topic(text) from public, anon;
grant  execute on function public.is_member_of_topic(text) to authenticated;

-- Online status: any signed-in user can see it and share their own.
create policy "Signed-in users can see who is online"
  on realtime.messages for select to authenticated
  using (realtime.topic() = 'online-users' and extension = 'presence');

create policy "Signed-in users can appear online"
  on realtime.messages for insert to authenticated
  with check (realtime.topic() = 'online-users' and extension = 'presence');

-- Typing: only the members of that conversation, in both directions.
create policy "Members can see who is typing"
  on realtime.messages for select to authenticated
  using (extension = 'broadcast' and public.is_member_of_topic(realtime.topic()));

create policy "Members can say they are typing"
  on realtime.messages for insert to authenticated
  with check (extension = 'broadcast' and public.is_member_of_topic(realtime.topic()));


-- ---------------------------------------------------------------------
-- 23. Message types
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
-- 24. Private bucket for voice notes, files and videos
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
-- 25. Group photo and per-person chat wallpaper
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
-- 26. Group management (admins only)
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
-- 27. The sidebar list, now with group photos, wallpapers and message kinds
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
-- 28. Permissions and Realtime
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


-- ---------------------------------------------------------------------
-- 29. Push notification subscriptions
-- ---------------------------------------------------------------------
-- One row per browser/device that turned notifications on. The endpoint and keys
-- come from the browser's PushManager; the send-push Edge Function uses them.
create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- You can see your own devices. Saving and removing go through the functions below.
create policy "Users can see their own push subscriptions"
  on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

-- Saves this browser for the current user. A browser that was used by another account
-- before is moved over, so notifications never reach the wrong person.
create function public.save_push_subscription(sub_endpoint text, sub_p256dh text, sub_auth text, sub_user_agent text)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if sub_endpoint !~ '^https://' then
    raise exception 'Invalid push endpoint' using errcode = '22023';
  end if;

  delete from public.push_subscriptions where endpoint = sub_endpoint;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (me, sub_endpoint, sub_p256dh, sub_auth, left(sub_user_agent, 300));
end;
$$;

create function public.delete_push_subscription(sub_endpoint text)
returns void
language sql
security definer set search_path = ''
as $$
  delete from public.push_subscriptions
   where endpoint = sub_endpoint and user_id = (select auth.uid());
$$;

revoke execute on function public.save_push_subscription(text, text, text, text) from public, anon;
revoke execute on function public.delete_push_subscription(text)                 from public, anon;
grant  execute on function public.save_push_subscription(text, text, text, text) to authenticated;
grant  execute on function public.delete_push_subscription(text)                 to authenticated;


-- ---------------------------------------------------------------------
-- 30. Attachment validation
-- ---------------------------------------------------------------------
-- The app writes attachments in a known shape, but the API accepts any JSON.
-- A message with the wrong types (e.g. {"lat": "x"}) or a huge blob would
-- reach every member of the conversation, so the database refuses it.
create function public.is_valid_attachment(kind text, a jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when a is null then kind <> 'location' else
    jsonb_typeof(a) = 'object'
    and pg_column_size(a) <= 4096
    and (a -> 'path'        is null or jsonb_typeof(a -> 'path')        = 'string')
    and (a -> 'name'        is null or jsonb_typeof(a -> 'name')        = 'string')
    and (a -> 'mime'        is null or jsonb_typeof(a -> 'mime')        = 'string')
    and (a -> 'size'        is null or jsonb_typeof(a -> 'size')        = 'number')
    and (a -> 'duration_ms' is null or jsonb_typeof(a -> 'duration_ms') = 'number')
    and (a -> 'waveform' is null or (
      jsonb_typeof(a -> 'waveform') = 'array'
      and jsonb_array_length(a -> 'waveform') <= 64
      and not jsonb_path_exists(a -> 'waveform', '$[*] ? (@.type() != "number")')
    ))
    and (a -> 'lat' is null or (jsonb_typeof(a -> 'lat') = 'number' and abs((a ->> 'lat')::numeric) <= 90))
    and (a -> 'lng' is null or (jsonb_typeof(a -> 'lng') = 'number' and abs((a ->> 'lng')::numeric) <= 180))
    -- A location is nothing without its coordinates.
    and (kind <> 'location' or (a ? 'lat' and a ? 'lng'))
  end;
$$;

-- Callable by whoever inserts messages: the check runs as them.
revoke execute on function public.is_valid_attachment(text, jsonb) from public, anon;
grant  execute on function public.is_valid_attachment(text, jsonb) to authenticated, service_role;

-- "not valid": existing rows are left alone; every new message is checked.
alter table public.messages
  add constraint messages_valid_attachment
    check (public.is_valid_attachment(kind, attachment)) not valid;


-- ---------------------------------------------------------------------
-- 31a. Photos can only come from Hamsa's own storage (or Google)
-- ---------------------------------------------------------------------
-- avatar_url is shown to everyone who sees you. If it could be any URL, a
-- tracking image on someone else's server would learn every viewer's IP.
-- A signed-in user may only point it at their own folder in the avatars
-- bucket (a group: its own folder), on this project's host, which is read
-- from the caller's token issuer ("https://<ref>.supabase.co/auth/v1").
-- Sign-up and the Google sync triggers don't run as "authenticated" and
-- only ever write Google's photo URL, so they are left alone.
create function public.is_allowed_avatar_url(url text, folder text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  issuer text := claims ->> 'iss';
  prefix text;
begin
  if url is null or url ~ '^https://lh[0-9]\.googleusercontent\.com/' then
    return true;
  end if;
  if coalesce(claims ->> 'role', '') <> 'authenticated' then
    return true;
  end if;
  if issuer is null or issuer !~ '^https://[^/]+/auth/v1$' then
    return false;
  end if;

  prefix := left(issuer, -length('/auth/v1')) || '/storage/v1/object/public/avatars/' || folder || '/';
  return starts_with(url, prefix)
     and substr(url, length(prefix) + 1) ~ '^[A-Za-z0-9_-]+\.[a-z]{3,4}$';
end;
$$;

revoke execute on function public.is_allowed_avatar_url(text, text) from public, anon;
grant  execute on function public.is_allowed_avatar_url(text, text) to authenticated, service_role;

-- Checked only when the photo changes, so renaming a group never trips over an older URL.
create function public.check_profile_avatar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.avatar_url is distinct from old.avatar_url
     and not public.is_allowed_avatar_url(new.avatar_url, new.id::text) then
    raise exception 'Upload your photo through Hamsa' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger profiles_check_avatar
  before update of avatar_url on public.profiles
  for each row execute function public.check_profile_avatar();

create function public.check_group_avatar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.avatar_url is distinct from old.avatar_url
     and not public.is_allowed_avatar_url(new.avatar_url, 'groups/' || new.id::text) then
    raise exception 'Upload the group photo through Hamsa' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger conversations_check_avatar
  before update of avatar_url on public.conversations
  for each row execute function public.check_group_avatar();

revoke execute on function public.check_profile_avatar() from public, anon, authenticated;
revoke execute on function public.check_group_avatar()   from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 31b. Chat images: the same limits on the server as in the app
-- ---------------------------------------------------------------------
-- The app resizes photos to WebP (PNG on older browsers) and keeps GIFs as they are.
update storage.buckets
   set file_size_limit = 20971520,
       allowed_mime_types = array['image/webp', 'image/png', 'image/jpeg', 'image/gif']
 where id = 'chat-images';


-- ---------------------------------------------------------------------
-- 31c. A group always keeps at least one admin
-- ---------------------------------------------------------------------
create or replace function public.set_member_role(conv_id uuid, member_id uuid, new_role text)
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
  if new_role = 'member' and not exists (
    select 1 from public.conversation_participants
     where conversation_id = conv_id and role = 'admin' and user_id <> member_id
  ) then
    raise exception 'A group needs at least one admin' using errcode = '22023';
  end if;

  update public.conversation_participants
     set role = new_role
   where conversation_id = conv_id and user_id = member_id;
end;
$$;


-- ---------------------------------------------------------------------
-- 32a. Blocks
-- ---------------------------------------------------------------------
-- One row per person you blocked. Only you can see your own list: the other
-- person is never told, they just can't reach you any more.
create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index blocks_blocked_idx on public.blocks (blocked_id);

alter table public.blocks enable row level security;

-- No insert/delete policies: changes go through block_user / unblock_user.
create policy "People can see who they blocked"
  on public.blocks for select to authenticated
  using (blocker_id = (select auth.uid()));

-- Either person blocked the other.
create function public.is_blocked_between(a uuid, b uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.blocks
     where (blocker_id = a and blocked_id = b)
        or (blocker_id = b and blocked_id = a)
  );
$$;


-- ---------------------------------------------------------------------
-- 32b. Who can add you to groups
-- ---------------------------------------------------------------------
alter table public.profiles
  add column group_invites text not null default 'everyone'
    check (group_invites in ('everyone', 'friends'));

grant update (group_invites) on public.profiles to authenticated;

-- Can the caller put this person in a group?
create function public.can_add_to_group(member uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select not public.is_blocked_between((select auth.uid()), member)
     and (
       (select group_invites from public.profiles where id = member) = 'everyone'
       or exists (
         select 1 from public.friendships
          where status = 'accepted'
            and least(requester_id, addressee_id) = least((select auth.uid()), member)
            and greatest(requester_id, addressee_id) = greatest((select auth.uid()), member)
       )
     );
$$;


-- ---------------------------------------------------------------------
-- 32c. Messages: nobody can write into a blocked one-to-one chat
-- ---------------------------------------------------------------------
-- Groups are unaffected: blocking someone doesn't stop a group you share.
create function public.can_send_to(conv_id uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select not exists (
    select 1
      from public.conversations c
      join public.conversation_participants other
        on other.conversation_id = c.id and other.user_id <> (select auth.uid())
     where c.id = conv_id
       and not c.is_group
       and public.is_blocked_between((select auth.uid()), other.user_id)
  );
$$;

drop policy "Members can send messages as themselves" on public.messages;

create policy "Members can send messages as themselves"
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and public.is_member(conversation_id)
    and public.can_send_to(conversation_id)
  );


-- ---------------------------------------------------------------------
-- 32d. Existing functions, now aware of blocks
-- ---------------------------------------------------------------------

-- A blocked pair can still open the chat they already had (to read it),
-- but can't start a new one.
create or replace function public.get_or_create_direct_conversation(other_user_id uuid)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  me      uuid := auth.uid();
  pair    text;
  conv_id uuid;
begin
  if me is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if other_user_id = me then
    raise exception 'You can''t start a conversation with yourself' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = other_user_id) then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  pair := least(me::text, other_user_id::text) || ':' || greatest(me::text, other_user_id::text);

  select id into conv_id from public.conversations where direct_key = pair;
  if conv_id is not null then
    return conv_id;
  end if;

  if public.is_blocked_between(me, other_user_id) then
    raise exception 'You can''t message this person' using errcode = '42501';
  end if;

  insert into public.conversations (is_group, created_by, direct_key)
  values (false, me, pair)
  on conflict (direct_key) do nothing
  returning id into conv_id;

  if conv_id is null then
    -- Both people pressed "New chat" at the same moment: the other insert won.
    select id into conv_id from public.conversations where direct_key = pair;
  else
    insert into public.conversation_participants (conversation_id, user_id)
    values (conv_id, me), (conv_id, other_user_id);
  end if;

  return conv_id;
end;
$$;

create or replace function public.send_friend_request(target_id uuid)
returns text
language plpgsql
security definer set search_path = ''
as $$
declare
  me       uuid := auth.uid();
  existing public.friendships;
begin
  if me is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if target_id = me then
    raise exception 'You can''t add yourself' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = target_id) then
    raise exception 'User not found' using errcode = 'P0002';
  end if;
  if public.is_blocked_between(me, target_id) then
    raise exception 'You can''t add this person' using errcode = '42501';
  end if;

  select * into existing
  from public.friendships
  where least(requester_id, addressee_id) = least(me, target_id)
    and greatest(requester_id, addressee_id) = greatest(me, target_id);

  if found then
    if existing.status = 'pending' and existing.requester_id = target_id then
      update public.friendships
         set status = 'accepted', responded_at = now()
       where id = existing.id;
      return 'accepted';
    end if;
    return existing.status;
  end if;

  insert into public.friendships (requester_id, addressee_id) values (me, target_id);
  return 'pending';
exception
  when unique_violation then
    -- Both people pressed "Add" at the same moment: the other request won.
    return (
      select status from public.friendships
      where least(requester_id, addressee_id) = least(me, target_id)
        and greatest(requester_id, addressee_id) = greatest(me, target_id)
    );
end;
$$;

create or replace function public.create_group_conversation(group_name text, member_ids uuid[])
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  me         uuid := auth.uid();
  members    uuid[];
  conv_id    uuid;
  refused    text;
begin
  if me is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if nullif(trim(group_name), '') is null then
    raise exception 'Give the group a name' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct m), '{}') into members
  from unnest(member_ids) as m
  where m <> me;

  if cardinality(members) = 0 then
    raise exception 'Add at least one person' using errcode = '22023';
  end if;
  if cardinality(members) > 49 then
    raise exception 'Groups can have up to 50 people' using errcode = '22023';
  end if;
  if (select count(*) from public.profiles where id = any (members)) <> cardinality(members) then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  select full_name into refused from public.profiles
   where id = any (members) and not public.can_add_to_group(id)
   limit 1;
  if refused is not null then
    raise exception '% can''t be added to groups by you', refused using errcode = '42501';
  end if;

  insert into public.conversations (is_group, name, created_by)
  values (true, trim(group_name), me)
  returning id into conv_id;

  insert into public.conversation_participants (conversation_id, user_id, role)
  values (conv_id, me, 'admin');

  insert into public.conversation_participants (conversation_id, user_id)
  select conv_id, m from unnest(members) as m;

  return conv_id;
end;
$$;

create or replace function public.add_group_members(conv_id uuid, member_ids uuid[])
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  refused text;
begin
  if not public.is_group_admin(conv_id) then
    raise exception 'Only group admins can add people' using errcode = '42501';
  end if;
  if (select count(*) from public.conversation_participants where conversation_id = conv_id)
     + (select count(distinct m) from unnest(member_ids) m) > 50 then
    raise exception 'Groups can have up to 50 people' using errcode = '22023';
  end if;

  select full_name into refused from public.profiles
   where id = any (member_ids) and not public.can_add_to_group(id)
   limit 1;
  if refused is not null then
    raise exception '% can''t be added to groups by you', refused using errcode = '42501';
  end if;

  insert into public.conversation_participants (conversation_id, user_id)
  select conv_id, p.id
  from public.profiles p
  where p.id = any (member_ids)
  on conflict do nothing;
end;
$$;


-- ---------------------------------------------------------------------
-- 32e. Block functions (supabase.rpc)
-- ---------------------------------------------------------------------
-- Blocking also ends any friendship or pending request between you.
create function public.block_user(target_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if target_id = me then
    raise exception 'You can''t block yourself' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = target_id) then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  insert into public.blocks (blocker_id, blocked_id) values (me, target_id)
  on conflict do nothing;

  delete from public.friendships
   where least(requester_id, addressee_id) = least(me, target_id)
     and greatest(requester_id, addressee_id) = greatest(me, target_id);
end;
$$;

create function public.unblock_user(target_id uuid)
returns void
language sql
security definer set search_path = ''
as $$
  delete from public.blocks
   where blocker_id = (select auth.uid()) and blocked_id = target_id;
$$;

-- The people you blocked, with their profile.
create function public.get_my_blocks()
returns table (
  user_id    uuid,
  username   text,
  full_name  text,
  avatar_url text,
  created_at timestamptz
)
language sql
stable
security invoker set search_path = ''
as $$
  select p.id, p.username, p.full_name, p.avatar_url, b.created_at
    from public.blocks b
    join public.profiles p on p.id = b.blocked_id
   where b.blocker_id = (select auth.uid())
   order by p.full_name;
$$;

-- Your one-to-one chats where either of you blocked the other: the app shows
-- "You can't reply" there instead of the message box.
create function public.get_blocked_conversations()
returns setof uuid
language sql
stable
security definer set search_path = ''
as $$
  select c.id
    from public.conversation_participants me
    join public.conversations c on c.id = me.conversation_id and not c.is_group
    join public.conversation_participants other
      on other.conversation_id = c.id and other.user_id <> me.user_id
   where me.user_id = (select auth.uid())
     and public.is_blocked_between(me.user_id, other.user_id);
$$;


-- ---------------------------------------------------------------------
-- 32f. Permissions
-- ---------------------------------------------------------------------
-- Internal helpers: they would tell anyone who blocked whom, so only the
-- functions above (which run as the owner) can call them.
revoke execute on function public.is_blocked_between(uuid, uuid)  from public, anon, authenticated;
revoke execute on function public.can_add_to_group(uuid)          from public, anon, authenticated;
-- Used by the messages policy, which runs as the caller; it only answers about
-- conversations the caller is in.
revoke execute on function public.can_send_to(uuid)               from public, anon;
revoke execute on function public.block_user(uuid)                from public, anon;
revoke execute on function public.unblock_user(uuid)              from public, anon;
revoke execute on function public.get_my_blocks()                 from public, anon;
revoke execute on function public.get_blocked_conversations()     from public, anon;
grant  execute on function public.can_send_to(uuid)               to authenticated;
grant  execute on function public.block_user(uuid)                to authenticated;
grant  execute on function public.unblock_user(uuid)              to authenticated;
grant  execute on function public.get_my_blocks()                 to authenticated;
grant  execute on function public.get_blocked_conversations()     to authenticated;


-- ---------------------------------------------------------------------
-- 33a. Online status and "last seen" only for the people you chat with
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
-- 33b. Message requests
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
-- 33c. Rate limit: at most 15 messages per person every 10 seconds
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
-- 33d. Files nobody uses any more
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
-- 33e. Deleting an account
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
-- 33f. Permissions
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
-- 34a. Sending
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
-- 34b. What triggers an update
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
-- 34c. Who can listen
-- ---------------------------------------------------------------------
-- Your own channel only. Nobody can send on it from the app: only the triggers above.
create policy "People receive their own live updates"
  on realtime.messages for select to authenticated
  using (extension = 'broadcast' and realtime.topic() = 'user:' || (select auth.uid())::text);


-- ---------------------------------------------------------------------
-- 34d. Postgres Changes are no longer used
-- ---------------------------------------------------------------------
alter publication supabase_realtime
  drop table public.messages, public.conversation_participants, public.conversations, public.friendships;


-- ---------------------------------------------------------------------
-- 34e. Permissions
-- ---------------------------------------------------------------------
revoke execute on function public.send_to_user(uuid, text, jsonb)               from public, anon, authenticated;
revoke execute on function public.send_to_members(uuid, text, jsonb, uuid)      from public, anon, authenticated;
revoke execute on function public.broadcast_message()                          from public, anon, authenticated;
revoke execute on function public.broadcast_participant()                      from public, anon, authenticated;
revoke execute on function public.broadcast_conversation()                     from public, anon, authenticated;
revoke execute on function public.broadcast_friendship()                       from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 35a. New message fields
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
-- 35b. Edit and delete for everyone
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
-- 35c. Reactions: one per person per message
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
-- 35d. Pinned messages (for everyone in the chat) and saved messages (just for you)
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
-- 35e. Live updates for edits, deletions, pins and reactions
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
-- 35f. Mentions reach you even in a muted group
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
-- 35g. Search your messages (English and Arabic alike: trigram matching)
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
-- 35h. Reporting people and messages
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
-- 35i. Link previews (filled in by the link-preview Edge Function)
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
-- 35j. Group description and invite links
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
-- 35k. The sidebar list: description, invite link (admins), and deleted last messages
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
-- 35l. Permissions
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
