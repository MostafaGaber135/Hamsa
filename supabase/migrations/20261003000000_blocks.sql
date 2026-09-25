-- =====================================================================
-- Hamsa: blocking people, and who can add you to groups
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (Run it AFTER the nine earlier migrations. Don't run those again.)
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Blocks
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
-- 2. Who can add you to groups
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
-- 3. Messages: nobody can write into a blocked one-to-one chat
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
-- 4. Existing functions, now aware of blocks
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
-- 5. Block functions (supabase.rpc)
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
-- 6. Permissions
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
