// Implexus Powerlifting — keep-alive
// Supabase pauses free projects after about a week without activity. Vercel
// calls this once a day (see "crons" in vercel.json); it reads one row from
// the roster, which counts as database activity.
//
// Uses the same public URL + publishable key as the site (config.js), so there
// is nothing secret here. If CRON_SECRET is set in Vercel, only Vercel's own
// scheduled call is accepted.

const fs = require("fs");
const path = require("path");

function supabaseConfig() {
  const src = fs.readFileSync(path.join(__dirname, "..", "config.js"), "utf8");
  // eslint-disable-next-line no-new-func
  const cfg = new Function(`${src}; return SUPABASE_CONFIG;`)() || {};
  return { url: (cfg.url || "").replace(/\/+$/, ""), key: cfg.key || "" };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ ok: false, error: "unauthorised" });
    return;
  }

  const { url, key } = supabaseConfig();
  if (!url || !key) {
    res.status(500).json({ ok: false, error: "Supabase is not configured in config.js" });
    return;
  }

  try {
    const r = await fetch(`${url}/rest/v1/lifters?select=id&limit=1`, {
      headers: { apikey: key },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`Supabase answered HTTP ${r.status}`);
    await r.json();
    res.status(200).json({ ok: true, checkedAt: new Date().toISOString() });
  } catch (err) {
    // A failed check shows up in Vercel's logs for the cron job
    res.status(502).json({ ok: false, error: err.message });
  }
};
