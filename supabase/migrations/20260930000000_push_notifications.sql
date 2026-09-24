-- =====================================================================
-- Hamsa: push notifications (Web Push)
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (Run it AFTER the six earlier migrations. Don't run those again.)
-- =====================================================================

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
