-- Implexus Powerlifting — change counter
-- Run once in the Supabase SQL Editor, after setup.sql and competitions.sql
-- (safe to re-run).
--
-- A single number that goes up whenever an admin changes anything: lifters,
-- competitions or who's lifting in them. Every screen showing the board checks
-- it every 30 seconds and reloads only when it has moved, so admin changes
-- reach the TV in under half a minute without re-downloading everything.

create table if not exists public.board_version (
  id          boolean primary key default true check (id),   -- single row
  version     bigint not null default 0,
  changed_at  timestamptz not null default now()
);
insert into public.board_version (id) values (true) on conflict (id) do nothing;

alter table public.board_version enable row level security;
drop policy if exists "Anyone can read the board version" on public.board_version;
create policy "Anyone can read the board version"
  on public.board_version for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.board_version from anon, authenticated;

create or replace function private.bump_board_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.board_version set version = version + 1, changed_at = now() where id;
  return null;
end;
$$;
revoke all on function private.bump_board_version() from public, anon, authenticated;

drop trigger if exists lifters_bump_version on public.lifters;
create trigger lifters_bump_version
  after insert or update or delete on public.lifters
  for each statement execute function private.bump_board_version();

drop trigger if exists competitions_bump_version on public.competitions;
create trigger competitions_bump_version
  after insert or update or delete on public.competitions
  for each statement execute function private.bump_board_version();

drop trigger if exists competition_entries_bump_version on public.competition_entries;
create trigger competition_entries_bump_version
  after insert or update or delete on public.competition_entries
  for each statement execute function private.bump_board_version();

-- Make the new table readable through the API straight away
notify pgrst, 'reload schema';
