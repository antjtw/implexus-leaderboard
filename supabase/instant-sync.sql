-- Implexus Powerlifting — optional instant sync
-- Without this, roster changes reach the board at the next daily refresh.
-- With it, any add/edit/remove asks GitHub to run the refresh straight away,
-- so a new lifter appears within a few minutes.
--
-- BEFORE RUNNING: store a GitHub token in Supabase Vault named github_token.
-- See README.md ("Instant sync") for how to create the token. In the SQL
-- Editor, run this once with your token pasted in:
--
--   select vault.create_secret('github_pat_...', 'github_token');
--
-- Then run this file. Afterwards set instantSync: true in config.js.

create extension if not exists pg_net;

create or replace function private.request_github_sync()
returns trigger
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

  if token is not null then
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
  end if;

  return null;
end;
$$;

revoke all on function private.request_github_sync() from public, anon, authenticated;

drop trigger if exists lifters_request_sync on public.lifters;
create trigger lifters_request_sync
  after insert or update or delete on public.lifters
  for each statement
  execute function private.request_github_sync();
