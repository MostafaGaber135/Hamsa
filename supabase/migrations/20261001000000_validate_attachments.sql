-- =====================================================================
-- Hamsa: validate message attachments
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (Run it AFTER the seven earlier migrations. Don't run those again.)
-- =====================================================================

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
