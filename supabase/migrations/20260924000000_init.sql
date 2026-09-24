-- =====================================================================
-- Hamsa: initial schema
-- Tables:   profiles, conversations, conversation_participants, messages
-- Security: Row Level Security on every table; writes that touch several
--           tables at once go through functions (RPCs) so they stay atomic.
-- Run once in Supabase: SQL Editor → New query → paste → Run.
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
-- and Google (which sends full_name / name and avatar_url).
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
    -- A short slice of the id keeps usernames unique without a retry loop.
    base || '_' || substr(replace(new.id::text, '-', ''), 1, 6),
    left(display_name, 60),
    new.raw_user_meta_data ->> 'avatar_url'
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
