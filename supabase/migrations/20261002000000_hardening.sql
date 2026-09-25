-- =====================================================================
-- Hamsa: hardening (photo URLs, chat image limits, last group admin)
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (Run it AFTER the eight earlier migrations. Don't run those again.)
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Photos can only come from Hamsa's own storage (or Google)
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
-- 2. Chat images: the same limits on the server as in the app
-- ---------------------------------------------------------------------
-- The app resizes photos to WebP (PNG on older browsers) and keeps GIFs as they are.
update storage.buckets
   set file_size_limit = 20971520,
       allowed_mime_types = array['image/webp', 'image/png', 'image/jpeg', 'image/gif']
 where id = 'chat-images';


-- ---------------------------------------------------------------------
-- 3. A group always keeps at least one admin
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
