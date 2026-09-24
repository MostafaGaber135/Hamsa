-- =====================================================================
-- Hamsa: realtime extras ("last seen", who's online, who's typing)
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (Run it AFTER the four earlier migrations. Don't run those again.)
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. "Last seen"
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
-- 2. Who can join which Realtime channel
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
