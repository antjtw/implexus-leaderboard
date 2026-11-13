#!/usr/bin/env node
/**
 * Implexus Powerlifting — daily scraper
 *
 * Reads the roster (name, slug, ig, legacy) from Supabase, falling back to
 * data.js if Supabase isn't configured or can't be reached. For every lifter
 * it downloads their OpenPowerlifting CSV (one row per meet), derives PBs
 * (squat/bench/deadlift/total/DOTS), sex, and the fed/equip/bodyweight from the
 * meet that produced their best DOTS. If the CSV can't be read it falls back
 * to the lifter's web page. Then:
 *   - writes an updated data.js (roster details + scraped numbers)
 *   - writes changes.js (previous ranks for both views + this week's PB events)
 *
 * Defensive by design:
 *   - a profile that fails to fetch or parse keeps its EXISTING data untouched
 *   - a NEW lifter whose profile fails is left out until a later run succeeds
 *   - if too few profiles parse (looks like a site-wide breakage), it ABORTS
 *     without writing anything, so a bad run can never wipe the board.
 *
 * Run: node scripts/scrape.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_PATH = join(ROOT, "data.js");
const CONFIG_PATH = join(ROOT, "config.js");
const CHANGES_PATH = join(ROOT, "changes.js");

const BASE = "https://www.openpowerlifting.org/u/";
const CSV_BASE = "https://www.openpowerlifting.org/api/liftercsv/";
const REQUEST_DELAY_MS = 1200;        // polite gap between requests
const MIN_PARSE_RATIO = 0.6;          // abort if fewer than 60% parse OK
const DOTS_MATCH_TOLERANCE = 0.01;    // matching PB dots to a competition row

// ── Load the current LIFTERS array out of data.js ────────────────
// data.js declares `const LIFTERS = [...]` with no export, so we evaluate it
// in a tiny sandbox and capture the array.
function loadLifters() {
  const src = readFileSync(DATA_PATH, "utf8");
  // eslint-disable-next-line no-new-func
  const fn = new Function(`${src}; return LIFTERS;`);
  const lifters = fn();
  if (!Array.isArray(lifters) || lifters.length === 0) {
    throw new Error("Could not read LIFTERS from data.js");
  }
  return lifters;
}

// ── Load the roster from Supabase ────────────────────────────────
// Uses the same public URL + publishable key as the site (config.js), which
// can read the roster. SUPABASE_URL / SUPABASE_KEY env vars override them.
// Returns null (caller falls back to data.js) if unconfigured or unreachable,
// or if the table is empty, which means it hasn't been seeded yet.
function loadSupabaseConfig() {
  let cfg = {};
  try {
    const src = readFileSync(CONFIG_PATH, "utf8");
    // eslint-disable-next-line no-new-func
    cfg = new Function(`${src}; return SUPABASE_CONFIG;`)() || {};
  } catch (_) { /* no config.js: env vars only */ }
  return {
    url: (process.env.SUPABASE_URL || cfg.url || "").replace(/\/+$/, ""),
    key: process.env.SUPABASE_KEY || cfg.key || "",
  };
}

async function loadRoster() {
  const { url, key } = loadSupabaseConfig();
  if (!url || !key) {
    console.log("Supabase not configured; using the roster in data.js");
    return null;
  }
  try {
    const res = await fetch(
      `${url}/rest/v1/lifters?select=name,slug,ig,legacy&order=created_at.asc,id.asc`,
      { headers: { apikey: key } }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      console.warn("Supabase roster is empty (not seeded yet?); using data.js");
      return null;
    }
    return rows.map((r) => ({ name: r.name, slug: r.slug, ig: r.ig || null, legacy: Boolean(r.legacy) }));
  } catch (err) {
    console.warn(`Could not read roster from Supabase (${err.message}); using data.js`);
    return null;
  }
}

