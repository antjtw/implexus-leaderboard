// Implexus Powerlifting — Leaderboard Renderer

(function () {

  // ── Config ────────────────────────────────────────────────────
  // ?lite in the address turns off every animation and fade on the TV, for
  // weak TV browsers. The daily reload keeps the address, so it sticks.
  const LITE = /[?&]lite\b/.test(window.location.search);
  if (LITE) document.documentElement.classList.add("lite");

  const CONFIG = {
    rivalry_count:      12,      // size of the eligible pool to sample from
    rivalries_per_break:6,       // how many rivalries shown between each list page-pass
    per_page:           7,       // lifters shown per leaderboard page
    page_hold_ms:       8000,    // total time each page is shown (incl. cascade)
    page_fade_ms:       400,     // fade-out of the previous page
    cascade_stagger_ms: 60,      // delay between each row cascading in
    rivalry_hold_ms:    9000,    // how long each rivalry card holds
    comp_hold_ms:       13000,   // how long an upcoming-competition card holds
    refresh_ms:         15 * 60 * 1000, // re-read roster + competitions (always-on TV)
    joke_chance_each:   0.0021,  // 0.21% chance per joke rivalry, per check
  };

  // ── State ─────────────────────────────────────────────────────
  let showLegacy = false;
  let dynamicActive = false;
  let dynamicPlaylist = [];   // [{type:'page'} | {type:'rivalry'} | {type:'pb'}]
  let playlistIndex = 0;
  let scrollRAF = null;
  let holdTimeout = null;
  let overlay = null;
  let pbCursor = 0;           // rotates through PB events, one shown per cycle
  let competitions = [];      // upcoming competitions from Supabase, soonest first
  let compCursor = 0;         // rotates through them, one shown per cycle
  let rosterById = new Map(); // Supabase id -> roster row, to link entries to lifters

  // ── Formatters ───────────────────────────────────────────────
  function fmt(val) {
    return val % 1 === 0 ? val.toFixed(0) : val.toFixed(1);
  }
  function fmtDots(val) { return val.toFixed(2); }

  // Names can come from the admin screen, so never trust them as HTML
  function esc(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  }

  // ── Sparse-page captions ──────────────────────────────────────
  // Shown centred below the rows on a final leaderboard page with ≤4 lifters.
  // One picked at random, fresh each time a sparse page appears.
  const SPARSE_CAPTIONS = [
    // Deadpan
    { text: "Please return all plates. They will not do it themselves." },
    { text: "If you can read this, you're resting between sets. Probably long enough now." },
    { text: "Depth was judged. Feelings were not." },
    { text: "Was it worth sacrificing your social life to become this mediocre?" },
    // Inspiring
    { text: "The iron never lies to you.", credit: "Henry Rollins" },
    { text: "Stronger people are harder to kill, and more useful generally.", credit: "Mark Rippetoe" },
    // In-jokes
    { text: "Joe lives in Bradford." },
    { text: "Mike has bombed out of a competition. OpenPowerlifting just doesn't know about it." },
  ];

  function pickSparseCaption() {
    return SPARSE_CAPTIONS[Math.floor(Math.random() * SPARSE_CAPTIONS.length)];
  }

  // Inline Implexus logo for dynamic mode. White letterforms use currentColor
  // (set via CSS) so they can be muted; the yellow accent paths stay #FFD500.
  const LOGO_SVG = `<svg viewBox="0 0 159 20" fill="none" xmlns="http://www.w3.org/2000/svg" class="dyn-logo" aria-label="Implexus">
    <path d="M43.5261 19.9761C44.6825 19.9761 45.6133 19 45.6133 17.8024V3.98802C45.6302 3.98802 45.7189 3.98789 45.8676 3.98765C47.0959 3.98572 52.418 3.97734 55.1361 3.98802C56.4139 3.99401 57.2639 4.89222 57.206 6.12575C57.154 7.22156 56.3041 8.01198 55.1188 8.01198H49.2559C48.2094 8.08982 47.3826 8.9521 47.319 10.0359V12C47.7762 12.001 48.2335 12.0023 48.691 12.0037C50.9817 12.0103 53.2757 12.017 55.5698 11.982C58.6688 11.9401 61.236 9.00599 61.0626 5.79641C60.8717 2.40719 58.4665 0.0179641 55.1708 0H43.8788C42.7166 0 41.7799 0.976048 41.7799 2.17365V19.9761H43.5261Z" fill="currentColor"/>
    <path d="M9.25102 19.9701H5.40028V0.0419031H7.1522C8.26232 0.0419031 9.17008 0.910167 9.26837 2.01196C10.5288 1.02394 12.009 0.341304 13.5585 0.125735C17.1722 -0.371271 20.1325 0.838311 22.5147 3.66466C22.5484 3.70425 22.5821 3.74293 22.6172 3.78317C22.6724 3.84639 22.7309 3.91351 22.798 3.994C22.9183 3.86181 23.0347 3.72902 23.1499 3.59751C23.3999 3.31203 23.6447 3.0326 23.9139 2.77843C26.6661 0.179627 29.8635 -0.598816 33.4135 0.485017C37.0099 1.57484 39.155 4.25148 40.0165 8.00598C40.1668 8.65867 40.2015 9.3473 40.2015 10.0239C40.2118 12.8887 40.2036 18.4883 40.2018 19.7306L40.2015 19.976H38.4554C37.2932 19.976 36.3565 19 36.3565 17.8024C36.3565 17.8024 36.3623 13.1677 36.345 10.0659C36.3334 7.15568 34.5063 4.80238 31.8004 4.1437C28.3891 3.31735 24.7523 6.16167 24.7523 9.78442V19.9701H20.8668V9.65867C20.8668 6.83232 19.0687 4.85029 16.4206 4.16765C12.8994 3.25747 9.30884 6.21556 9.25102 9.97604C9.24708 10.3106 9.24851 13.4771 9.24982 16.3819L9.24982 16.3904C9.25044 17.7463 9.25102 19.0444 9.25102 19.9701Z" fill="currentColor"/>
    <path d="M0 17.7844V0.0239389H3.81605V19.9581H2.09883C0.936666 19.9581 0 18.982 0 17.7844Z" fill="currentColor"/>
    <path d="M77.0899 19.9521C78.2348 19.9401 79.2061 19.0239 79.2061 17.8323V16.006H68.8623C67.2434 16.006 66.538 15.2695 66.538 13.5988V0.0239389H62.6583V14.1018C62.6583 17.5329 65.266 19.9341 68.5848 19.9581H77.0957L77.0899 19.9521Z" fill="currentColor"/>
    <path d="M85.9016 19.9641C82.8661 19.9641 80.4377 17.6048 80.2873 14.4491C80.1897 12.3582 80.2045 10.2603 80.2192 8.16348V8.16249C80.2237 7.52732 80.2282 6.89224 80.2295 6.25748C80.2353 2.55688 82.7331 -0.00599213 86.3121 0.0119719C90.1627 0.0280524 97.553 0.0153442 99.2056 0.0125023L99.5352 0.0119719V3.98203H86.5433C86.2658 3.98203 85.9825 3.99401 85.705 4.03593C84.9071 4.15569 84.2132 4.82036 84.1439 5.63473C84.1004 6.1546 84.1109 6.68287 84.122 7.23484C84.1271 7.4903 84.1323 7.75083 84.1323 8.01796H95.6787V12H84.1092V13.5868C84.1092 15.2934 84.8088 16.018 86.4682 16.018H99.541V17.8383C99.541 19.018 98.6044 19.9281 97.4769 19.9641H85.9016Z" fill="currentColor"/>
    <path d="M150.861 16.2934C148.236 16.2934 146.38 15.4491 144.68 13.7904V13.7964L141.94 16.491C144.449 18.8383 147.386 19.994 150.555 19.994C155.111 19.994 158.667 17.8024 158.667 13.988C158.667 10.8683 157.048 8.4012 152.989 8.13174L149.745 7.89821C147.774 7.74252 147.155 6.89222 147.155 6.04791C147.155 4.7006 148.005 3.7006 150.514 3.7006C152.642 3.7006 154.226 4.43114 155.77 5.50898L158.204 2.65868C156.273 1.04192 153.954 0 150.514 0C146.38 0 143.212 2.04192 143.212 6.01198C143.212 9.35928 145.611 11.2874 148.855 11.5569L152.33 11.8623C153.683 11.982 154.723 12.4072 154.723 13.7904C154.723 15.4491 153.104 16.2934 150.861 16.2934Z" fill="currentColor"/>
    <path d="M122.16 0.0359208V0.31137L122.154 0.317358C122.162 1.47523 122.159 2.63177 122.157 3.78764C122.151 6.09883 122.146 8.40736 122.223 10.7186C122.374 15.2934 126.005 19.2934 130.393 19.9042C130.867 19.9701 131.341 20 131.81 20C136.331 19.994 140.182 16.8862 141.252 12.1617C141.419 11.4132 141.483 10.6228 141.489 9.85628C141.51 7.56117 141.506 5.2629 141.503 2.96606C141.502 2.10483 141.5 1.24381 141.5 0.383226V0.0299328H137.621C137.621 0.0559604 137.621 0.166053 137.621 0.345308C137.625 1.73318 137.64 7.26703 137.615 10.0299C137.592 12.9162 135.759 15.2275 133.059 15.8683C132.625 15.976 131.729 16.018 131.526 16.018C128.52 16.018 126.097 13.4671 126.051 10.2216C126.021 8.10401 126.026 6.04104 126.03 3.95273C126.032 3.18875 126.034 2.42138 126.034 1.6467C126.034 0.904185 125.195 0.0359208 124.403 0.0359208H122.16Z" fill="currentColor"/>
    <path d="M111.272 7.91019C103.901 7.35931 105.092 0.0179816 105.092 0.0179816H101.293C100.397 3.35931 102.999 11.491 110.266 11.8922C117.557 12.2934 116.702 19.9581 116.702 19.9581H120.5C121.009 15.1198 118.644 8.46108 111.272 7.91019Z" fill="#FFD500"/>
    <path d="M117.945 8.79641C120.107 6.40719 120.836 3.43716 120.5 0.0179816H116.702C116.702 0.229997 116.703 0.441354 116.704 0.652236C116.707 1.07272 116.709 1.49145 116.702 1.91018C116.661 3.91619 115.765 5.68267 114.354 6.78444C115.667 7.20961 116.864 7.87427 117.945 8.79641Z" fill="#FFD500"/>
    <path d="M103.883 11.1557C101.709 13.5449 100.946 16.509 101.287 19.9521H105.103C105.103 19.6992 105.098 19.4468 105.092 19.1953C105.081 18.6669 105.07 18.1421 105.109 17.6228C105.254 15.7545 106.144 14.1617 107.451 13.1497C106.15 12.7305 104.953 12.0659 103.883 11.1497V11.1557Z" fill="#FFD500"/>
  </svg>`;

  // ── Lookup a real lifter by slug ──────────────────────────────
  function bySlug(slug) {
    return LIFTERS.find(l => l.slug === slug) || null;
  }

  // Build a fighter object from a real lifter, or a fake one.
  // Fakes carry their own name/dots/meta and a `fake: true` flag.
  function realFighter(slug, overrides = {}) {
    const l = bySlug(slug);
    if (!l) return null;
    return { ...l, ...overrides };
  }

  // ── Joke rivalries ────────────────────────────────────────────
  // These rotate in at random with a tiny per-item chance, in any mode.
  // Each: { build() -> {a, b, caption} } so real stats are resolved live.
  const JOKE_RIVALRIES = [
    {
      id: "will-nat-patience",
      build: () => ({
        a: realFighter("williamwebb1"),
        b: { name: "Nat Robinson", dots: 389.67, fed: "BPU", equip: "Raw", bodyweight: "88.5", fake: true },
        caption: "Nat can pull 252.5 and coaches Will every week. The lifting is the easy part. Nat's patience is the real PR.",
      }),
    },
    {
      id: "joe-refs",
      build: () => ({
        a: realFighter("joecurzon"),
        b: { name: "WRPF Referees", dots: 999.99, fed: "Panel", equip: "Eagle-Eyed", bodyweight: "∞", fake: true },
        caption: "Joe has never missed depth. The three red lights are a conspiracy. Especially her.",
      }),
    },
    {
      id: "wylie-julien",
      build: () => ({
        a: realFighter("wyliesung"),
        b: { name: "Julien Borg", dots: 571.83, fed: "GPU", equip: "Wraps", bodyweight: "92.2", fake: true },
        caption: "The European yardstick. 9.30 in it. Wylie's coming for it.",
      }),
    },
    {
      id: "mike-brett",
      build: () => ({
        a: realFighter("mikejones1"),
        b: { name: "Brett Brooks", dots: 536.13, fed: "BPU", equip: "Wraps", bodyweight: "109.4", fake: true },
        caption: "Brett's ahead. By 0.50. Mike does not want to talk about it.",
      }),
    },
    {
      id: "chris-image",
      build: () => ({
        a: realFighter("chrisjennings"),
        b: { name: "That Final Deadlift", dots: 0, fed: "British Champs", equip: "1st & A Record", bodyweight: "66kg Class", fake: true,
             image: "img/chris-deadlift.jpeg" },
        caption: "One rep from 1st place and a 66kg-class deadlift record. It got away. Chris has not forgotten.",
      }),
    },];

  // Roll for a joke rivalry. Returns a built joke or null.
  function rollJokeRivalry() {
    const candidates = [];
    for (const j of JOKE_RIVALRIES) {
      if (Math.random() < CONFIG.joke_chance_each) candidates.push(j);
    }
    if (!candidates.length) return null;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    const built = pick.build();
    if (!built.a || !built.b) return null; // a real lifter was missing
    return built;
  }

  // ── Live roster (Supabase) ───────────────────────────────────
  // data.js holds the numbers from the last scrape. The roster in Supabase is
  // the source of truth for WHO is on the board and how they appear, so admin
  // edits show straight away: renames, legacy changes and removals apply on
  // top of data.js here. New lifters appear once the scraper has their numbers.
  const SCRAPED = LIFTERS.map(l => ({ ...l }));
  const scrapedSlugs = new Set(SCRAPED.map(l => l.slug));

  function applyRoster(roster) {
    if (!Array.isArray(roster) || roster.length === 0) return; // not seeded: keep data.js
    rosterById = new Map(roster.map(r => [r.id, r]));
    const bySlugScraped = new Map(SCRAPED.map(l => [l.slug, l]));
    const next = [];
    for (const r of roster) {
      const base = bySlugScraped.get(r.slug);
      if (!base) continue; // waiting for the scraper
      const l = { ...base, name: r.name, ig: r.ig || null };
      if (r.legacy) l.legacy = true; else delete l.legacy;
      next.push(l);
    }
    LIFTERS.splice(0, LIFTERS.length, ...next);
    render();
    if (dynamicActive) {
      // Carry on from the same point with a playlist built from the new list
      dynamicPlaylist = buildPlaylist(getList());
      playlistIndex = Math.min(playlistIndex, dynamicPlaylist.length);
    }
  }

  function loadRoster() {
    if (typeof ImplexusDB === "undefined" || !ImplexusDB.configured) return Promise.resolve(null);
    return ImplexusDB.listLifters(6000)
      .then(roster => { applyRoster(roster); return roster; })
      .catch(() => null); // offline or unreachable: data.js stands
  }

  // ── Competitions (Supabase) ──────────────────────────────────
  // Today's date as it is in the UK, as "YYYY-MM-DD"
  function ukToday() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  }

  // Whole days from today (UK) to a "YYYY-MM-DD" date
  function daysUntil(dateStr) {
    const toUTC = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
    return Math.round((toUTC(dateStr) - toUTC(ukToday())) / 86400000);
  }

  function applyCompetitions(rows) {
    if (!Array.isArray(rows)) return;
    const today = ukToday();
    competitions = rows.filter(c => c.date >= today);
    if (dynamicActive) {
      // Fold them into the cycle that's already running
      dynamicPlaylist = buildPlaylist(getList());
      playlistIndex = Math.min(playlistIndex, dynamicPlaylist.length);
    }
  }

  function loadCompetitions() {
    if (typeof ImplexusDB === "undefined" || !ImplexusDB.configured) return Promise.resolve(null);
    return ImplexusDB.listCompetitions(ukToday(), 6000)
      .then(rows => { applyCompetitions(rows); return rows; })
      .catch(() => null); // unreachable: no competition cards this time
  }

  // Used by admin.js to refresh the board behind it after a change
  window.ImplexusBoard = {
    applyRoster,
    applyCompetitions,
    hasNumbers: slug => scrapedSlugs.has(slug),
  };

  // ── Data helpers ─────────────────────────────────────────────
  // The board's lifters in order. Both views use it, so the TV shows whatever
  // sort and men/women filter was last chosen on the list view (this device).
  function getList() {
    const list = getStaticList();
    if (list.length) return list;
    // A filter that leaves no one would blank the TV: show everyone instead
    return (showLegacy ? [...LIFTERS] : LIFTERS.filter(l => !l.legacy)).sort((a, b) => b.dots - a.dots);
  }

  // ── Recent PBs: which figures went up in the last 7 days ─────
  // From the PB events in changes.js; used for the small green arrows.
  function recentPbs(slug) {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const out = {};
    (CH.pbEvents || []).forEach(ev => {
      if (ev.slug !== slug || !ev.date || new Date(ev.date).getTime() < cutoff) return;
      Object.keys(ev.improved || {}).forEach(k => { out[k] = true; });
      if (ev.dots && ev.dots.to > ev.dots.from + 0.005) out.dots = true;
    });
    return out;
  }

  function pbArrow(pbs, key) {
    return pbs[key] ? `<span class="pb-up" title="New PB this week" aria-label="new PB this week">▲</span>` : "";
  }

  // Shown on the TV page when the list isn't the default DOTS / everyone
  function viewLabel() {
    const parts = [];
    if (sortKey !== "dots") parts.push(SORTS[sortKey].label);
    if (sexFilter !== "all") parts.push(SEXES[sexFilter]);
    return parts.join(" · ");
  }

  // Weekly change data (from changes.js). Falls back gracefully if absent.
  const CH = (typeof CHANGES !== "undefined" && CHANGES) ? CHANGES : {
    prevRankActive: {}, prevRankAll: {}, curRankActive: {}, curRankAll: {}, pbEvents: []
  };

  // Movement arrow for a lifter at a given current rank, relative to last week.
  // Uses the previous-rank map for whichever view is active. Returns HTML.
  function movementArrow(slug, currentRank) {
    // Arrows compare the scraper's shared-roster ranks: curRank vs prevRank,
    // both computed over only the lifters present at baseline AND now. This
    // means a lifter who joined or left since the baseline never shifts anyone
    // else's arrow — only genuine lifting-driven reordering shows movement.
    const prevMap = showLegacy ? CH.prevRankAll : CH.prevRankActive;
    const curMap  = showLegacy ? CH.curRankAll  : CH.curRankActive;
    const prev = prevMap ? prevMap[slug] : undefined;
    const cur  = curMap  ? curMap[slug]  : undefined;

    if (prev == null) {
      // Not in the baseline: a new arrival. Flag NEW only if a baseline exists.
      const hasBaseline = prevMap && Object.keys(prevMap).length > 0;
      return hasBaseline
        ? `<span class="move move-new" title="New entry">NEW</span>`
        : "";
    }
    if (cur == null) return ""; // shouldn't happen, but fail quiet

    const delta = prev - cur; // positive = moved up
    if (delta > 0) {
      return `<span class="move move-up" title="Up ${delta} this week">▲<span class="move-num">${delta}</span></span>`;
    }
    if (delta < 0) {
      return `<span class="move move-down" title="Down ${-delta} this week">▼<span class="move-num">${-delta}</span></span>`;
    }
    return `<span class="move move-same" title="No change">–</span>`;
  }

  function getRivalries(list) {
    // Find ALL pairs within the DOTS threshold of each other (not just adjacent ranks)
    const pairs = [];
    for (let i = 0; i < list.length - 1; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const gap = list[i].dots - list[j].dots;
        if (gap <= 10) pairs.push({ a: list[i], b: list[j], gap });
      }
    }
    // Randomly sample from the full eligible pool so the selection differs each run,
    // rather than always surfacing the same closest/highest-ranked pairs.
    const shuffled = shuffle(pairs);
    return shuffled.slice(0, CONFIG.rivalry_count);
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function buildPlaylist(list) {
    // One cycle:  leaderboard pages  ->  N rivalries  ->  ONE PB card (if any).
    // The PB shown rotates each cycle via pbCursor, so over several loops the
    // board works through all of the week's PBs without ever showing more than
    // one at a time. Rivalries stay the main event. nextSlide() rebuilds a
    // fresh cycle each loop so rivalries re-shuffle.
    const pl = [];
    const per = CONFIG.per_page;
    const pageCount = Math.ceil(list.length / per);
    for (let p = 0; p < pageCount; p++) {
      pl.push({ type: 'page', pageIndex: p, pageCount });
    }

    const rivalries = shuffle(getRivalries(list)).slice(0, CONFIG.rivalries_per_break);
    for (const r of rivalries) pl.push({ type: 'rivalry', ...r });

    // One upcoming competition after the rivalries, rotating each cycle
    if (competitions.length) {
      const comp = competitions[compCursor % competitions.length];
      compCursor++;
      pl.push({ type: 'comp', comp });
    }

    // PB events for lifters visible in the current view (respects legacy toggle)
    const visibleSlugs = new Set(list.map(l => l.slug));
    const pbEvents = (CH.pbEvents || []).filter(ev => visibleSlugs.has(ev.slug));
    if (pbEvents.length) {
      const ev = pbEvents[pbCursor % pbEvents.length];
      pbCursor++;                                   // advance for next cycle
      pl.push({ type: 'pb', ev });
    }

    return pl;
  }

  // ── Normal leaderboard render ─────────────────────────────────
  function igLink(handle) {
    if (!handle) return "";
    return `<a class="ig-link" href="https://instagram.com/${handle}/" target="_blank" rel="noopener" aria-label="@${handle}">
      <svg class="ig-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="2" y="2" width="20" height="20" rx="5" ry="5" fill="none" stroke="currentColor" stroke-width="2"/>
        <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/>
        <circle cx="17.5" cy="6.5" r="1.2" fill="currentColor"/>
      </svg>
    </a>`;
  }

  function statItem(label, value, extraClass) {
    return `<div class="stat-item">
      <span class="stat-label">${label}</span>
      <span class="stat-value${extraClass ? " " + extraClass : ""}">${value}</span>
    </div>`;
  }

  function barWidth(dots, min, max) {
    return 30 + ((dots - min) / (max - min || 1)) * 70;
  }

  // ── Static board: sort + filter ──────────────────────────────
  // Only the static board uses these; the TV always shows DOTS, everyone.
  const SORTS = {
    dots:     { label: "DOTS",     get: l => l.dots },
    total:    { label: "Total",    get: l => l.total },
    squat:    { label: "Squat",    get: l => l.squat },
    bench:    { label: "Bench",    get: l => l.bench },
    deadlift: { label: "Deadlift", get: l => l.deadlift },
  };
  const SEXES = { all: "Everyone", M: "Men", F: "Women" };
  let sortKey = "dots";
  let sexFilter = "all";

  function getStaticList() {
    const get = SORTS[sortKey].get;
    // Men / Women only applies once the data has lifters' sex
    const bySex = sexFilter !== "all" && LIFTERS.some(l => l.sex);
    return (showLegacy ? [...LIFTERS] : LIFTERS.filter(l => !l.legacy))
      .filter(l => !bySex || l.sex === sexFilter)
      .sort((a, b) => (get(b) || 0) - (get(a) || 0) || b.dots - a.dots);
  }

  function renderRow(lifter, rank, min, max) {
    const isTop3 = rank <= 3;
    const rankClass = rank === 1 ? "rank-gold" : rank === 2 ? "rank-silver" : rank === 3 ? "rank-bronze" : "";
    const rowClass = [rank === 1 ? "row-first" : "", lifter.legacy ? "row-legacy" : ""].filter(Boolean).join(" ");
    const legacyBadge = lifter.legacy ? `<span class="legacy-badge">Legacy</span>` : "";
    // Arrows track the weekly DOTS ranking of everyone, so only show them there
    const arrows = sortKey === "dots" && sexFilter === "all";
    // The figure the board is sorted by gets the yellow treatment
    const hl = key => key === sortKey ? (isTop3 ? " dots-highlight is-sorted" : " is-sorted") : "";
    const pbs = recentPbs(lifter.slug);
    const v = (key, text) => text + pbArrow(pbs, key);

    return `
    <article class="lb-row ${rowClass}" data-rank="${rank}">
      <div class="bar-bg" style="width:${barWidth(SORTS[sortKey].get(lifter) || 0, min, max)}%"></div>
      <div class="row-inner">
        <span class="col-rank ${rankClass}">${rank}${arrows ? movementArrow(lifter.slug, rank) : ""}</span>
        <div class="col-name-wrap">
          <div class="name-line">
            <a class="athlete-name" href="https://www.openpowerlifting.org/u/${lifter.slug}" target="_blank" rel="noopener">${esc(lifter.name)}</a>
            ${legacyBadge}${igLink(lifter.ig)}
          </div>
        </div>
        <span class="col-lift desktop-only${hl("squat")}">${v("squat", fmt(lifter.squat))}</span>
        <span class="col-lift desktop-only${hl("bench")}">${v("bench", fmt(lifter.bench))}</span>
        <span class="col-lift desktop-only${hl("deadlift")}">${v("deadlift", fmt(lifter.deadlift))}</span>
        <span class="col-total desktop-only${hl("total")}">${v("total", fmt(lifter.total))}</span>
        <span class="col-dots desktop-only${hl("dots")}">${v("dots", fmtDots(lifter.dots))}</span>
        <div class="stats-mobile mobile-only">
          ${statItem("SQ",    v("squat", fmt(lifter.squat)), hl("squat"))}
          <div class="sep"></div>
          ${statItem("BP",    v("bench", fmt(lifter.bench)), hl("bench"))}
          <div class="sep"></div>
          ${statItem("DL",    v("deadlift", fmt(lifter.deadlift)), hl("deadlift"))}
          <div class="sep"></div>
          ${statItem("Total", v("total", fmt(lifter.total)), hl("total"))}
          <div class="sep"></div>
          ${statItem("DOTS",  v("dots", fmtDots(lifter.dots)), "dots-val" + hl("dots"))}
        </div>
      </div>
    </article>`;
  }

  let staticDirty = false;   // list view changed while hidden behind the TV

  function render() {
    // The list view is hidden in dynamic mode, so build it when it's next seen
    if (dynamicActive) { staticDirty = true; paintControls(); return; }
    const container = document.getElementById("leaderboard");
    if (!container) return;
    paintControls();
    const list = getStaticList();
    if (!list.length) {
      container.innerHTML = `<p class="board-empty">No lifters match this filter yet.</p>`;
      return;
    }
    const vals = list.map(l => SORTS[sortKey].get(l) || 0);
    const min = Math.min(...vals), max = Math.max(...vals);
    container.innerHTML = list.map((l, i) => renderRow(l, i + 1, min, max)).join("");
    container.querySelectorAll(".lb-row").forEach((row, i) => {
      row.style.animationDelay = `${Math.min(i, 20) * 25}ms`;
    });
  }

  // Keep the buttons, column headers and the screen-reader summary in step
  function paintControls() {
    document.querySelectorAll("[data-sort]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.sort === sortKey)));
    document.querySelectorAll("[data-sex]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.sex === sexFilter)));
    document.querySelectorAll(".table-header [data-col]").forEach(h => h.classList.toggle("is-sorted", h.dataset.col === sortKey));
    // Men / Women only appears once the refresh has found lifters' sex
    const sexGroup = document.getElementById("sex-filter");
    if (sexGroup) sexGroup.hidden = !LIFTERS.some(l => l.sex);
    const status = document.getElementById("board-status");
    if (status) status.textContent = `Ranked by ${SORTS[sortKey].label}, ${SEXES[sexFilter].toLowerCase()}.`;
  }

  function initBoardControls() {
    try {
      const saved = JSON.parse(localStorage.getItem("implexus-board") || "{}");
      if (SORTS[saved.sort]) sortKey = saved.sort;
      if (SEXES[saved.sex]) sexFilter = saved.sex;
    } catch (_) { /* no storage: defaults */ }
    const save = () => {
      try { localStorage.setItem("implexus-board", JSON.stringify({ sort: sortKey, sex: sexFilter })); } catch (_) {}
    };
    document.querySelectorAll("[data-sort]").forEach(b => b.addEventListener("click", () => {
      sortKey = b.dataset.sort; save(); render();
    }));
    document.querySelectorAll("[data-sex]").forEach(b => b.addEventListener("click", () => {
      sexFilter = b.dataset.sex; save(); render();
    }));
  }

  // ── Dynamic mode ──────────────────────────────────────────────

  if (LITE) { CONFIG.page_fade_ms = 0; CONFIG.cascade_stagger_ms = 0; }

  function createOverlay() {
    const el = document.createElement("div");
    el.id = "dynamic-overlay";
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", "Click to exit dynamic mode");
    document.body.appendChild(el);
    el.addEventListener("click", exitDynamic);
    return el;
  }

  function clearDynamic() {
    cancelAnimationFrame(scrollRAF);
    clearTimeout(holdTimeout);
    scrollRAF = null;
    holdTimeout = null;
  }

  // Persistent overlay footer: last-updated (bottom-left) + exit hint
  // (bottom-right). Included in every slide's markup so it survives the
  // innerHTML swaps, and excluded from the cross-slide fade.
  function dynFooterHTML() {
    const updated = lastUpdatedText();
    return `
      ${updated ? `<div class="dyn-updated">${updated}</div>` : ""}
      <div class="dyn-exit-hint">tap to exit</div>`;
  }

  function renderSlide() {
    // When we've run through the current cycle, build a fresh randomised one
    if (playlistIndex >= dynamicPlaylist.length) {
      dynamicPlaylist = buildPlaylist(getList());
      playlistIndex = 0;
    }

    const slide = dynamicPlaylist[playlistIndex];
    playlistIndex++;

    if (slide.type === 'page') {
      showPageSlide(slide);
      return;
    }

    if (slide.type === 'comp') {
      showCompSlide(slide.comp);
      return;
    }

    if (slide.type === 'pb') {
      showPbSlide(slide.ev);
      return;
    }

    // Rivalry slide: give a joke rivalry a rare chance to take this slot instead.
    // Jokes only ever appear here, never interrupting the page sequence.
    const joke = rollJokeRivalry();
    if (joke) {
      const gap = Math.abs(joke.a.dots - joke.b.dots);
      showRivalrySlide({ ...joke, gap, joke: true });
    } else {
      showRivalrySlide(slide);
    }
  }

  function nextSlide() {
    clearDynamic();
    if (!overlay) return;

    // Fade the current content out, then render the next slide
    const hasContent = overlay.children.length > 0;
    if (hasContent) {
      overlay.classList.add("dyn-fading");
      holdTimeout = setTimeout(() => {
        overlay.classList.remove("dyn-fading");
        renderSlide();
      }, CONFIG.page_fade_ms);
    } else {
      renderSlide();
    }
  }

  // ── Page slide ────────────────────────────────────────────────
  function showPageSlide({ pageIndex, pageCount }) {
    const list = getList();
    const vals = list.map(l => SORTS[sortKey].get(l) || 0);
    const min = Math.min(...vals), max = Math.max(...vals);

    const per = CONFIG.per_page;
    const start = pageIndex * per;
    const pageItems = list.slice(start, start + per);

    // Build rows with their absolute (continuous) rank
    const rowsHTML = pageItems
      .map((l, i) => renderDynRow(l, start + i + 1, min, max))
      .join("");

    // On a sparse final page (≤4 lifters), add a centred caption below.
    const isLastPage = pageIndex === pageCount - 1;
    let captionHTML = "";
    if (isLastPage && pageItems.length <= 4) {
      const c = pickSparseCaption();
      captionHTML = `
        <div class="dyn-sparse-caption">
          <span class="dyn-sparse-text">${c.text}</span>
          ${c.credit ? `<span class="dyn-sparse-credit">— ${c.credit}</span>` : ""}
        </div>`;
    }

    overlay.innerHTML = `
      <div class="dyn-page-header">
        <div class="dyn-page-indicator">${viewLabel() ? `<span class="dyn-view-label">${esc(viewLabel())}</span>` : ""}${pageIndex + 1} / ${pageCount}</div>
      </div>
      <div class="dyn-page-wrap">
        <div class="dyn-list dyn-page-list" id="dyn-page-list">
          ${rowsHTML}
        </div>
        ${captionHTML}
      </div>
      ${dynFooterHTML()}
    `;

    // Cascade each row in from the side
    const rows = overlay.querySelectorAll(".dyn-row");
    rows.forEach((row, i) => {
      row.style.animationDelay = `${i * CONFIG.cascade_stagger_ms}ms`;
      row.classList.add("dyn-row-cascade");
    });

    // Hold, then advance
    holdTimeout = setTimeout(nextSlide, CONFIG.page_hold_ms);
  }

  function renderDynRow(lifter, rank, min, max) {
    const rankClass = rank === 1 ? "rank-gold" : rank === 2 ? "rank-silver" : rank === 3 ? "rank-bronze" : "";
    const isTop3 = rank <= 3;
    const dotsHL = isTop3 && sortKey === "dots" ? "dots-highlight" : "";
    const legacyTag = lifter.legacy ? `<span class="dyn-legacy-tag">Legacy</span>` : "";
    const width = barWidth(SORTS[sortKey].get(lifter) || 0, min, max);
    const arrows = sortKey === "dots" && sexFilter === "all";
    const pbs = recentPbs(lifter.slug);

    const stat = (label, key) => `
      <span class="dyn-stat">
        <span class="dyn-stat-label">${label}</span>
        <span class="dyn-stat-value${key === sortKey ? " is-sorted" : ""}">${fmt(lifter[key])}${pbArrow(pbs, key)}</span>
      </span>`;

    return `
    <div class="dyn-row" data-rank="${rank}">
      <div class="dyn-bar" style="width:${width}%"></div>
      <span class="dyn-rank ${rankClass}">${rank}${arrows ? movementArrow(lifter.slug, rank) : ""}</span>
      <span class="dyn-name">${esc(lifter.name)}${legacyTag}</span>
      <span class="dyn-stats">
        ${stat("SQ", "squat")}
        ${stat("BP", "bench")}
        ${stat("DL", "deadlift")}
        ${stat("Total", "total")}
      </span>
      <span class="dyn-dots ${dotsHL}">${fmtDots(lifter.dots)}${pbArrow(pbs, "dots")}</span>
    </div>`;
  }

  // ── Rivalry slide ─────────────────────────────────────────────
  function showRivalrySlide({ a, b, gap, caption, joke }) {
    const metaLine = (l) => {
      const bw = l.bodyweight && /^[\d.]+$/.test(l.bodyweight) ? `${l.bodyweight}kg` : l.bodyweight;
      const parts = [l.fed, l.equip, bw].filter(Boolean);
      return parts.join(" • ");
    };

    // Show a DOTS figure only when it's a real, finite, non-sentinel score.
    // Conceptual/fake opponents (destiny, excuses, the rack) shouldn't show a number.
    const dotsDisplay = (l) => {
      if (!l.fake) return `<div class="dyn-fighter-dots">${fmtDots(l.dots)}</div>`;
      if (l.dots && isFinite(l.dots) && l.dots !== 999.99 && l.dots !== 0 && l.dots !== 240) {
        // a real-but-external person (Julien, Brett, Dempsey) — keep their score
        return `<div class="dyn-fighter-dots">${fmtDots(l.dots)}</div>`;
      }
      // conceptual opponent — show a dash instead of a number
      return `<div class="dyn-fighter-dots dyn-dots-concept">—</div>`;
    };

    const fighterHTML = (l, side) => {
      const fakeClass = l.fake ? 'dyn-fighter-fake' : '';
      const teamClass = l.team ? 'dyn-fighter-team' : '';
      const imageHTML = l.image
        ? `<div class="dyn-fighter-img-wrap"><img class="dyn-fighter-img" src="${l.image}" alt="${esc(l.name)}" /></div>`
        : '';
      return `
        <div class="dyn-fighter dyn-fighter-${side} ${fakeClass} ${teamClass}">
          ${imageHTML}
          <div class="dyn-fighter-name">${esc(l.name)}</div>
          ${dotsDisplay(l)}
          <div class="dyn-fighter-meta">${metaLine(l)}</div>
        </div>`;
    };

    const label = joke ? "Grudge Match" : "Rivalry";

    overlay.innerHTML = `
      <div class="dyn-rivalry ${joke ? 'dyn-rivalry-joke' : ''}">
        <div class="dyn-rivalry-label ${joke ? 'dyn-label-joke' : ''}">${label}</div>
        <div class="dyn-rivalry-fighters">
          ${fighterHTML(a, 'a')}
          <div class="dyn-vs">
            <div class="dyn-vs-text">VS</div>
            ${joke ? '' : `<div class="dyn-gap-label">${gap.toFixed(2)} apart</div>`}
          </div>
          ${fighterHTML(b, 'b')}
        </div>
        ${joke && caption ? `<div class="dyn-caption">${caption}</div>` : `
        <div class="dyn-gap-bar-wrap">
          <div class="dyn-gap-bar-track">
            <div class="dyn-gap-bar-fill"></div>
          </div>
        </div>`}
      </div>
      ${dynFooterHTML()}
    `;

    // Animate gap bar in
    requestAnimationFrame(() => {
      const fill = overlay.querySelector(".dyn-gap-bar-fill");
      if (fill) fill.style.transform = "scaleX(1)";
    });

    holdTimeout = setTimeout(nextSlide, CONFIG.rivalry_hold_ms);
  }

  // ── PB callout slide (this week's new personal bests) ─────────
  // The event stores the name at scrape time; prefer the current one
  function currentName(ev) {
    const l = bySlug(ev.slug);
    return l ? l.name : ev.name;
  }

  function showPbSlide(ev) {
    // Build the list of improved lifts (label + from → to)
    const liftLabels = { squat: "Squat", bench: "Bench", deadlift: "Deadlift", total: "Total" };
    const rows = Object.entries(ev.improved || {}).map(([k, v]) => `
      <div class="dyn-pb-line">
        <span class="dyn-pb-lift">${liftLabels[k] || k}</span>
        <span class="dyn-pb-vals"><span class="dyn-pb-from">${fmt(v.from)}</span> → <span class="dyn-pb-to">${fmt(v.to)}</span></span>
      </div>`).join("");

    const placesUp = ev.placesUp
      ? `<div class="dyn-pb-jump">Up ${ev.placesUp} place${ev.placesUp > 1 ? "s" : ""} on the board</div>`
      : "";

    overlay.innerHTML = `
      <div class="dyn-rivalry dyn-pb">
        <div class="dyn-rivalry-label dyn-pb-label">New PB</div>
        <div class="dyn-pb-name">${esc(currentName(ev))}</div>
        <div class="dyn-pb-dots">
          <span class="dyn-pb-dots-val">${fmtDots(ev.dots.to)}</span>
          <span class="dyn-pb-dots-tag">DOTS</span>
        </div>
        <div class="dyn-pb-lines">${rows}</div>
        ${placesUp}
      </div>
      ${dynFooterHTML()}
    `;

    holdTimeout = setTimeout(nextSlide, CONFIG.rivalry_hold_ms);
  }

  // ── Upcoming competition slide ───────────────────────────────
  function compDateText(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric",
    }).format(new Date(Date.UTC(y, m - 1, d)));
  }

  function showCompSlide(comp) {
    const days = daysUntil(comp.date);
    const countdown = days <= 0
      ? `<span class="dyn-comp-days dyn-comp-days-word">Today</span><span class="dyn-comp-unit">Comp day</span>`
      : days === 1
        ? `<span class="dyn-comp-days dyn-comp-days-word">Tomorrow</span><span class="dyn-comp-unit">Get some sleep</span>`
        : `<span class="dyn-comp-days">${days}</span><span class="dyn-comp-unit">days to go</span>`;

    // Lifters on the board lead, strongest first; everyone else after
    const entries = (comp.competition_entries || []).map(e => {
      const r = e.lifter_id != null ? rosterById.get(e.lifter_id) : null;
      const onBoard = r ? LIFTERS.find(l => l.slug === r.slug) : null;
      return { name: onBoard ? onBoard.name : e.name, dots: onBoard ? onBoard.dots : null };
    }).sort((a, b) => (b.dots != null ? b.dots : -1) - (a.dots != null ? a.dots : -1));

    // A 10-segment "prep" bar over an 8-week build: fuller as the day nears
    const filled = Math.max(1, Math.min(10, Math.round(10 * (1 - days / 56))));
    const prepBar = `
      <div class="dyn-comp-prep" aria-hidden="true">
        <span class="dyn-comp-prep-label">PREP</span>
        <span class="dyn-comp-prep-bar">${'<i class="on"></i>'.repeat(filled)}${"<i></i>".repeat(10 - filled)}</span>
      </div>`;

    const many = entries.length > 8;
    const lifters = entries.length
      ? entries.map((e, i) => `
          <div class="dyn-comp-lifter" style="--i:${i}">
            <span class="dyn-comp-name">${esc(e.name)}</span>
            ${e.dots != null ? `<span class="dyn-comp-dots">${fmtDots(e.dots)}</span>` : ""}
          </div>`).join("")
      : `<div class="dyn-comp-tbc">Line-up to be confirmed</div>`;

    overlay.innerHTML = `
      <div class="dyn-comp">
        <div class="dyn-comp-label">Upcoming competition</div>
        <div class="dyn-comp-head">
          <div class="dyn-comp-titles">
            <div class="dyn-comp-title-wrap"><div class="dyn-comp-title">${esc(comp.name || comp.fed)}</div></div>
            <div class="dyn-comp-meta">
              ${comp.name ? `<span class="dyn-comp-fedtag">${esc(comp.fed)}</span>` : ""}
              <span class="dyn-comp-date">${compDateText(comp.date)}</span>
              ${comp.venue ? `<span class="dyn-comp-venue">${esc(comp.venue)}</span>` : ""}
            </div>
          </div>
          <div class="dyn-comp-countdown">${countdown}${prepBar}</div>
        </div>
        ${entries.length ? `<div class="dyn-comp-count">${entries.length} lifting</div>` : ""}
        <div class="dyn-comp-lifters${many ? " dyn-comp-lifters-many" : ""}">${lifters}</div>
      </div>
      ${dynFooterHTML()}
    `;

    holdTimeout = setTimeout(nextSlide, CONFIG.comp_hold_ms);
  }

  // ── Enter / exit dynamic ──────────────────────────────────────
  function enterDynamic() {
    dynamicActive = true;
    document.body.classList.add("dyn-on");   // hides the list view: less for the TV to draw
    pbCursor = 0;
    const list = getList();
    dynamicPlaylist = buildPlaylist(list);
    playlistIndex = 0;

    overlay = createOverlay();
    overlay.style.setProperty("--dyn-fade", `${CONFIG.page_fade_ms}ms`);

    // Keep the URL hash in step so an auto-reload preserves this state
    try { window.history.replaceState(null, "", "#" + currentStateHash()); } catch (_) {}

    // Attempt fullscreen
    const el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();

    nextSlide();
  }

  function exitDynamic() {
    dynamicActive = false;
    clearDynamic();

    if (overlay) { overlay.remove(); overlay = null; }
    document.body.classList.remove("dyn-on");
    if (staticDirty) { staticDirty = false; render(); }

    // Update hash to reflect that we're back on the static board
    try { window.history.replaceState(null, "", "#" + currentStateHash()); } catch (_) {}

    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (document.webkitFullscreenElement) document.webkitExitFullscreen();
  }

  // ── Daily auto-reload (keeps an always-on screen fresh) ──────
  // Each day at 07:00 local time (after the 6am scrape and Vercel redeploy,
  // with room for GitHub running late), the page reloads itself to pick up
  // the new data. The current
  // state — static/dynamic and legacy on/off — is saved to the URL hash before
  // reloading and restored on load, so a gym TV in dynamic mode comes back into
  // dynamic mode rather than dropping to the static board.

  function currentStateHash() {
    const mode = dynamicActive ? "dynamic" : "static";
    return showLegacy ? `${mode}-legacy` : mode;
  }

  function scheduleDailyReload() {
    const now = new Date();
    const target = new Date(now);
    target.setHours(7, 0, 0, 0);                  // 07:00 local
    // If today's 07:00 has already passed, schedule for tomorrow.
    if (target <= now) target.setDate(target.getDate() + 1);

    const ms = target - now;
    // setTimeout caps at ~24.8 days; a max of 24h is well within range.
    setTimeout(reloadWhenIdle, ms);
  }

  function reloadWhenIdle() {
    // Someone mid-edit in the admin screen: try again in 10 minutes
    if (document.body.classList.contains("admin-open")) {
      setTimeout(reloadWhenIdle, 10 * 60 * 1000);
      return;
    }
    // Preserve state across the reload, then reload from the server.
    try { window.location.hash = currentStateHash(); } catch (_) {}
    window.location.reload();
  }

  // Restore state from the hash on load (set by the daily reload). The board
  // always opens in dynamic mode; tapping it drops to the static board. Only
  // the legacy on/off choice carries over from the hash.
  function restoreFromHash() {
    const h = (window.location.hash || "").replace(/^#/, "");
    const wantLegacy = h.endsWith("-legacy");
    const wantDynamic = true;

    if (wantLegacy) applyLegacy(true);

    if (wantDynamic) {
      // Re-enter dynamic mode. Fullscreen may not re-arm without a user
      // gesture (browser security); on a kiosk/OS-fullscreen TV that's moot.
      enterDynamic();
    }
  }

  // ── "Last updated" text (GOV.UK formatting) ───────────────────
  // Builds e.g. "Last updated 22 June 2026 at 12:05pm" from changes.js.
  // The stored timestamp is UTC; we render it in UK time (Europe/London) so it
  // reads as the actual local time the scrape ran. Exact 12:00 shows "midday".
  // Returns null if there's no timestamp yet (callers use a fallback).
  const MONTHS_FULL = ["January","February","March","April","May","June",
                       "July","August","September","October","November","December"];

  function ukParts(date) {
    // Extract day/month/year/hour/minute as they read in UK local time.
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", hour12: false,
    });
    const p = {};
    for (const part of fmt.formatToParts(date)) {
      if (part.type !== "literal") p[part.type] = part.value;
    }
    return {
      day: parseInt(p.day, 10),
      month: parseInt(p.month, 10),
      year: parseInt(p.year, 10),
      hour: parseInt(p.hour, 10) % 24,
      minute: parseInt(p.minute, 10),
    };
  }

  function govukTime(hour, minute) {
    if (hour === 0 && minute === 0) return "midnight";
    if (hour === 12 && minute === 0) return "midday";
    const ampm = hour < 12 ? "am" : "pm";
    let h = hour % 12; if (h === 0) h = 12;
    return minute === 0 ? `${h}${ampm}` : `${h}:${String(minute).padStart(2, "0")}${ampm}`;
  }

  function lastUpdatedText() {
    const ts = CH.generated;
    if (!ts) return null;
    const d = new Date(ts);
    if (isNaN(d)) return null;
    const { day, month, year, hour, minute } = ukParts(d);
    return `Last updated ${day} ${MONTHS_FULL[month - 1]} ${year} at ${govukTime(hour, minute)}`;
  }

  function setUpdatedLine() {
    const el = document.getElementById("updated-line");
    if (!el) return;
    const txt = lastUpdatedText();
    if (txt) el.textContent = txt + "."; // footer sentence keeps its full stop
    // else: leave the static "Updated daily at 6am." fallback in the HTML
  }

  // ── Inits ─────────────────────────────────────────────────────
  // Always dark, whatever the device prefers
  function initTheme() {
    document.documentElement.dataset.theme = "dark";
  }

  function applyLegacy(on) {
    showLegacy = on;
    const btn = document.getElementById("legacy-toggle");
    if (btn) {
      btn.classList.toggle("legacy-active", showLegacy);
      btn.textContent = showLegacy ? "Hide Legacy" : "Show Legacy";
    }
    render();
    try { window.history.replaceState(null, "", "#" + currentStateHash()); } catch (_) {}
  }

  function initLegacy() {
    const btn = document.getElementById("legacy-toggle");
    if (!btn) return;
    btn.addEventListener("click", () => applyLegacy(!showLegacy));
  }

  function initDynamic() {
    const btn = document.getElementById("dynamic-toggle");
    if (!btn) return;
    btn.addEventListener("click", enterDynamic);
  }

  // Admin code is only fetched when someone taps the cog, so the TV never
  // downloads or parses it
  function initAdminLoader() {
    const btn = document.getElementById("admin-open");
    if (!btn) return;
    btn.addEventListener("click", () => {
      if (window.ImplexusAdmin) return;          // admin.js handles it from now on
      const s = document.createElement("script");
      s.src = "admin.js?v=6";
      s.onload = () => { if (window.ImplexusAdmin) window.ImplexusAdmin.open(); };
      document.body.appendChild(s);
    }, { once: true });
  }

  function init() {
    initTheme();
    initLegacy();
    initDynamic();
    initBoardControls();
    initAdminLoader();
    setUpdatedLine();       // show real refresh date if available
    restoreFromHash();      // re-apply state (dynamic by default)
    render();               // deferred until the list view is shown
    loadRoster();           // apply live roster edits on top of data.js
    loadCompetitions();     // upcoming competitions for the TV
    setInterval(() => { loadRoster(); loadCompetitions(); }, CONFIG.refresh_ms);
    scheduleDailyReload();  // arm the next daily 07:00 reload
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", init)
    : init();
})();
