# Implexus Powerlifting — Gym Rankings

A static leaderboard ranking Implexus members (current and former) by their best
DOTS score from competition. Includes a fullscreen "dynamic mode" for a gym TV,
with cascading pages, rivalry cards, joke grudge matches, and weekly PB callouts.
Visitors land in dynamic mode; tapping it drops to the static board, where the
cog opens the admin screen.

## Stack

Pure HTML + CSS + vanilla JS. Zero dependencies, zero build step. The roster
lives in Supabase (talked to with plain `fetch`). The only Node code is the
daily scraper (`scripts/scrape.mjs`), which runs in GitHub Actions.

## Deploy to Vercel

1. Push this folder to a GitHub repo
2. Import the repo in [vercel.com](https://vercel.com)
3. Framework preset: **Other** (no build step needed)
4. Deploy

## Files

- `index.html`: markup
- `style.css`: all styling (light/dark via system preference)
- `config.js`: the Supabase project URL and publishable key (both public)
- `supabase.js`: a tiny Supabase REST client shared by the board and admin
- `data.js`: the lifter data (`LIFTERS` array), written by the scraper
- `changes.js`: weekly change log (previous ranks + this week's PBs), written by the scraper
- `app.js`: leaderboard + dynamic mode
- `admin.js`: the admin screen (add, edit and remove lifters)
- `supabase/setup.sql`: creates the roster table and the code-checked admin functions
- `supabase/seed.sql`: copies the original roster into Supabase (run once)
- `supabase/instant-sync.sql`: optional, refreshes the board within minutes of a change
- `scripts/scrape.mjs`: daily refresh script
- `.github/workflows/refresh.yml`: schedules the scrape

## How it fits together

- **Supabase holds the roster**: who's on the board, their name, OpenPowerlifting
  profile, Instagram and whether they're legacy. Anyone can read it; changes
  only go through database functions that check the 6-digit admin code.
- **The scraper** reads the roster, fetches everyone's numbers from
  OpenPowerlifting and writes `data.js` + `changes.js`. If Supabase isn't set
  up or can't be reached, it uses the roster already in `data.js`.
- **The page** shows `data.js`, then applies the live roster on top, so
  renames, legacy changes and removals show straight away. New lifters appear
  once the scraper has their numbers: at the next daily refresh, or within a
  few minutes with instant sync.

## Admin

On the static board, tap the cog (top right) and enter the 6-digit code. From
the dashboard you can:

- **Add a lifter**: name, OpenPowerlifting link, optional Instagram, legacy on/off
- **Edit lifters**: search, then change any of those details or remove the lifter

Thirty wrong codes in ten minutes locks admin for everyone for ten minutes,
which makes guessing impractical. To change the code, run the last statement
of `supabase/setup.sql` again with the new code in the SQL Editor. Don't commit
your real code to this repo.

## Supabase setup (one time)

1. In [supabase.com](https://supabase.com), create a **New project**. Name it
   something like `implexus-leaderboard`, pick the London region, and let it
   generate a database password (save it somewhere; the site doesn't need it).
2. Open **SQL Editor**, start a new query, and paste in `supabase/setup.sql`.
   Change `000000` on the last line to your admin code, then **Run**.
3. New query again: paste in `supabase/seed.sql` and **Run**. In
   **Table Editor → lifters** you should now see every lifter.
4. Click **Connect** (or **Project Settings → API Keys**) and copy the
   **Project URL** and the **publishable** key (`sb_publishable_…`; on older
   projects, the `anon` `public` key). Never use the secret / `service_role` key.
5. Put both into `config.js` and push. Vercel redeploys and the cog starts
   working.

The daily refresh reads from Supabase every day, which should keep a free
project from being paused for inactivity.

### Instant sync (optional)

Without this, new lifters appear after the next daily refresh. With it, any
admin change starts the refresh straight away, so they appear in a few minutes.

1. On GitHub: **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**. Repository access: only
   `implexus-leaderboard`. Permissions: **Contents: Read and write**. Note the
   expiry date; instant sync stops when the token expires.
2. In the Supabase SQL Editor, store it in Vault:
   `select vault.create_secret('github_pat_…', 'github_token');`
3. Run `supabase/instant-sync.sql` in the SQL Editor.
4. Set `instantSync: true` in `config.js` and push, so the admin screen says
   "a few minutes" instead of "within 24 hours".

To replace an expired token later:
`select vault.update_secret((select id from vault.secrets where name = 'github_token'), 'github_pat_new…');`

## Daily automatic refresh

A GitHub Action (`.github/workflows/refresh.yml`) runs the scraper every day
around midday UK time. For each lifter on the roster it fetches their OpenPowerlifting
profile, re-derives their PBs and the fed/equip/bodyweight from their best-DOTS
meet, and writes `data.js` + `changes.js` back to the repo. Vercel then
redeploys automatically.

**It is defensive:** a profile that fails to fetch or parse keeps its existing
data untouched (a brand-new lifter is simply left off until a later run reads
their profile), and if too few profiles parse (a sign OpenPowerlifting changed
their page structure) the run aborts without writing anything.

### One-time setup on GitHub

1. Commit and push the whole project, including the `.github` and `scripts`
   folders, to your repo.
2. On GitHub: **Settings → Actions → General → Workflow permissions** →
   select **Read and write permissions** → Save. (This lets the action commit
   the refreshed files.)
3. Optionally test it now: **Actions** tab → **Daily leaderboard refresh** →
   **Run workflow**. The first run just establishes a baseline — position
   arrows and PB cards start appearing from the second run onward.

### Changing the schedule

Edit the `cron` line in `.github/workflows/refresh.yml`. It's in UTC; the file
has a comment explaining the GMT/BST offset. You can also trigger it any time
from the Actions tab.

### Run the scraper locally

```bash
node scripts/scrape.mjs
```

(Requires Node 18+ for the built-in `fetch`.)

## What the refresh data drives

- **Position arrows** on the board: ▲ up / ▼ down / – no change, vs last week's
  rank. New entries show a **NEW** tag. Arrows reflect the current view
  (active-only or legacy-included).
- **PB callout cards** in dynamic mode: any lifter who improved a squat, bench,
  deadlift, total, or DOTS that week gets a celebration card in the rotation,
  noting any board jump.

## Dynamic mode

Click **Dynamic** to go fullscreen. The leaderboard toggles (legacy on/off) are
inherited at entry. Pages of 6 cascade through, then PB cards, then rivalries.
Click/tap anywhere to exit.
