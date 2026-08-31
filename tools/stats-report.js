/**
 * stats-report.js — read the anonymous usage counts back out of Cloudflare.
 *
 * The beacon (workers/stats) writes to the Workers Analytics Engine dataset
 * `wc3v_stats`. This queries it over the SQL API and prints a plain report:
 * daily totals, top pages, referrers, countries, installs, app versions.
 *
 * Column layout (fixed in workers/stats/src/index.js — change both or neither):
 *   blob1 src, blob2 event, blob3 path, blob4 referrer, blob5 country,
 *   blob6 version, blob7 os · double1 count
 *
 * Counts are computed as SUM(_sample_interval): Analytics Engine may sample
 * under load, and _sample_interval is the weight that undoes it. At this
 * site's volume it is 1 everywhere, but the query is written correctly anyway.
 *
 * Needs two env vars (or flags):
 *   CLOUDFLARE_ACCOUNT_ID   the account that owns the wc3v.com zone
 *   CLOUDFLARE_API_TOKEN    a token with Account Analytics : Read
 *
 * Usage:
 *   node tools/stats-report.js                 last 7 days
 *   node tools/stats-report.js --days=30
 *   node tools/stats-report.js --sql="SELECT ..."   one raw query, table out
 */

'use strict';

const DATASET = 'wc3v_stats';

const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
}

const ACCOUNT = args.account || process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = args.token || process.env.CLOUDFLARE_API_TOKEN;
const DAYS = Math.max(1, Math.min(90, parseInt(args.days, 10) || 7));

if (!ACCOUNT || !TOKEN) {
  console.error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (Account Analytics : Read).');
  console.error('Create the token at https://dash.cloudflare.com/profile/api-tokens');
  process.exit(1);
}

async function sql (query) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/analytics_engine/sql`,
    { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: query }
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL API ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text).data || [];
}

function table (rows, cols) {
  if (!rows.length) { console.log('  (no data)'); return; }
  const widths = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length)));
  console.log('  ' + cols.map((c, i) => c.padEnd(widths[i])).join('  '));
  for (const r of rows) {
    console.log('  ' + cols.map((c, i) => String(r[c] ?? '').padEnd(widths[i])).join('  '));
  }
}

const WHERE = `timestamp > NOW() - INTERVAL '${DAYS}' DAY`;

async function main () {
  if (args.sql) {
    const rows = await sql(args.sql);
    table(rows, rows.length ? Object.keys(rows[0]) : []);
    return;
  }

  console.log(`wc3v usage, last ${DAYS} day(s)\n`);

  console.log('── by day ──');
  table(await sql(`
    SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day,
           blob2 AS event, SUM(_sample_interval) AS n
    FROM ${DATASET} WHERE ${WHERE}
    GROUP BY day, event ORDER BY day DESC, n DESC`), ['day', 'event', 'n']);

  console.log('\n── totals by event ──');
  table(await sql(`
    SELECT blob2 AS event, SUM(_sample_interval) AS n
    FROM ${DATASET} WHERE ${WHERE}
    GROUP BY event ORDER BY n DESC`), ['event', 'n']);

  console.log('\n── top pages ──');
  table(await sql(`
    SELECT blob3 AS page, SUM(_sample_interval) AS n
    FROM ${DATASET} WHERE ${WHERE} AND blob2 = 'pageview' AND blob3 != ''
    GROUP BY page ORDER BY n DESC LIMIT 25`), ['page', 'n']);

  console.log('\n── referrers ──');
  table(await sql(`
    SELECT blob4 AS referrer, SUM(_sample_interval) AS n
    FROM ${DATASET} WHERE ${WHERE} AND blob4 != ''
    GROUP BY referrer ORDER BY n DESC LIMIT 25`), ['referrer', 'n']);

  console.log('\n── countries ──');
  table(await sql(`
    SELECT blob5 AS country, SUM(_sample_interval) AS n
    FROM ${DATASET} WHERE ${WHERE} AND blob5 != ''
    GROUP BY country ORDER BY n DESC LIMIT 25`), ['country', 'n']);

  console.log('\n── desktop app by version ──');
  table(await sql(`
    SELECT blob6 AS version, blob2 AS event, SUM(_sample_interval) AS n
    FROM ${DATASET} WHERE ${WHERE} AND blob1 = 'app'
    GROUP BY version, event ORDER BY version DESC, n DESC`), ['version', 'event', 'n']);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
