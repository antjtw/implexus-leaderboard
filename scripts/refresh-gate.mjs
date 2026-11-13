#!/usr/bin/env node
/**
 * Decides whether a scheduled refresh should run: once a day, at (or soon
 * after) 6am UK time. Prints "run=true" or "run=false" for GitHub Actions.
 *
 * Manual runs and roster-change syncs always run. For scheduled runs:
 *  - before 06:00 UK          -> skip (the winter 05:00 UTC wake-up)
 *  - already refreshed today
 *    at or after 06:00 UK     -> skip (the second wake-up)
 *  - otherwise                -> run
 *
 * "Already refreshed" comes from the `generated` timestamp in changes.js.
 * NOW (ISO time) can be set to test it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUN_HOUR = 6;

// Date and hour as they are in the UK
function uk(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", hourCycle: "h23",
    }).formatToParts(date).map((p) => [p.type, p.value])
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

function lastRefresh() {
  try {
    const src = readFileSync(join(ROOT, "changes.js"), "utf8");
    // eslint-disable-next-line no-new-func
    const changes = new Function(`${src}; return CHANGES;`)();
    return changes && changes.generated ? new Date(changes.generated) : null;
  } catch (_) {
    return null;
  }
}

function decide() {
  const event = process.env.EVENT || "schedule";
  if (event !== "schedule") return [true, `${event}: always runs`];

  const now = uk(process.env.NOW ? new Date(process.env.NOW) : new Date());
  if (now.hour < RUN_HOUR) return [false, `${now.hour}:xx in the UK, before ${RUN_HOUR}am`];

  const last = lastRefresh();
  if (last) {
    const l = uk(last);
    if (l.day === now.day && l.hour >= RUN_HOUR) return [false, `already refreshed today at ${l.hour}:xx UK`];
  }
  return [true, `${now.hour}:xx in the UK, not yet refreshed today`];
}

const [run, why] = decide();
console.error(`Refresh ${run ? "runs" : "skipped"}: ${why}`);
console.log(`run=${run}`);
