-- =====================================================================
-- Hamsa: editing your own profile (name, username, photo)
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (Run it AFTER the two earlier migrations. Don't run those again.)
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Only these columns can be edited from the app
-- ---------------------------------------------------------------------
-- The update policy already limits you to your own row. Column privileges
-- also stop anyone from changing their id, created_at or last_seen_at.
revoke update on public.profiles from anon, authenticated;
grant  update (full_name, username, avatar_url) on public.profiles to authenticated;


-- ---------------------------------------------------------------------
-- 2. Profile photos bucket
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
-- 3. Don't bring back a removed photo on every Google sign-in
-- ---------------------------------------------------------------------
-- Google resends the same photo URL each time you sign in. Only copy it when
-- the Google photo actually changed, so "Remove photo" stays removed.
drop trigger if exists on_auth_user_updated on auth.users;

create trigger on_auth_user_updated
  after update of raw_user_meta_data on auth.users
  for each row
  when (
    coalesce(old.raw_user_meta_data ->> 'avatar_url', old.raw_user_meta_data ->> 'picture')
      is distinct from
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  execute function public.sync_avatar_from_auth();
