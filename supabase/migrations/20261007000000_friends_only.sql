-- =====================================================================
-- Hamsa: friends only: you chat with friends, find people by the start of
-- their username or an invite link, and see suggestions of friends of friends
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (Run it AFTER the thirteen earlier migrations. Don't run those again.)
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------
create function public.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.friendships
     where status = 'accepted'
       and least(requester_id, addressee_id) = least(a, b)
       and greatest(requester_id, addressee_id) = greatest(a, b)
  );
$$;

-- Whose profile the caller may read: themselves, anyone they have a friendship
-- or request with, and anyone they share a conversation with. Nobody else:
-- the people list can't be browsed.
create function public.can_see_profile(target uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select target = (select auth.uid())
      or exists (
        select 1 from public.friendships
         where least(requester_id, addressee_id) = least((select auth.uid()), target)
           and greatest(requester_id, addressee_id) = greatest((select auth.uid()), target)
      )
      or exists (
        select 1
          from public.conversation_participants mine
          join public.conversation_participants theirs
            on theirs.conversation_id = mine.conversation_id and theirs.user_id = target
         where mine.user_id = (select auth.uid())
      );
$$;


-- ---------------------------------------------------------------------
-- 2. Profiles: no longer visible to everyone signed in
-- ---------------------------------------------------------------------
drop policy "Signed-in users can see profiles" on public.profiles;

create policy "Users can see people they're connected to"
  on public.profiles for select to authenticated
  using (public.can_see_profile(id));

-- Choosing a username still needs to know whether anyone has it.
create function public.is_username_available(name text)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select not exists (
    select 1 from public.profiles where username = name and id <> (select auth.uid())
  );
$$;


-- ---------------------------------------------------------------------
-- 3. Finding people: the start of a username, or friends of your friends
-- ---------------------------------------------------------------------
-- "@Ame" and "ame" find @ameera and @amer_1; fewer than 3 characters, or a
-- name, finds nobody, so the people list can't be browsed. At most twenty,
-- exact match first.
create function public.search_people(handle text)
returns table (id uuid, username text, full_name text, avatar_url text)
language sql
stable
security definer set search_path = ''
as $$
  with q as (select lower(ltrim(trim(handle), '@')) as prefix)
  select p.id, p.username, p.full_name, p.avatar_url
    from public.profiles p, q
   where length(q.prefix) >= 3
     -- Usernames are only a-z, 0-9 and _, so anything else can't match.
     and q.prefix ~ '^[a-z0-9_]+$'
     and p.username like q.prefix || '%'
     and p.id <> (select auth.uid())
     and not public.is_blocked_between((select auth.uid()), p.id)
   order by p.username = q.prefix desc, p.username
   limit 20;
$$;

-- Friends of your friends you have no friendship or request with yet,
-- most mutual friends first. At most ten.
create function public.people_you_may_know()
returns table (id uuid, username text, full_name text, avatar_url text, mutual_friends integer)
language sql
stable
security definer set search_path = ''
as $$
  with my_friends as (
    select case when f.requester_id = (select auth.uid()) then f.addressee_id else f.requester_id end as friend_id
      from public.friendships f
     where f.status = 'accepted'
       and (select auth.uid()) in (f.requester_id, f.addressee_id)
  ),
  their_friends as (
    select case when f.requester_id = mf.friend_id then f.addressee_id else f.requester_id end as person_id
      from public.friendships f
      join my_friends mf on mf.friend_id in (f.requester_id, f.addressee_id)
     where f.status = 'accepted'
  )
  select p.id, p.username, p.full_name, p.avatar_url, count(*)::integer
    from their_friends tf
    join public.profiles p on p.id = tf.person_id
   where p.id <> (select auth.uid())
     and not exists (
       select 1 from public.friendships f
        where least(f.requester_id, f.addressee_id) = least((select auth.uid()), p.id)
          and greatest(f.requester_id, f.addressee_id) = greatest((select auth.uid()), p.id)
     )
     and not public.is_blocked_between((select auth.uid()), p.id)
   group by p.id
   order by count(*) desc, p.full_name
   limit 10;
$$;


-- ---------------------------------------------------------------------
-- 4. New chats and groups: friends only
-- ---------------------------------------------------------------------
-- A chat you already have stays open (to read it, and to keep talking);
-- a new one needs you to be friends.
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
  if not public.are_friends(me, other_user_id) then
    raise exception 'Add them as a friend first' using errcode = '42501';
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

-- Only your friends can be put in a group by you (a group's invite link still
-- lets anyone who has it join).
create or replace function public.can_add_to_group(member uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select not public.is_blocked_between((select auth.uid()), member)
     and public.are_friends((select auth.uid()), member);
$$;

-- The "who can add me to groups" setting is gone: it's always your friends.
alter table public.profiles drop column group_invites;


-- ---------------------------------------------------------------------
-- 5. Permissions
-- ---------------------------------------------------------------------
-- Internal helpers: only the functions and policies above (which run as the owner) use them.
revoke execute on function public.are_friends(uuid, uuid)         from public, anon, authenticated;
revoke execute on function public.can_see_profile(uuid)           from public, anon;
revoke execute on function public.is_username_available(text)     from public, anon;
revoke execute on function public.search_people(text)             from public, anon;
revoke execute on function public.people_you_may_know()           from public, anon;
-- Used by the profiles policy, which runs as the caller.
grant  execute on function public.can_see_profile(uuid)           to authenticated;
grant  execute on function public.is_username_available(text)     to authenticated;
grant  execute on function public.search_people(text)             to authenticated;
grant  execute on function public.people_you_may_know()           to authenticated;
