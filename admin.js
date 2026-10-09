// Implexus Powerlifting — Admin
// A full-screen panel opened from the cog on the static board. Behind a
// 6-digit code (checked by Supabase, never stored in this file):
//   Dashboard  →  Add a lifter  →  Added (add another / dashboard / exit)
//              →  Edit lifters  →  Edit lifter (save / cancel / remove → confirm)

(function () {

  const OPL_PREFIX = "https://www.openpowerlifting.org/u/";
  const PIN_LENGTH = 6;

  // ── State ─────────────────────────────────────────────────────
  let root = null;        // the panel
  let pin = null;         // the code, kept in memory only while admin is open
  let roster = [];        // [{id, name, slug, ig, legacy, ...}] from Supabase
  let view = null;        // current view name
  let lastFocus = null;   // element to return focus to when the panel closes

  // ── Helpers ───────────────────────────────────────────────────
  function esc(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  }

  // Title case for names, without flattening deliberate capitals:
  // "ben thornes" → "Ben Thornes", "o'neill-smith" → "O'Neill-Smith",
  // but "Lee McCafferty" and "Wylie Du Sung" are left exactly as typed.
  function titleCase(raw) {
    return raw.trim().replace(/\s+/g, " ").split(" ").map(word => {
      const mixed = word !== word.toLowerCase() && word !== word.toUpperCase();
      if (mixed) return word;
      return word.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase());
    }).join(" ");
  }

  // "https://www.openpowerlifting.org/u/benthornes" → "benthornes"
  function slugFromUrl(raw) {
    const m = String(raw).trim().match(/^(?:https?:\/\/)?(?:www\.)?openpowerlifting\.org\/u\/([a-z0-9]+)\/?(?:[?#].*)?$/i);
    return m ? m[1].toLowerCase() : null;
  }

  // "@handle", "handle" or an instagram.com link → "handle" ("" if blank)
  function igFromInput(raw) {
    let v = String(raw).trim();
    if (!v) return "";
    const m = v.match(/instagram\.com\/([^/?#]+)/i);
    if (m) v = m[1];
    v = v.replace(/^@/, "");
    return /^[A-Za-z0-9._]{1,30}$/.test(v) ? v : null;
  }

  function syncNote() {
    return ImplexusDB.instantSync
      ? "They'll appear on the leaderboard in a few minutes, once their numbers have been fetched from OpenPowerlifting."
      : "They'll appear on the leaderboard after the next daily refresh at midday, so within 24 hours.";
  }

  const ERRORS = {
    wrong_pin: "That code isn't right.",
    locked: "Too many wrong codes. Wait 10 minutes and try again.",
    no_pin: "No admin code has been set up yet.",
    duplicate: "That OpenPowerlifting profile is already on the leaderboard.",
    invalid: "Something in the form isn't valid. Check the details and try again.",
    not_found: "That lifter has already been removed.",
  };
  const NETWORK_ERROR = "Couldn't reach the database. Check your connection and try again.";

  async function call(fn, args) {
    const res = await ImplexusDB.rpc(fn, { pin, ...args });
    if (res && res.ok) return res;
    const code = res && res.error;
    // The code was changed or the lockout kicked in: back to the keypad
    if (code === "wrong_pin" || code === "locked" || code === "no_pin") {
      pin = null;
      show("pin", { message: ERRORS[code] });
      const err = new Error(code);
      err.handled = true;
      throw err;
    }
    throw new Error(ERRORS[code] || NETWORK_ERROR);
  }

  async function refreshRoster() {
    roster = await ImplexusDB.listLifters();
    if (window.ImplexusBoard) window.ImplexusBoard.applyRoster(roster);
    return roster;
  }

  // ── Open / close ──────────────────────────────────────────────
  function open() {
    if (!root) build();
    lastFocus = document.activeElement;
    root.hidden = false;
    document.body.classList.add("admin-open");
    show(ImplexusDB.configured ? (pin ? "dashboard" : "pin") : "notConfigured");
  }

  function close() {
    pin = null;
    root.hidden = true;
    root.querySelector("#admin-body").innerHTML = "";
    document.body.classList.remove("admin-open");
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function build() {
    root = document.createElement("div");
    root.id = "admin";
    root.className = "admin";
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", "admin-title");
    root.innerHTML = `
      <div class="admin-bar">
        <div class="admin-bar-inner">
          <button type="button" class="admin-back" data-action="back" aria-label="Back" hidden>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <h2 class="admin-title" id="admin-title">Admin</h2>
          <button type="button" class="admin-close" data-action="exit" aria-label="Exit admin">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
          </button>
        </div>
      </div>
      <div class="admin-body" id="admin-body"></div>
      <div class="admin-toast" id="admin-toast" role="status" aria-live="polite"></div>
    `;
    document.body.appendChild(root);

    root.addEventListener("click", onClick);
    root.addEventListener("keydown", onKeydown);
  }

  // Central click handling for every [data-action] in the panel
  function onClick(e) {
    const el = e.target.closest("[data-action]");
    if (!el || !root.contains(el) || el.disabled) return;
    const action = el.dataset.action;
    switch (action) {
      case "exit": close(); break;
      case "back": goBack(); break;
      case "dashboard": show("dashboard"); break;
      case "add": show("add"); break;
      case "list": show("list"); break;
      case "edit": show("edit", { id: Number(el.dataset.id) }); break;
      case "key": pressKey(el.dataset.key); break;
      case "switch": toggleSwitch(el); break;
      case "ask-remove": openConfirm(); break;
      case "confirm-no": closeConfirm(); break;
      case "confirm-yes": removeLifter(); break;
    }
  }

  function onKeydown(e) {
    if (e.key === "Escape") {
      if (root.querySelector(".admin-modal")) { closeConfirm(); return; }
      goBack();
      return;
    }
    if (view === "pin") {
      if (/^[0-9]$/.test(e.key)) { pressKey(e.key); e.preventDefault(); }
      else if (e.key === "Backspace") { pressKey("del"); e.preventDefault(); }
    }
  }

  function goBack() {
    if (view === "add" || view === "list") show("dashboard");
    else if (view === "edit") show("list");
    else if (view === "added") show("dashboard");
    else close();
  }

  // ── View switching ────────────────────────────────────────────
  const TITLES = {
    notConfigured: "Admin",
    pin: "Admin",
    dashboard: "Admin dashboard",
    add: "Add a lifter",
    added: "Lifter added",
    list: "Edit lifters",
    edit: "Edit lifter",
  };
  const HAS_BACK = new Set(["add", "list", "edit"]);

  function show(name, opts = {}) {
    view = name;
    root.querySelector("#admin-title").textContent = TITLES[name];
    root.querySelector('[data-action="back"]').hidden = !HAS_BACK.has(name);
    const body = root.querySelector("#admin-body");
    body.scrollTop = 0;
    VIEWS[name](body, opts);
    const first = body.querySelector("[data-autofocus]") || body.querySelector("input, button");
    if (first) first.focus({ preventScroll: true });
  }

  function toast(text) {
    const el = root.querySelector("#admin-toast");
    el.textContent = text;
    el.classList.add("is-visible");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("is-visible"), 3200);
  }

  // ── Views ─────────────────────────────────────────────────────
  const VIEWS = {

    notConfigured(body) {
      body.innerHTML = `
        <div class="admin-panel admin-center">
          <p class="admin-lead">Admin isn't connected yet.</p>
          <p class="admin-help">The leaderboard needs a Supabase project before lifters can be added or edited here. The setup steps are in the README.</p>
          <div class="admin-actions">
            <button type="button" class="btn btn-secondary" data-action="exit">Back to leaderboard</button>
          </div>
        </div>`;
    },

    // iPad-style keypad. Submits on the sixth digit.
    pin(body, { message } = {}) {
      body.innerHTML = `
        <div class="admin-panel admin-center admin-pin" tabindex="-1" data-autofocus>
          <p class="admin-lead">Enter the admin code</p>
          <div class="pin-dots" aria-hidden="true">${"<span></span>".repeat(PIN_LENGTH)}</div>
          <p class="pin-message" role="alert">${esc(message || "")}</p>
          <div class="keypad" role="group" aria-label="Keypad">
            ${["1","2","3","4","5","6","7","8","9"].map(k =>
              `<button type="button" class="key" data-action="key" data-key="${k}">${k}</button>`).join("")}
            <span class="key key-blank" aria-hidden="true"></span>
            <button type="button" class="key" data-action="key" data-key="0">0</button>
            <button type="button" class="key key-del" data-action="key" data-key="del" aria-label="Delete">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h11v14H9l-6-7 6-7zM12.5 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>
            </button>
          </div>
        </div>`;
      pinEntry = "";
      paintDots();
    },

    dashboard(body) {
      const active = roster.filter(l => !l.legacy).length;
      body.innerHTML = `
        <div class="admin-panel">
          <div class="admin-menu">
            <button type="button" class="menu-card" data-action="add" data-autofocus>
              <span class="menu-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
              </span>
              <span class="menu-text">
                <span class="menu-title">Add a lifter</span>
                <span class="menu-sub">From their OpenPowerlifting profile</span>
              </span>
            </button>
            <button type="button" class="menu-card" data-action="list">
              <span class="menu-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
              </span>
              <span class="menu-text">
                <span class="menu-title">Edit lifters</span>
                <span class="menu-sub" id="admin-count">${roster.length ? `${roster.length} lifters, ${active} current` : "Rename, change legacy or remove"}</span>
              </span>
            </button>
          </div>
          <div class="admin-actions">
            <button type="button" class="btn btn-ghost" data-action="exit">Exit admin</button>
          </div>
        </div>`;
      // Keep the count fresh without holding up the menu
      refreshRoster().then(() => {
        const el = body.querySelector("#admin-count");
        const act = roster.filter(l => !l.legacy).length;
        if (el && view === "dashboard") el.textContent = `${roster.length} lifters, ${act} current`;
      }).catch(() => {});
    },

    add(body) {
      body.innerHTML = `
        <form class="admin-panel admin-form" novalidate>
          ${fieldsHTML({ name: "", url: "", ig: "", legacy: false })}
          <p class="form-error" role="alert"></p>
          <div class="admin-actions">
            <button type="submit" class="btn btn-primary">Add lifter</button>
            <button type="button" class="btn btn-secondary" data-action="dashboard">Cancel</button>
          </div>
        </form>`;
      wireForm(body.querySelector("form"), async (values, form) => {
        const res = await call("admin_add_lifter", {
          p_name: values.name, p_slug: values.slug, p_ig: values.ig || null, p_legacy: values.legacy,
        });
        await refreshRoster().catch(() => {});
        show("added", { lifter: res.lifter });
      });
    },

    added(body, { lifter }) {
      body.innerHTML = `
        <div class="admin-panel admin-center">
          <div class="success-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <p class="admin-lead">${esc(lifter.name)} has been added${lifter.legacy ? " as a legacy lifter" : ""}</p>
          <p class="admin-help">${syncNote()}</p>
          <div class="admin-actions">
            <button type="button" class="btn btn-primary" data-action="add" data-autofocus>Add another lifter</button>
            <button type="button" class="btn btn-secondary" data-action="dashboard">Back to dashboard</button>
            <button type="button" class="btn btn-ghost" data-action="exit">Exit admin</button>
          </div>
        </div>`;
    },

    list(body) {
      body.innerHTML = `
        <div class="admin-panel">
          <label class="search">
            <span class="visually-hidden">Search lifters</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            <input type="search" placeholder="Search lifters" autocomplete="off" data-autofocus />
          </label>
          <div class="lifter-list" aria-live="polite"><p class="admin-help">Loading lifters…</p></div>
        </div>`;
      const listEl = body.querySelector(".lifter-list");
      const search = body.querySelector("input");

      const paint = () => {
        const q = search.value.trim().toLowerCase();
        const items = [...roster]
          .sort((a, b) => (a.legacy - b.legacy) || a.name.localeCompare(b.name))
          .filter(l => !q || l.name.toLowerCase().includes(q) || l.slug.includes(q));
        if (!items.length) {
          listEl.innerHTML = `<p class="admin-help">${roster.length ? "No lifters match that search." : "No lifters yet."}</p>`;
          return;
        }
        listEl.innerHTML = items.map(l => {
          const pending = window.ImplexusBoard && !window.ImplexusBoard.hasNumbers(l.slug);
          return `
          <button type="button" class="lifter-item" data-action="edit" data-id="${l.id}">
            <span class="lifter-main">
              <span class="lifter-name">${esc(l.name)}</span>
              <span class="lifter-slug">openpowerlifting.org/u/${esc(l.slug)}</span>
            </span>
            <span class="lifter-tags">
              ${pending ? `<span class="tag tag-pending">Waiting for sync</span>` : ""}
              ${l.legacy ? `<span class="tag">Legacy</span>` : ""}
            </span>
            <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>`;
        }).join("");
      };

      search.addEventListener("input", paint);
      if (roster.length) paint();
      refreshRoster().then(() => { if (view === "list") paint(); })
        .catch(() => {
          if (view === "list" && !roster.length) listEl.innerHTML = `<p class="admin-help">${NETWORK_ERROR}</p>`;
        });
    },

    edit(body, { id }) {
      const lifter = roster.find(l => l.id === id);
      if (!lifter) { show("list"); return; }
      body.innerHTML = `
        <form class="admin-panel admin-form" novalidate data-id="${lifter.id}">
          ${fieldsHTML({ name: lifter.name, url: OPL_PREFIX + lifter.slug, ig: lifter.ig || "", legacy: lifter.legacy })}
          <p class="form-note" data-slug-note hidden>Changing the profile link means their numbers are fetched again, so they'll be off the leaderboard until the next sync.</p>
          <p class="form-error" role="alert"></p>
          <div class="admin-actions">
            <button type="submit" class="btn btn-primary">Save changes</button>
            <button type="button" class="btn btn-secondary" data-action="list">Cancel</button>
          </div>
          <div class="admin-danger-zone">
            <button type="button" class="btn btn-danger-ghost" data-action="ask-remove">Remove lifter</button>
          </div>
        </form>`;
      const form = body.querySelector("form");
      const urlInput = form.querySelector('[name="url"]');
      const note = form.querySelector("[data-slug-note]");
      urlInput.addEventListener("input", () => {
        const slug = slugFromUrl(urlInput.value);
        note.hidden = !slug || slug === lifter.slug;
      });
      wireForm(form, async (values) => {
        const unchanged = values.name === lifter.name && values.slug === lifter.slug &&
          (values.ig || null) === (lifter.ig || null) && values.legacy === lifter.legacy;
        if (unchanged) { show("list"); return; }
        await call("admin_update_lifter", {
          p_id: lifter.id, p_name: values.name, p_slug: values.slug, p_ig: values.ig || null, p_legacy: values.legacy,
        });
        await refreshRoster().catch(() => {});
        show("list");
        toast(values.slug !== lifter.slug
          ? `Saved. ${values.name} will be back on the board after the next sync.`
          : `Saved changes to ${values.name}.`);
      }, lifter.id);
    },
  };

  // ── Keypad ────────────────────────────────────────────────────
  let pinEntry = "";
  let pinBusy = false;

  function paintDots() {
    root.querySelectorAll(".pin-dots span").forEach((d, i) => d.classList.toggle("is-filled", i < pinEntry.length));
  }

  function pressKey(key) {
    if (pinBusy || view !== "pin") return;
    if (key === "del") pinEntry = pinEntry.slice(0, -1);
    else if (pinEntry.length < PIN_LENGTH) pinEntry += key;
    paintDots();
    if (pinEntry.length === PIN_LENGTH) submitPin();
  }

  async function submitPin() {
    pinBusy = true;
    const panel = root.querySelector(".admin-pin");
    const msg = root.querySelector(".pin-message");
    panel.classList.add("is-checking");
    msg.textContent = "";
    let res = null;
    try {
      res = await ImplexusDB.rpc("admin_verify_pin", { pin: pinEntry });
    } catch (_) { /* network: handled below */ }
    pinBusy = false;
    if (view !== "pin") return; // closed while checking
    panel.classList.remove("is-checking");

    if (res && res.ok) {
      pin = pinEntry;
      pinEntry = "";
      show("dashboard");
      return;
    }
    msg.textContent = res ? (ERRORS[res.error] || ERRORS.wrong_pin) : NETWORK_ERROR;
    pinEntry = "";
    paintDots();
    panel.classList.remove("is-wrong");
    void panel.offsetWidth; // restart the shake
    panel.classList.add("is-wrong");
  }

  // ── Form pieces ───────────────────────────────────────────────
  function fieldsHTML({ name, url, ig, legacy }) {
    return `
      <div class="field">
        <label for="f-name">Name</label>
        <input id="f-name" name="name" type="text" value="${esc(name)}" autocomplete="off" autocapitalize="words" spellcheck="false" maxlength="80" data-autofocus />
        <p class="field-error" id="f-name-err"></p>
      </div>
      <div class="field">
        <label for="f-url">OpenPowerlifting link</label>
        <input id="f-url" name="url" type="url" value="${esc(url)}" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${OPL_PREFIX}…" aria-describedby="f-url-hint" />
        <p class="field-hint" id="f-url-hint">Paste the link to their page, like ${OPL_PREFIX}johnsmith</p>
        <p class="field-error" id="f-url-err"></p>
        <a class="field-link" href="#" target="_blank" rel="noopener" data-profile-link hidden>Check their profile ↗</a>
      </div>
      <div class="field">
        <label for="f-ig">Instagram <span class="optional">(optional)</span></label>
        <input id="f-ig" name="ig" type="text" value="${esc(ig)}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="@handle" />
        <p class="field-error" id="f-ig-err"></p>
      </div>
      <div class="field field-switch">
        <span class="switch-text">
          <span class="switch-label" id="f-legacy-label">Legacy lifter</span>
          <span class="field-hint">A former member. Only shown when Show Legacy is on.</span>
        </span>
        <button type="button" class="switch" role="switch" name="legacy" aria-checked="${legacy ? "true" : "false"}" aria-labelledby="f-legacy-label" data-action="switch">
          <span class="switch-thumb"></span>
        </button>
      </div>`;
  }

  function toggleSwitch(el) {
    el.setAttribute("aria-checked", el.getAttribute("aria-checked") === "true" ? "false" : "true");
  }

  // Validates, title-cases the name, shows inline errors, and runs onSubmit
  // with clean values. excludeId lets an edit keep its own profile link.
  function wireForm(form, onSubmit, excludeId) {
    const nameInput = form.querySelector('[name="name"]');
    const urlInput = form.querySelector('[name="url"]');
    const igInput = form.querySelector('[name="ig"]');
    const legacySwitch = form.querySelector('[name="legacy"]');
    const profileLink = form.querySelector("[data-profile-link]");
    const submitBtn = form.querySelector('[type="submit"]');
    const formError = form.querySelector(".form-error");

    const setError = (input, text) => {
      const el = form.querySelector(`#${input.id}-err`);
      el.textContent = text || "";
      input.setAttribute("aria-invalid", text ? "true" : "false");
      if (text) input.setAttribute("aria-errormessage", `${input.id}-err`);
    };

    const updateProfileLink = () => {
      const slug = slugFromUrl(urlInput.value);
      profileLink.hidden = !slug;
      if (slug) profileLink.href = OPL_PREFIX + slug;
    };
    updateProfileLink();

    nameInput.addEventListener("blur", () => {
      if (nameInput.value.trim()) nameInput.value = titleCase(nameInput.value);
    });
    urlInput.addEventListener("input", () => { setError(urlInput, ""); updateProfileLink(); });
    nameInput.addEventListener("input", () => setError(nameInput, ""));
    igInput.addEventListener("input", () => setError(igInput, ""));

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      formError.textContent = "";

      const name = titleCase(nameInput.value);
      nameInput.value = name;
      const slug = slugFromUrl(urlInput.value);
      const ig = igFromInput(igInput.value);
      const taken = slug && roster.find(l => l.slug === slug && l.id !== excludeId);

      const errors = [
        [nameInput, !name ? "Enter the lifter's name." : ""],
        [urlInput, !urlInput.value.trim() ? "Paste their OpenPowerlifting link."
                 : !slug ? `That doesn't look like an OpenPowerlifting profile link. It should start ${OPL_PREFIX}`
                 : taken ? `${taken.name} already uses that profile.` : ""],
        [igInput, ig === null ? "That isn't a valid Instagram handle." : ""],
      ];
      errors.forEach(([input, text]) => setError(input, text));
      const firstBad = errors.find(([, text]) => text);
      if (firstBad) { firstBad[0].focus(); return; }

      submitBtn.disabled = true;
      submitBtn.classList.add("is-busy");
      try {
        await onSubmit({ name, slug, ig, legacy: legacySwitch.getAttribute("aria-checked") === "true" }, form);
      } catch (err) {
        if (err.handled) return;
        formError.textContent = err.message || NETWORK_ERROR;
        submitBtn.disabled = false;
        submitBtn.classList.remove("is-busy");
      }
    });
  }

  // ── Remove: confirm modal ─────────────────────────────────────
  function openConfirm() {
    const form = root.querySelector(".admin-form[data-id]");
    const lifter = form && roster.find(l => l.id === Number(form.dataset.id));
    if (!lifter) return;
    const modal = document.createElement("div");
    modal.className = "admin-modal";
    modal.innerHTML = `
      <div class="modal-card" role="alertdialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby="modal-desc">
        <h3 class="modal-title" id="modal-title">Remove ${esc(lifter.name)}?</h3>
        <p class="modal-desc" id="modal-desc">They'll be taken off the leaderboard completely, including the legacy view. You can add them again later.</p>
        <p class="form-error" role="alert"></p>
        <div class="admin-actions">
          <button type="button" class="btn btn-danger" data-action="confirm-yes">Yes, remove</button>
          <button type="button" class="btn btn-secondary" data-action="confirm-no" data-autofocus>No, keep them</button>
        </div>
      </div>`;
    modal.dataset.id = lifter.id;
    modal.addEventListener("click", e => { if (e.target === modal) closeConfirm(); });
    root.appendChild(modal);
    modal.querySelector("[data-autofocus]").focus();
  }

  function closeConfirm() {
    const modal = root.querySelector(".admin-modal");
    if (modal) modal.remove();
    const btn = root.querySelector('[data-action="ask-remove"]');
    if (btn) btn.focus();
  }

  async function removeLifter() {
    const modal = root.querySelector(".admin-modal");
    if (!modal) return;
    const id = Number(modal.dataset.id);
    const lifter = roster.find(l => l.id === id);
    const yes = modal.querySelector('[data-action="confirm-yes"]');
    yes.disabled = true;
    yes.classList.add("is-busy");
    try {
      await call("admin_remove_lifter", { p_id: id });
      modal.remove();
      await refreshRoster().catch(() => {});
      show("list");
      toast(`Removed ${lifter ? lifter.name : "lifter"} from the leaderboard.`);
    } catch (err) {
      if (err.handled) { modal.remove(); return; }
      modal.querySelector(".form-error").textContent = err.message || NETWORK_ERROR;
      yes.disabled = false;
      yes.classList.remove("is-busy");
    }
  }

  // ── Init ──────────────────────────────────────────────────────
  function init() {
    const btn = document.getElementById("admin-open");
    if (btn) btn.addEventListener("click", open);
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", init)
    : init();
})();
