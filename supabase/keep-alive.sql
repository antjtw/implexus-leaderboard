-- Keep-alive for any Supabase project
-- Free projects are paused after about a week without activity. The
-- "Keep Supabase projects awake" GitHub Action calls this function every day,
-- which counts as activity. Run this once in the SQL Editor of each project
-- you want kept awake (it is harmless: it only returns the current time).

create or replace function public.keep_alive()
returns timestamptz
language sql
stable
as $$ select now() $$;

revoke all on function public.keep_alive() from public;
grant execute on function public.keep_alive() to anon, authenticated;

-- Make it callable through the API straight away
notify pgrst, 'reload schema';
