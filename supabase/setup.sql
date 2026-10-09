-- Implexus Powerlifting — Supabase setup
-- Run once in the Supabase SQL Editor (it is safe to re-run).
--
-- BEFORE RUNNING: change 000000 on the last line to your own 6-digit code.
--
-- What this creates:
--   public.lifters        the roster (name, OpenPowerlifting slug, Instagram,
--                         legacy). Anyone can read it; nobody can write to it
--                         directly.
--   private.*             the hashed admin code and a failed-attempt log, in
--                         a schema the public API can't see.
--   public.admin_*()      the only way to change the roster. Each checks the
--                         code first and returns {ok: true, ...} or
--                         {ok: false, error: "..."}.

create extension if not exists pgcrypto with schema extensions;

-- ── Roster ─────────────────────────────────────────────────────
create table if not exists public.lifters (
  id          bigint generated always as identity primary key,
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  slug        text not null unique check (slug ~ '^[a-z0-9]{1,64}$'),
  ig          text check (ig is null or ig ~ '^[A-Za-z0-9._]{1,30}$'),
  legacy      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.lifters enable row level security;

drop policy if exists "Anyone can read the roster" on public.lifters;
create policy "Anyone can read the roster"
  on public.lifters for select
  to anon, authenticated
  using (true);

-- No insert/update/delete policies, and no direct write grants either:
-- changes only happen through the code-checked functions below.
revoke insert, update, delete, truncate on public.lifters from anon, authenticated;

-- ── Private: admin code + attempt log ─────────────────────────
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.admin_pin (
  id        boolean primary key default true check (id),   -- single row
  pin_hash  text not null
);

create table if not exists private.pin_attempts (
  attempted_at timestamptz not null default now()
);

-- Returns null when the code is right, otherwise an error code.
-- Wrong codes are logged; after 30 wrong codes in 10 minutes, everyone is
-- locked out until the window passes. That makes guessing all million codes
-- impractical while staying easy for real admins.
create or replace function private.check_pin(p_pin text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored text;
begin
  delete from private.pin_attempts where attempted_at < now() - interval '1 day';

  if (select count(*) from private.pin_attempts
      where attempted_at > now() - interval '10 minutes') >= 30 then
    return 'locked';
  end if;

  select pin_hash into stored from private.admin_pin where id;
  if stored is null then
    return 'no_pin';
  end if;

  if p_pin is null or p_pin !~ '^[0-9]{6}$'
     or extensions.crypt(p_pin, stored) <> stored then
    insert into private.pin_attempts default values;
    return 'wrong_pin';
  end if;

  return null;
end;
$$;

-- ── Public admin functions ────────────────────────────────────
create or replace function public.admin_verify_pin(pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  err text := private.check_pin(pin);
begin
  if err is not null then
    return jsonb_build_object('ok', false, 'error', err);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_add_lifter(
  pin text, p_name text, p_slug text, p_ig text default null, p_legacy boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  err text := private.check_pin(pin);
  rec public.lifters;
begin
  if err is not null then
    return jsonb_build_object('ok', false, 'error', err);
  end if;

  begin
    insert into public.lifters (name, slug, ig, legacy)
    values (btrim(p_name), lower(btrim(p_slug)), nullif(btrim(p_ig), ''), coalesce(p_legacy, false))
    returning * into rec;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'error', 'duplicate');
    when check_violation or not_null_violation then
      return jsonb_build_object('ok', false, 'error', 'invalid');
  end;

  return jsonb_build_object('ok', true, 'lifter', to_jsonb(rec));
end;
$$;

create or replace function public.admin_update_lifter(
  pin text, p_id bigint, p_name text, p_slug text, p_ig text default null, p_legacy boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  err text := private.check_pin(pin);
  rec public.lifters;
begin
  if err is not null then
    return jsonb_build_object('ok', false, 'error', err);
  end if;

  begin
    update public.lifters
       set name = btrim(p_name),
           slug = lower(btrim(p_slug)),
           ig = nullif(btrim(p_ig), ''),
           legacy = coalesce(p_legacy, false),
           updated_at = now()
     where id = p_id
    returning * into rec;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'error', 'duplicate');
    when check_violation or not_null_violation then
      return jsonb_build_object('ok', false, 'error', 'invalid');
  end;

  if rec.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'lifter', to_jsonb(rec));
end;
$$;

create or replace function public.admin_remove_lifter(pin text, p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  err text := private.check_pin(pin);
begin
  if err is not null then
    return jsonb_build_object('ok', false, 'error', err);
  end if;

  delete from public.lifters where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function private.check_pin(text) from public, anon, authenticated;
revoke all on function public.admin_verify_pin(text) from public;
revoke all on function public.admin_add_lifter(text, text, text, text, boolean) from public;
revoke all on function public.admin_update_lifter(text, bigint, text, text, text, boolean) from public;
revoke all on function public.admin_remove_lifter(text, bigint) from public;
grant execute on function public.admin_verify_pin(text) to anon, authenticated;
grant execute on function public.admin_add_lifter(text, text, text, text, boolean) to anon, authenticated;
grant execute on function public.admin_update_lifter(text, bigint, text, text, text, boolean) to anon, authenticated;
grant execute on function public.admin_remove_lifter(text, bigint) to anon, authenticated;

-- ── Admin code ────────────────────────────────────────────────
-- Change 000000 to your own 6-digit code. To change it later, edit and run
-- just this statement again.
insert into private.admin_pin (id, pin_hash)
values (true, extensions.crypt('000000', extensions.gen_salt('bf')))
on conflict (id) do update set pin_hash = excluded.pin_hash;
