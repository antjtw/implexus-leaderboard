-- Implexus Powerlifting — sync with OpenPowerlifting on demand
-- Run in the Supabase SQL Editor (safe to re-run), after setup.sql.
--
-- Gives you two things, both of which ask GitHub to run the refresh straight
-- away instead of waiting for 6am:
--   1. Automatic: any change to the roster (adding, editing or removing a
--      lifter) starts a sync, so a new lifter's numbers appear in a few minutes.
--   2. On demand: the "Sync now" button in admin, checked against the admin
--      code like every other admin action, with a 60-second cooldown.
--
-- BEFORE RUNNING: store a GitHub token in Supabase Vault named github_token.
-- See README.md ("Sync on demand") for how to create the token. In the SQL
-- Editor, run this once with your token pasted in:
--
--   select vault.create_secret('github_pat_...', 'github_token');
--
-- Then run this file. Afterwards set instantSync: true in config.js.

create extension if not exists pg_net;

-- When a sync was last asked for from the admin button (for the cooldown)
create table if not exists private.sync_state (
  id                 boolean primary key default true check (id),
  last_requested_at  timestamptz
);
insert into private.sync_state (id) values (true) on conflict (id) do nothing;

-- Ask GitHub to run the refresh. Returns 'started', or 'not_set_up' when no
-- token is stored. GitHub queues at most one extra run, so bursts are harmless.
create or replace function private.dispatch_sync()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  token text;
begin
  select decrypted_secret into token
    from vault.decrypted_secrets
   where name = 'github_token'
   limit 1;
  if token is null then
    return 'not_set_up';
  end if;

  perform net.http_post(
    url     := 'https://api.github.com/repos/antjtw/implexus-leaderboard/dispatches',
    body    := jsonb_build_object('event_type', 'roster-changed'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || token,
      'Accept', 'application/vnd.github+json',
      'Content-Type', 'application/json',
      'User-Agent', 'implexus-leaderboard'
    )
  );
  return 'started';
end;
$$;

-- 1. Automatic: after any roster change
create or replace function private.request_github_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.dispatch_sync();
  return null;
end;
$$;

drop trigger if exists lifters_request_sync on public.lifters;
create trigger lifters_request_sync
  after insert or update or delete on public.lifters
  for each statement
  execute function private.request_github_sync();

-- 2. On demand: the admin "Sync now" button
create or replace function public.admin_request_sync(pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  err text := private.check_pin(pin);
  last_at timestamptz;
  outcome text;
begin
  if err is not null then
    return jsonb_build_object('ok', false, 'error', err);
  end if;

  select last_requested_at into last_at from private.sync_state where id;
  if last_at is not null and last_at > now() - interval '60 seconds' then
    return jsonb_build_object('ok', false, 'error', 'too_soon');
  end if;

  outcome := private.dispatch_sync();
  if outcome <> 'started' then
    return jsonb_build_object('ok', false, 'error', outcome);
  end if;

  update private.sync_state set last_requested_at = now() where id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function private.dispatch_sync() from public, anon, authenticated;
revoke all on function private.request_github_sync() from public, anon, authenticated;
revoke all on function public.admin_request_sync(text) from public;
grant execute on function public.admin_request_sync(text) to anon, authenticated;

-- Make the new admin function callable through the API straight away
notify pgrst, 'reload schema';
