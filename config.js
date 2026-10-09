// Implexus Powerlifting — Supabase connection
// Both values are public by design: the key is Supabase's "publishable" (anon)
// key, which can only read the roster. Every write goes through PIN-checked
// database functions (see supabase/setup.sql), so nothing here needs hiding.
//
// Leave url/key empty to run without Supabase: the board uses data.js as-is and
// the admin screen explains that it isn't connected yet.
//
// instantSync: set to true once supabase/instant-sync.sql has been run, so the
// admin screens promise "a few minutes" rather than "the next daily refresh".

const SUPABASE_CONFIG = {
  url: "",
  key: "",
  instantSync: false,
};
