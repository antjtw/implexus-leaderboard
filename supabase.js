// Implexus Powerlifting — tiny Supabase REST client
// Shared by app.js (live roster) and admin.js (PIN-checked edits). Talks to
// PostgREST directly with fetch, so there's no SDK to load.

const ImplexusDB = (function () {
  const cfg = (typeof SUPABASE_CONFIG !== "undefined" && SUPABASE_CONFIG) || {};
  const url = (cfg.url || "").replace(/\/+$/, "");
  const key = cfg.key || "";
  const configured = Boolean(url && key);

  // Only the apikey header: it works for both the legacy anon JWT and the
  // newer sb_publishable_ keys (which are rejected as a Bearer token).
  function headers(extra) {
    return { apikey: key, ...extra };
  }

  async function request(path, options = {}, timeoutMs = 8000) {
    if (!configured) throw new Error("not_configured");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${url}/rest/v1/${path}`, { ...options, signal: ctrl.signal });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error((body && body.message) || `HTTP ${res.status}`);
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  // The roster: [{id, name, slug, ig, legacy, created_at, updated_at}]
  async function listLifters(timeoutMs) {
    const rows = await request("lifters?select=id,name,slug,ig,legacy,created_at,updated_at&order=created_at.asc,id.asc",
      { headers: headers() }, timeoutMs);
    if (!Array.isArray(rows)) throw new Error("Unexpected response from the database");
    return rows;
  }

  // Admin functions return {ok: true, ...} or {ok: false, error: "code"}
  function rpc(fn, args) {
    return request(`rpc/${fn}`, {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(args),
    });
  }

  return { configured, instantSync: Boolean(cfg.instantSync), listLifters, rpc };
})();
