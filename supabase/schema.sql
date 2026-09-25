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
