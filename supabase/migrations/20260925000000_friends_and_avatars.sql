-- =====================================================================
-- Hamsa: friends + profile pictures from Google
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (Run it AFTER 20260924000000_init.sql. Don't run init again.)
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Profile pictures from Google
-- ---------------------------------------------------------------------
-- Google puts the photo in "avatar_url" (and "picture"). Take whichever exists.
create or replace function public.handle_new_user()
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

create trigger on_auth_user_updated
  after update of raw_user_meta_data on auth.users
  for each row execute function public.sync_avatar_from_auth();

revoke execute on function public.sync_avatar_from_auth() from public, anon, authenticated;

-- Fill in photos for accounts that already exist.
update public.profiles p
   set avatar_url = coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture')
  from auth.users u
 where u.id = p.id
   and p.avatar_url is null
   and coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture') is not null;


-- ---------------------------------------------------------------------
-- 2. Friendships
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
-- 3. Friend functions (supabase.rpc)
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