// Combine the roster with the numbers already in data.js. Roster fields win;
// numbers carry over by slug. A lifter with no previous numbers is new.
function mergeRoster(roster, existing) {
  const bySlug = new Map(existing.map((l) => [l.slug, l]));
  return roster.map((r) => {
    const prev = bySlug.get(r.slug);
    const merged = { ...(prev || {}), ...r };
    if (!r.legacy) delete merged.legacy;
    return merged;
  });
}

const hasNumbers = (l) => typeof l.dots === "number" && l.dots > 0;

// Load the existing CHANGES object from changes.js (for the 7-day rolling
// window). Returns a safe empty default if the file is missing or unreadable.
function loadChanges() {
  try {
    const src = readFileSync(CHANGES_PATH, "utf8");
    // eslint-disable-next-line no-new-func
    const fn = new Function(`${src}; return CHANGES;`);
    const c = fn();
    if (c && typeof c === "object") return c;
  } catch (_) { /* fall through to default */ }
  return { generated: null, baselineDate: null, prevRankActive: {}, prevRankAll: {},
           curRankActive: {}, curRankAll: {}, rosterActive: [], rosterAll: [],
           arrivals: [], departures: [], pbEvents: [] };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Fetch one profile's HTML ─────────────────────────────────────
async function fetchProfile(slug) {
  const res = await fetch(BASE + slug, {
    headers: { "User-Agent": "ImplexusLeaderboard/1.0 (gym leaderboard refresh)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// Strip HTML tags from a cell
const clean = (s) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();

// ── Parse PBs + matched meet from a profile's HTML ───────────────
// Returns { squat, bench, deadlift, total, dots, fed, equip, bodyweight }
// or throws if the structure can't be read.
function parseProfile(html) {
  // The page has a "Personal Bests" table then a "Competition Results" table.
  // Personal Bests rows: Equip | Squat | Bench | Deadlift | Total | Dots
  const pbSplit = html.split(/Personal Bests<\/h2>/i)[1];
  if (!pbSplit) throw new Error("no Personal Bests section");
  const pbBlock = pbSplit.split(/Competition Results/i)[0];

  const pbRows = [...pbBlock.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].map((m) =>
    [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => clean(c[1]))
  );

  // Collect best individual lifts across all PB rows (Raw + Wraps etc.)
  let bestSquat = 0, bestBench = 0, bestDead = 0, bestTotal = 0, bestDots = 0;
  for (const cells of pbRows) {
    if (cells.length < 6) continue;
    const sq = parseFloat(cells[1]) || 0;
    const bp = parseFloat(cells[2]) || 0;
    const dl = parseFloat(cells[3]) || 0;
    const tot = parseFloat(cells[4]) || 0;
    const dots = parseFloat(cells[5]) || 0;
    bestSquat = Math.max(bestSquat, sq);
    bestBench = Math.max(bestBench, bp);
    bestDead = Math.max(bestDead, dl);
    bestTotal = Math.max(bestTotal, tot);
    bestDots = Math.max(bestDots, dots);
  }
  if (bestDots === 0) throw new Error("no DOTS in Personal Bests");

  // Competition Results: find the row whose final DOTS == bestDots, and read
  // Fed (col 1), Equip (col 7), Weight (col 9) from it.
  const compBlock = html.split(/Competition Results/i)[1] || "";
  const compRows = [...compBlock.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].map((m) =>
    [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => clean(c[1]))
  );

  let fed = null, equip = null, bodyweight = null;
  for (const cells of compRows) {
    if (cells.length < 10) continue;
    const rowDots = parseFloat(cells[cells.length - 1]);
    if (!isFinite(rowDots)) continue;
    if (Math.abs(rowDots - bestDots) <= DOTS_MATCH_TOLERANCE) {
      fed = cells[1] || null;
      equip = cells[7] || null;
      bodyweight = cells[9] || null;
      break;
    }
  }

  return {
    squat: bestSquat,
    bench: bestBench,
    deadlift: bestDead,
    total: bestTotal,
    dots: bestDots,
    fed,
    equip,
    bodyweight,
    sexFromClasses: sexFromClasses(compRows.filter((c) => c.length >= 10).map((c) => c[8])),
  };
}

// ── Sex (for the Men / Women filter) ─────────────────────────────
// Preferred: the lifter's CSV from OpenPowerlifting, which records Sex (M/F)
// on every meet. Fallback: weight classes that only exist for one sex
// (IPF-style classes; 56/60/67.5/75 etc. are shared by men and women in
// other feds, so they're ignored). Returns "M", "F" or null.
const WOMEN_ONLY_CLASSES = new Set(["43", "47", "57", "63", "69", "76", "84", "84+"]);
const MEN_ONLY_CLASSES = new Set(["53", "59", "66", "74", "83", "93", "105", "120", "120+"]);

function sexFromClasses(classes) {
  let m = 0, f = 0;
  for (const raw of classes) {
    const c = String(raw || "").replace(/kg$/i, "").trim();
    if (WOMEN_ONLY_CLASSES.has(c)) f++;
    else if (MEN_ONLY_CLASSES.has(c)) m++;
  }
  if (m && !f) return "M";
  if (f && !m) return "F";
  return null;
}

// Minimal CSV line splitter that respects quotes (meet names contain commas)
function splitCsvLine(line) {
  const out = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// Read everything we need from a lifter's OpenPowerlifting CSV: best squat,
// bench, deadlift, total and DOTS across all their meets (any equipment), the
// fed / equipment / bodyweight of the meet with their best DOTS, and their sex.
// Disqualified (DQ), doping-disqualified (DD) and no-show (NS) meets don't
// count towards PBs. Throws if the file isn't in the expected shape, so the
// caller can fall back to the web page.
function parseCsv(csv) {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error("empty CSV");
  const head = splitCsvLine(lines[0]);
  const col = (name) => head.indexOf(name);
  const C = {
    sex: col("Sex"), equip: col("Equipment"), bw: col("BodyweightKg"),
    squat: col("Best3SquatKg"), bench: col("Best3BenchKg"), dead: col("Best3DeadliftKg"),
    total: col("TotalKg"), dots: col("Dots"), place: col("Place"), fed: col("Federation"),
  };
  for (const k of ["squat", "bench", "dead", "total", "dots"]) {
    if (C[k] < 0) throw new Error(`CSV has no ${k} column`);
  }
  const num = (cells, i) => {
    const v = parseFloat(i >= 0 ? cells[i] : "");
    return isFinite(v) && v > 0 ? v : 0;   // failed attempts are negative
  };

  let best = { squat: 0, bench: 0, deadlift: 0, total: 0, dots: 0 };
  let bestRow = null, m = 0, f = 0;
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const sex = cells[C.sex];
    if (sex === "M") m++; else if (sex === "F") f++;
    const place = (cells[C.place] || "").toUpperCase();
    if (place === "DQ" || place === "DD" || place === "NS") continue;
    best.squat = Math.max(best.squat, num(cells, C.squat));
    best.bench = Math.max(best.bench, num(cells, C.bench));
    best.deadlift = Math.max(best.deadlift, num(cells, C.dead));
    best.total = Math.max(best.total, num(cells, C.total));
    const dots = num(cells, C.dots);
    if (dots > best.dots) { best.dots = dots; bestRow = cells; }
  }
  if (best.dots === 0) throw new Error("no DOTS in CSV");

  return {
    ...best,
    fed: (bestRow[C.fed] || "").trim() || null,
    equip: (bestRow[C.equip] || "").trim() || null,
    bodyweight: (bestRow[C.bw] || "").trim() || null,
    sex: m > f ? "M" : f > m ? "F" : null,
  };
}

async function fetchCsv(slug) {
  const res = await fetch(CSV_BASE + slug, {
    headers: { "User-Agent": "ImplexusLeaderboard/1.0 (gym leaderboard refresh)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// One lifter: CSV first (one request); the web page only if the CSV fails.
async function scrapeLifter(slug) {
  let csvError;
  try {
    return { ...parseCsv(await fetchCsv(slug)), source: "csv" };
  } catch (err) {
    csvError = err.message;
  }
  await sleep(REQUEST_DELAY_MS);
  const page = parseProfile(await fetchProfile(slug));
  return { ...page, sex: page.sexFromClasses, source: "page", csvError };
}

// ── Ranking helper ───────────────────────────────────────────────
// Returns a map slug -> rank (1-based) for a DOTS-sorted list.
function rankMap(lifters) {
  const sorted = [...lifters].sort((a, b) => b.dots - a.dots);
  const map = {};
  sorted.forEach((l, i) => { map[l.slug] = i + 1; });
  return map;
}

// ── Serialise LIFTERS back into data.js (matching the hand-written style) ──
function serialiseData(lifters) {
  const line = (l) => {
    const parts = [
      `  {`,
      `    name: ${JSON.stringify(l.name)},`,
      `    slug: ${JSON.stringify(l.slug)},`,
      `    ig: ${l.ig == null ? "null" : JSON.stringify(l.ig)},`,
      `    squat: ${l.squat}, bench: ${l.bench}, deadlift: ${l.deadlift}, total: ${l.total}, dots: ${l.dots},`,
      `    fed: ${JSON.stringify(l.fed ?? null)}, equip: ${JSON.stringify(l.equip ?? null)}, bodyweight: ${l.bodyweight == null ? "null" : JSON.stringify(String(l.bodyweight))},`,
    ];
    if (l.sex) parts.push(`    sex: ${JSON.stringify(l.sex)},`);
    if (l.legacy) parts.push(`    legacy: true,`);
    parts.push(`  },`);
    return parts.join("\n");
  };

  // Preserve the active / legacy grouping in output
  const active = lifters.filter((l) => !l.legacy);
  const legacy = lifters.filter((l) => l.legacy);

  return `// Implexus Powerlifting — Leaderboard Data
// PB squat, bench, deadlift and total from OpenPowerlifting Personal Bests table.
// For lifters with Raw + Wraps entries, best DOTS row determines ranking;
// individual lift PBs are taken across both equip categories.
// legacy: true = former member, shown only when legacy filter is on.
// sex: "M" / "F" from OpenPowerlifting, for the Men / Women filter.
//
// This file is written automatically every day by scripts/scrape.mjs. Once
// Supabase is connected, the roster (who's on the board, names, Instagram,
// legacy) comes from the admin screen, and hand edits to it here are replaced.

const LIFTERS = [
  // ── ACTIVE MEMBERS ──────────────────────────────────────────
${active.map(line).join("\n")}

  // ── LEGACY MEMBERS ──────────────────────────────────────────
${legacy.map(line).join("\n")}

];
`;
}

// ── Serialise changes.js ─────────────────────────────────────────
function serialiseChanges(changes) {
  return `// Implexus Powerlifting — change log (rolling 7-day window)
// Written automatically by scripts/scrape.mjs on each daily run.
// generated:      ISO timestamp of the run that produced this file.
// baselineDate:   when the current rank baseline was set (refreshed every 7 days).
// prevRankActive / prevRankAll: slug -> rank as of baselineDate, RE-RANKED over
//   the current roster so arrivals/departures don't create phantom arrows.
//   Position arrows compare current rank against these, so only genuine
//   lifting-driven movement shows — roster logistics net to zero.
// rosterActive / rosterAll: the slugs present at this run (roster-change basis).
// arrivals / departures:    who joined / left since the baseline (stored for
//   possible future use; not displayed). Arrivals show as NEW, not as movers.
// pbEvents:       personal-best improvements from the last 7 days, each stamped
//   with the date it hit the board. Shown as callout cards in dynamic mode,
//   ageing out after 7 days. A new PB for a lifter overrides their older one.

const CHANGES = ${JSON.stringify(changes, null, 2)};
`;
}

// ── Main ─────────────────────────────────────────────────────────
const WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

// Re-rank a stored baseline (slug -> rank) over the CURRENT set of slugs.
// Keeps the baseline's relative ORDER, drops anyone no longer present, and
// renumbers 1..N. This neutralises roster changes: a lifter who leaves (or is
// legacy'd) no longer occupies a slot, so those who were below them are NOT
// credited with an upward move. Arrivals simply have no baseline entry (they
// show as NEW, not as a mover). Only genuine, lifting-driven reordering within
// the shared roster produces a rank delta.
function reRankOverRoster(baselineMap, currentSlugs) {
  const present = baselineMap
    ? Object.keys(baselineMap).filter((slug) => currentSlugs.has(slug))
    : [];
  present.sort((a, b) => baselineMap[a] - baselineMap[b]); // keep old order
  const out = {};
  present.forEach((slug, i) => { out[slug] = i + 1; });
  return out;
}

async function main() {
  const existing = loadLifters();
  const roster = await loadRoster();
  const lifters = roster ? mergeRoster(roster, existing) : existing;
  console.log(roster
    ? `Loaded ${roster.length} lifters from Supabase (${lifters.filter((l) => !hasNumbers(l)).length} new)`
    : `Loaded ${lifters.length} lifters from data.js`);

  // The board as it stood before this run: roster changes (legacy, removals)
  // applied, new lifters not yet included because they have no numbers.
  const before = lifters.filter(hasNumbers);

  const prev = loadChanges();
  const now = new Date();
  const nowISO = now.toISOString();

  // Current rosters (sets of slugs) for the active and legacy-inclusive views
  const activeSlugs = new Set(lifters.filter((l) => !l.legacy).map((l) => l.slug));
  const allSlugs = new Set(lifters.map((l) => l.slug));

  // Arrivals / departures vs the baseline roster (active view), for the record.
  // Not displayed anywhere yet, but stored in changes.js for possible future use.
  const baselineRoster = new Set(prev.rosterActive || []);
  const arrivals = [...activeSlugs].filter((s) => baselineRoster.size && !baselineRoster.has(s));
  const departures = [...baselineRoster].filter((s) => !activeSlugs.has(s));

  // Rank baseline: arrows compare CURRENT rank against a baseline that is
  // refreshed once every 7 days, so movement reflects the whole week rather
  // than just the last run. If the stored baseline is missing or older than the
  // window, we re-snapshot from today's pre-update ranks.
  const baselineAge = prev.baselineDate ? (now - new Date(prev.baselineDate)) : Infinity;
  const baselineExpired = baselineAge >= WINDOW_DAYS * DAY_MS;

  const preRankActive = rankMap(before.filter((l) => !l.legacy));
  const preRankAll = rankMap(before);

  let baselineDate, prevRankActive, prevRankAll, rosterActive, rosterAll;
  if (baselineExpired || !prev.prevRankActive || Object.keys(prev.prevRankActive).length === 0) {
    // Start a fresh 7-day window from today's pre-update ranks and roster
    baselineDate = nowISO;
    prevRankActive = preRankActive;
    prevRankAll = preRankAll;
    rosterActive = [...activeSlugs];
    rosterAll = [...allSlugs];
  } else {
    // Keep the existing baseline, but RE-RANK it over today's roster so that
    // anyone who left/joined since the baseline doesn't create phantom arrows.
    // The roster snapshot rolls forward to today's, so a departure is absorbed
    // once and never re-counted.
    baselineDate = prev.baselineDate;
    prevRankActive = reRankOverRoster(prev.prevRankActive, activeSlugs);
    prevRankAll = reRankOverRoster(prev.prevRankAll, allSlugs);
    rosterActive = [...activeSlugs];
    rosterAll = [...allSlugs];
  }

  const updated = [];
  const newPbEvents = [];
  const pending = new Set();   // new lifters whose profile couldn't be read yet
  const sources = { csv: 0, page: 0 };
  let okCount = 0;

  for (const lifter of lifters) {
    const next = { ...lifter };
    try {
      const scraped = await scrapeLifter(lifter.slug);
      sources[scraped.source]++;
      if (scraped.source === "page") {
        console.warn(`  ! ${lifter.name}: CSV unusable (${scraped.csvError}); used the web page`);
      }

      // PBs shouldn't go down. If one does, the data source disagrees with what
      // we had (or OpenPowerlifting corrected a result): say so in the log.
      for (const k of ["squat", "bench", "deadlift", "total", "dots"]) {
        if ((lifter[k] || 0) > 0 && scraped[k] < lifter[k] - 0.01) {
          console.warn(`  ? ${lifter.name}: ${k} ${lifter[k]} -> ${scraped[k]} (lower than before, from ${scraped.source})`);
        }
      }

      // Detect genuine PB improvements in the actual lifts.
      // A DOTS change on its own does NOT count — OpenPowerlifting can recompute
      // DOTS to a slightly different precision than we have stored, which would
      // otherwise flag everyone as a "PB" every run. We only celebrate when a
      // squat/bench/deadlift/total actually goes UP by a meaningful margin.
      const EPS = 0.01; // ignore sub-kg float noise
      const improved = {};
      for (const k of ["squat", "bench", "deadlift", "total"]) {
        const prev = lifter[k] || 0;
        if (prev > 0 && scraped[k] > prev + EPS) {
          improved[k] = { from: prev, to: scraped[k] };
        }
      }

      // Only a real lift improvement generates a card. DOTS is shown on the
      // card for context but never triggers one by itself.
      if (Object.keys(improved).length > 0) {
        newPbEvents.push({
          slug: lifter.slug,
          name: lifter.name,
          improved,                                   // {lift: {from,to}}
          dots: { from: lifter.dots || 0, to: scraped.dots },
          date: nowISO,                               // when this PB hit the board
        });
      }

      // Apply scraped numbers; keep fed/equip/bodyweight only if found
      next.squat = scraped.squat;
      next.bench = scraped.bench;
      next.deadlift = scraped.deadlift;
      next.total = scraped.total;
      next.dots = scraped.dots;
      if (scraped.fed) next.fed = scraped.fed;
      if (scraped.equip) next.equip = scraped.equip;
      if (scraped.bodyweight) next.bodyweight = scraped.bodyweight;

      // Sex for the Men / Women filter: from the CSV (or weight classes on the
      // web-page fallback), else keep whatever we had
      const sex = scraped.sex || lifter.sex || null;
      if (sex) next.sex = sex; else delete next.sex;

      okCount++;
      console.log(`  ✓ ${lifter.name} (${scraped.dots})`);
    } catch (err) {
      if (!hasNumbers(lifter)) {
        // New lifter with nothing to show yet: leave them off this run's board
        console.warn(`  ! ${lifter.name}: ${err.message} (new lifter, not added yet)`);
        pending.add(lifter.slug);
        await sleep(REQUEST_DELAY_MS);
        continue;
      }
      // Keep existing data untouched on any failure
      console.warn(`  ! ${lifter.name}: ${err.message} (kept existing data)`);
    }
    updated.push(next);
    await sleep(REQUEST_DELAY_MS);
  }

  // Safety valve: if too few parsed, something is broken site-wide. Abort.
  const ratio = okCount / lifters.length;
  if (ratio < MIN_PARSE_RATIO) {
    console.error(
      `ABORT: only ${okCount}/${lifters.length} profiles parsed (${(ratio * 100).toFixed(0)}%). ` +
      `Refusing to write — leaving data.js and changes.js untouched.`
    );
    process.exit(1);
  }

  // Lifters left off the board this run aren't part of the roster yet
  for (const slug of pending) { activeSlugs.delete(slug); allSlugs.delete(slug); }
  rosterActive = rosterActive.filter((slug) => !pending.has(slug));
  rosterAll = rosterAll.filter((slug) => !pending.has(slug));

  // Compute new ranks AFTER updating
  const newRankActive = rankMap(updated.filter((l) => !l.legacy));
  const newRankAll = rankMap(updated);

  // ── Arrow ranks: compare like-for-like over the SHARED roster ──
  // To stop arrivals from pushing others "down" (and departures pulling others
  // "up"), both the baseline and the current ranks used for arrows are computed
  // over only the lifters present in BOTH. An arrival isn't in the baseline, so
  // it's excluded here and shows as NEW; a departure isn't current, so it's
  // gone from both. The result: arrows reflect only lifting-driven reordering.
  const sharedActive = new Set(
    Object.keys(prevRankActive).filter((s) => activeSlugs.has(s))
  );
  const sharedAll = new Set(
    Object.keys(prevRankAll).filter((s) => allSlugs.has(s))
  );
  // Re-rank current order over the shared set
  const curRankActive = reRankOverRoster(newRankActive, sharedActive);
  const curRankAll = reRankOverRoster(newRankAll, sharedAll);
  // And re-rank the (already roster-trimmed) baseline over the same shared set
  const arrowPrevActive = reRankOverRoster(prevRankActive, sharedActive);
  const arrowPrevAll = reRankOverRoster(prevRankAll, sharedAll);

  // ── Build the rolling 7-day PB window ──────────────────────────
  // Start from existing events still inside the window, then layer this run's
  // new PBs on top. New PBs override any existing event for the same lifter
  // (a fresh PB replaces their older one — the common, expected case).
  const cutoff = now - WINDOW_DAYS * DAY_MS;
  const survivors = (prev.pbEvents || []).filter((ev) => {
    const t = ev.date ? new Date(ev.date).getTime() : 0;
    return t >= cutoff;
  });

  const bySlug = new Map();
  for (const ev of survivors) bySlug.set(ev.slug, ev);   // keep recent
  for (const ev of newPbEvents) bySlug.set(ev.slug, ev); // new overrides

  const pbEvents = [...bySlug.values()];

  // (Re)compute rank movement for every event in the window over the SHARED
  // roster, so "Up N places" reflects genuine lifting movement, not roster shifts.
  for (const ev of pbEvents) {
    const before = arrowPrevActive[ev.slug];
    const after = curRankActive[ev.slug];
    if (before != null && after != null && after < before) {
      ev.placesUp = before - after;
    } else {
      delete ev.placesUp;
    }
  }

  const changes = {
    generated: nowISO,
    baselineDate,         // when the current 7-day rank baseline was set
    prevRankActive: arrowPrevActive,  // arrow baseline, ranked over shared roster
    prevRankAll: arrowPrevAll,
    curRankActive,        // current ranks over shared roster (arrow compares to prev)
    curRankAll,
    rosterActive,         // active slugs as of this run (for roster-change detection)
    rosterAll,
    arrivals: arrivals.filter((slug) => !pending.has(slug)),  // active slugs new since baseline (shown as NEW, not movers)
    departures,           // slugs that left/were legacy'd since the baseline
    pbEvents,             // rolling 7-day window of PBs
  };

  writeFileSync(DATA_PATH, serialiseData(updated), "utf8");
  writeFileSync(CHANGES_PATH, serialiseChanges(changes), "utf8");

  console.log(
    `\nDone. ${okCount}/${lifters.length} refreshed, ` +
    `${pbEvents.length} PB event(s) this week.` +
    ` Read from CSV: ${sources.csv}, web page fallback: ${sources.page}.` +
    (pending.size ? ` Not added yet: ${[...pending].join(", ")}.` : "")
  );
}

main().catch((err) => {
  console.error("Scraper failed:", err);
  process.exit(1);
});
