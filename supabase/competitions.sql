-- Implexus Powerlifting — competitions
-- Run once in the Supabase SQL Editor, after setup.sql (safe to re-run).
--
-- public.competitions          a meet: name, federation, venue and date
-- public.competition_entries   who's lifting in it: a lifter from the roster
--                              (lifter_id) or someone who isn't on the board
--                              (just a name). The name is always stored, so if
--                              a lifter is later removed from the roster their
--                              entry stays, as a name.
--
-- Anyone can read both tables. Changes only go through the code-checked
-- functions below, same as the roster.

create table if not exists public.competitions (
  id          bigint generated always as identity primary key,
  fed         text not null check (char_length(btrim(fed)) between 1 and 60),
  date        date not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.competition_entries (
  id              bigint generated always as identity primary key,
  competition_id  bigint not null references public.competitions(id) on delete cascade,
  lifter_id       bigint references public.lifters(id) on delete set null,
  name            text not null check (char_length(btrim(name)) between 1 and 80),
  position        int not null default 0
);

-- Name and venue (added after the first version; safe on existing tables).
-- Name is required by the admin functions; venue is optional.
alter table public.competitions add column if not exists name text;
alter table public.competitions add column if not exists venue text;
alter table public.competitions drop constraint if exists competitions_name_len;
alter table public.competitions add constraint competitions_name_len
  check (name is null or char_length(btrim(name)) between 1 and 100);
alter table public.competitions drop constraint if exists competitions_venue_len;
alter table public.competitions add constraint competitions_venue_len
  check (venue is null or char_length(btrim(venue)) between 1 and 100);

create index if not exists competition_entries_competition_idx on public.competition_entries (competition_id);
create unique index if not exists competition_entries_lifter_once
  on public.competition_entries (competition_id, lifter_id) where lifter_id is not null;

alter table public.competitions enable row level security;
alter table public.competition_entries enable row level security;

drop policy if exists "Anyone can read competitions" on public.competitions;
create policy "Anyone can read competitions"
  on public.competitions for select to anon, authenticated using (true);

drop policy if exists "Anyone can read competition entries" on public.competition_entries;
create policy "Anyone can read competition entries"
  on public.competition_entries for select to anon, authenticated using (true);

revoke insert, update, delete, truncate on public.competitions from anon, authenticated;
revoke insert, update, delete, truncate on public.competition_entries from anon, authenticated;

-- The first version took no name or venue; replace it rather than overload it
drop function if exists public.admin_save_competition(text, bigint, text, date, jsonb);

-- Create (p_id null) or update a competition and replace its lifters in one go.
-- p_entries: [{"lifter_id": 12}, {"name": "Someone New"}, ...] in display order.
-- Roster lifters' names are taken from the roster, not from the request.
create or replace function public.admin_save_competition(
  pin text, p_id bigint, p_name text, p_fed text, p_venue text, p_date date,
  p_entries jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  err text := private.check_pin(pin);
  comp_id bigint := p_id;
  entry jsonb;
  pos int := 0;
  lid bigint;
  lname text;
begin
  if err is not null then
    return jsonb_build_object('ok', false, 'error', err);
  end if;
  if nullif(btrim(p_name), '') is null
     or p_entries is null or jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) > 200 then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  begin
    if comp_id is null then
      insert into public.competitions (name, fed, venue, date)
      values (btrim(p_name), btrim(p_fed), nullif(btrim(p_venue), ''), p_date)
      returning id into comp_id;
    else
      update public.competitions
         set name = btrim(p_name), fed = btrim(p_fed), venue = nullif(btrim(p_venue), ''),
             date = p_date, updated_at = now()
       where id = comp_id;
      if not found then
        return jsonb_build_object('ok', false, 'error', 'not_found');
      end if;
      delete from public.competition_entries where competition_id = comp_id;
    end if;

    for entry in select value from jsonb_array_elements(p_entries) loop
      lid := nullif(entry->>'lifter_id', '')::bigint;
      if lid is not null then
        select l.name into lname from public.lifters l where l.id = lid;
        if lname is null then
          continue;  -- removed from the roster since the form was opened
        end if;
      else
        lname := btrim(entry->>'name');
      end if;
      insert into public.competition_entries (competition_id, lifter_id, name, position)
      values (comp_id, lid, lname, pos);
      pos := pos + 1;
    end loop;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'error', 'duplicate_entry');
    when check_violation or not_null_violation or invalid_text_representation then
      return jsonb_build_object('ok', false, 'error', 'invalid');
  end;

  return jsonb_build_object('ok', true, 'id', comp_id);
end;
$$;

create or replace function public.admin_remove_competition(pin text, p_id bigint)
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
  delete from public.competitions where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_save_competition(text, bigint, text, text, text, date, jsonb) from public;
revoke all on function public.admin_remove_competition(text, bigint) from public;
grant execute on function public.admin_save_competition(text, bigint, text, text, text, date, jsonb) to anon, authenticated;
grant execute on function public.admin_remove_competition(text, bigint) to anon, authenticated;

-- Keep a lifter's name on their entries in step with roster renames
create or replace function private.sync_entry_names()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.name is distinct from old.name then
    update public.competition_entries set name = new.name where lifter_id = new.id;
  end if;
  return null;
end;
$$;

drop trigger if exists lifters_sync_entry_names on public.lifters;
create trigger lifters_sync_entry_names
  after update of name on public.lifters
  for each row execute function private.sync_entry_names();
