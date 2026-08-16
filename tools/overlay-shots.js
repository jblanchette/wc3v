/**
 * overlay-shots.js — render the stream overlay headless: invariant audit + shots.
 *
 * The overlay is the one surface in this product nobody can eyeball while
 * working on it. It lives in an OBS Browser Source on somebody else's machine,
 * it is assembled by overlay.rs out of four files at request time, and the only
 * other way to look at it is to launch the desktop app and play a game. So the
 * card silently regressing is the default outcome of any change to
 * overlay-render.js or overlay.css.
 *
 * This does the stitch overlay.rs does (shell + css + the two icon modules +
 * the renderer), feeds it fixture states, and walks every theme against every
 * phase of a session. It asserts the things that are true of the card no matter
 * what is in the payload, and screenshots each stop so a look round can be
 * judged side by side.
 *
 * The invariants, and why each one is here:
 *
 *   branding      the WC3V mark is on every card, in every theme, in every
 *                 phase, including a single-panel source. It is the whole
 *                 reason the app is allowed on somebody's stream.
 *   live-clock    a live card shows a clock that ADVANCES between renders. The
 *                 state is republished every 20-60s, so a clock that only moved
 *                 on a redraw would sit still for a minute and jump.
 *   no-stale-verdict  while a match is live, the last game's result is not on
 *                 the card. A finished verdict under a player who is visibly
 *                 still playing is the worst thing this card can show.
 *   readable      nothing renders below 0.8rem at scale 1 (the project floor)
 *                 and no text lands on a background it cannot be read against.
 *   fits          the card stays inside its suggested Browser Source width.
 *   board         the RESTING card carries a session board, not a smudge. This
 *                 is the state the overlay is in for most of a night — no
 *                 game on, nothing finished recently — and it is the one the
 *                 other checks all passed while it was two dim lines in a
 *                 corner. Grades the score's rendered size and the card's
 *                 painted height, because "has a session module" was true the
 *                 whole time it was unreadable.
 *
 * Usage:
 *   node tools/overlay-shots.js
 *   node tools/overlay-shots.js --audit-only
 *   node tools/overlay-shots.js --self-test
 *   node tools/overlay-shots.js --themes=carved,etched --phases=live
 *   node tools/overlay-shots.js --scale=2
 *
 * Flags:
 *   --themes=a,b       default carved,etched,parchment,slate
 *   --phases=a,b       default fresh,idle,live,post
 *                        fresh  never parsed a replay: the waiting plate
 *                        idle   resting between games: the session board
 *                        live   a match is on
 *                        post   a game just finished, full card
 *   --scale=N          the card's scale, as the app's Size control sets it.
 *                      Default 1. The width scales with it unless --width says
 *                      otherwise, because the suggested source size does too.
 *   --width=N          card viewport width, default 460 × scale
 *   --backdrop=KIND    what sits behind the card in the shots: none (default,
 *                      the checkerboard OBS shows), dark, light, or split.
 *                      `split` is the one that matters for a panel-less theme:
 *                      half the card over shadow and half over a bright
 *                      minimap is the case that decides whether it is legible.
 *   --audit-only       no screenshots, just the assertions
 *   --self-test        break the card on purpose and require each check to
 *                      catch it. An audit that cannot fail is an audit that
 *                      says everything is fine, which is the failure mode this
 *                      whole tool exists to prevent.
 *   --shots-dir=PATH   default .overlay-shots (gitignored), or WC3V_SHOTS_DIR
 *
 * Exit 1 when anything failed. audit.json carries the details.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const FE = path.join(ROOT, 'desktop', 'src-frontend');

const BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
];

function findBrowser () {
  if (process.env.WC3V_BROWSER) return process.env.WC3V_BROWSER;
  for (const p of BROWSERS) if (fs.existsSync(p)) return p;
  throw new Error('no Chrome/Edge found — set WC3V_BROWSER=/path/to/browser');
}

const args = {};
process.argv.slice(2).forEach((raw) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(raw);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
});

const themes = String(args.themes || 'carved,etched,parchment,slate')
  .split(',').map(s => s.trim()).filter(Boolean);
const phases = String(args.phases || 'fresh,idle,live,post')
  .split(',').map(s => s.trim()).filter(Boolean);
// The card's scale, and the source size that goes with it. The app's Size
// control is the same number applied to the root font size, and the card is
// laid out in rem, so the suggested Browser Source width moves with it.
const scale = Number(args.scale || 1);
const width = Math.round(Number(args.width || 460 * scale));
const auditOnly = !!args['audit-only'] || !!args['self-test'];

// What sits behind the card in the shots. Never applied during the audit: the
// contrast check walks up to the nearest painted ancestor, and a backdrop would
// let a theme borrow legibility from a stand-in nobody's scene actually has.
const BACKDROPS = {
  none: 'repeating-conic-gradient(#3a3a3a 0% 25%, #2a2a2a 0% 50%) 0 0 / 24px 24px',
  dark: 'linear-gradient(160deg, #14180f, #1d2417 60%, #0d1109)',
  light: 'linear-gradient(160deg, #cfd8c4, #e8eadf 60%, #bcc7ae)',
  // Shadowed terrain on the left, a bright minimap corner on the right. The
  // case a theme without a panel has to survive.
  split: 'linear-gradient(90deg, #10140d 0 45%, #d8dcc8 55% 100%)'
};
const backdrop = BACKDROPS[String(args.backdrop || 'none')] || BACKDROPS.none;
const selfTest = !!args['self-test'];

// Each check, with a way to break the card that only that check should see.
// The CSS is injected over the rendered stop; the expectation is a substring of
// the message the audit is supposed to produce.
const SABOTAGE = [
  {
    check: 'branding',
    css: '.wc3v-ov .mark .wordmark { opacity: 0.2; }',
    expect: 'branding:'
  },
  {
    check: 'readable (size floor)',
    css: '.wc3v-ov .sess-trend { font-size: 9px; }',
    // Scale-aware, because the floor is: 0.8rem means 12.8px at scale 1 and
    // 25.6px at Huge. Hardcoding the scale-1 string made this the one check
    // that could not fail on a --scale run — which is exactly the run where a
    // size regression is most likely to hide.
    expect: 'floor is ' + (12.8 * scale).toFixed(1) + 'px'
  },
  {
    check: 'readable (contrast)',
    css: '.wc3v-ov .session .sess-top .label { color: #1a1712; text-shadow: none; }',
    expect: 'contrast'
  },
  {
    check: 'fits',
    // Viewport-relative, not a fixed 900px. The source width scales with the
    // card, so at Huge a 900px card fitted inside a 920px source and the one
    // check that guards overflow quietly stopped being able to fail.
    css: '.wc3v-ov .card { max-width: none; width: 200vw; }',
    expect: 'fits:'
  },
  // The resting board, sabotaged back to what it used to be: a squeezed footer
  // with a small score in it. Graded at the `idle` stop, where it is the card.
  {
    check: 'board (score size)',
    phase: 'idle',
    css: '.wc3v-ov .sess-top .score { font-size: 1.05rem !important; }',
    expect: 'board: session score'
  },
  {
    check: 'board (card height)',
    phase: 'idle',
    css: '.wc3v-ov .session { display: none; }',
    expect: 'board:'
  },
  // The other direction: the footer's one-line result leaking onto a card that
  // is already showing the verdict panel.
  {
    check: 'board (no repeat)',
    phase: 'post',
    css: '.wc3v-ov .sess-last { display: flex !important; }',
    expect: 'post: the footer repeats'
  }
];

const shotsDir = typeof args['shots-dir'] === 'string'
  ? path.resolve(args['shots-dir'])
  : (process.env.WC3V_SHOTS_DIR || path.join(ROOT, '.overlay-shots'));

const read = (p) => fs.readFileSync(path.join(FE, p), 'utf8');

// The same assembly overlay.rs performs, minus the SSE client: this harness
// drives the renderer directly so it can step phases without a server.
function harness () {
  return read('overlay/shell.html')
    .replace('/*OVERLAY_CSS*/', () => read('overlay/overlay.css'))
    .replace('/*RACE_ICONS_JS*/', () => read('js/race-icons.js'))
    .replace('/*GLYPHS_JS*/', () => read('js/glyphs.js'))
    .replace('/*OVERLAY_RENDER_JS*/', () => read('overlay/overlay-render.js'))
    // The shell's last script block opens an EventSource against a server that
    // is not running here. Everything above it is what this tool is testing.
    //
    // Matched by CONTENT rather than by shape. A regex over the block's opening
    // lines is a regex over somebody's future edit to them, and shell.html is
    // checked in with CRLFs, which is how the first version of this failed.
    .replace(/<script>[\s\S]*?<\/script>/g, (block) =>
      (block.indexOf('EventSource') === -1 ? block : '<script>/* client stripped */</script>'));
}

// One session, as the three states the card actually passes through. Same
// shapes overlay-state.js publishes; the numbers are arbitrary and the
// STRUCTURE is the point.
const GAME = {
  gameId: 'fixture', map: 'Echo Isles', mode: '1v1', verdict: 'win',
  durationMs: 14 * 60 * 1000,
  user: { name: 'You', race: 'H' },
  opponent: { name: 'Opponent', race: 'O' },
  heroOpener: 'Archmage', heroOpenerIcon: 'Hamg',
  timings: { t2: '5:40', t3: null, expansion: '9:41', firstTower: null, apm: '187' },
  h2h: { name: 'Opponent', games: 5, wins: 3, losses: 2 },
  report: {
    raceHead: 'VS HUMAN',
    rows: [
      { key: 'dominanceAvg', label: 'Dominance', value: '58', vsYou: '+6', vsRace: '+4', band: 'good' },
      { key: 'heroKills', label: 'Hero kills', value: '2', vsYou: '+0.5', vsRace: '—', band: 'good' }
    ]
  },
  momentum: {
    control: 63, lead: 24, leadAt: '14:02', trade: 1850,
    curve: [50, 49, 52, 48, 45, 43, 47, 52, 55, 53, 58, 62, 60, 57, 64, 70, 68, 73, 79, 85, 88],
    combat: { heroKills: 2, heroDeaths: 1, wipesFor: 1, wipesAgainst: 0,
      biggestSwing: { won: true, swing: 1200, tf: '11:58' } }
  },
  moments: [{ time: '8:42', text: 'You killed Blademaster', type: 'heroKill', hero: true }],
  build: null
};

const SCOUT = {
  opponent: { name: 'NextOpponent', race: 'U' },
  map: 'Turtle Rock',
  startedAt: null,             // stamped in the page, it is an absolute instant
  yourMap: { wins: 7, losses: 3 },
  ladder: { rank: 42, mmr: 1850, games: 120, wins: 66, losses: 54 },
  h2h: { games: 4, wins: 3, losses: 1 },
  openers: [{ name: 'Death Knight', itemId: 'Udea' }, { name: 'Crypt Lord', itemId: 'Ucrl' }],
  t2You: '5:12', t2Them: '5:40', expansionRate: 62
};

const BASE = {
  updatedAt: 0,
  user: 'You',
  needsIdentity: false,
  candidates: [],
  session: {
    wins: 2,
    losses: 1,
    unknown: 0,
    // A night with a shape, not a flat run: the form rail is drawn from this
    // and a uniform one would render correctly whatever the win/loss mapping
    // did.
    results: ['win', 'loss', 'win'],
    streak: { kind: 'win', count: 2 }
  },
  ladder: { rank: 42, mmr: 1850, climb: 75 },
  trend: {
    recentForm: { n: 10, wins: 6, losses: 4 },
    matchup: { key: 'HvO', wins: 18, losses: 11, winRate: 62, games: 29 }
  }
};

// The four states, and the two attributes that go with each.
//
// `phase` and `board` are what shell.html stamps on <body>, and they are two
// different questions: `phase=idle` collapses the last game (reveal mode only),
// `board=on` says nothing current is on the card at all. Set here rather than
// derived, so a stop is a fixed, reproducible picture.
const stateFor = (phase) => {
  // Never parsed a replay. The genuine empty state, which is what a first-time
  // streamer's scene shows until they finish a game.
  if (phase === 'fresh') {
    return {
      ...BASE,
      session: { wins: 0, losses: 0, unknown: 0, results: [], streak: null },
      trend: null,
      scout: null,
      game: null
    };
  }
  // Resting between games. The last game is IN the payload and collapsed by the
  // phase attribute, which is exactly what a reveal source does when its hold
  // expires — the state the board has to carry.
  if (phase === 'idle') return { ...BASE, scout: null, game: GAME };
  if (phase === 'live') return { ...BASE, scout: SCOUT, game: GAME };
  return { ...BASE, scout: null, game: GAME };
};

const ATTRS = {
  // Reveal OFF — the default, and most pasted URLs. shell.html sets no phase
  // at all in that mode, so the waiting plate (which carries `post`, to get out
  // of a reveal source's way) is painted. `board` still says resting, because
  // nothing current is on the card. Covering the no-phase case here is also
  // what stops the whole matrix from only ever exercising one of the two.
  fresh: { phase: null, board: 'on' },
  // Reveal ON and the hold expired: the last game is in the DOM and collapsed.
  idle: { phase: 'idle', board: 'on' },
  live: { phase: 'post', board: 'off' },
  post: { phase: 'post', board: 'off' }
};

// Everything asserted about one rendered stop. Runs inside the page.
/* eslint-disable no-undef */
function auditInPage (phase, minPx) {
  const bad = [];
  const root = document.getElementById('ov');
  const card = root.querySelector('.card');
  if (!card) return ['no card rendered'];

  // branding
  const mark = card.querySelector('.mark .wordmark');
  if (!mark) bad.push('branding: no WC3V wordmark on the card');
  else {
    const r = mark.getBoundingClientRect();
    const cs = getComputedStyle(mark);
    if (r.width < 8 || r.height < 8) bad.push('branding: wordmark has no box');
    if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.9) {
      bad.push('branding: wordmark is not fully visible');
    }
  }

  // no-stale-verdict. Counted as PAINTED panels, not as elements: the resting
  // card keeps the last game in the DOM and hides it, so a node count would
  // read the collapsed board as a card full of stale verdicts.
  const painted = (n) => !!n && !!n.getClientRects().length;
  const hasLive = painted(card.querySelector('.live-head'));
  // The waiting plate carries `post` so a reveal source can hide it along with
  // everything else about the last game, but it is the STAND-IN for a game
  // rather than one. Counting it here would fail a fresh machine for showing
  // its empty state, and would let a `post` stop pass while showing nothing but
  // "Waiting for a game".
  const postCount = Array.from(card.querySelectorAll('.mod.post'))
    .filter(n => painted(n) && !n.classList.contains('waiting')).length;
  if (phase === 'live') {
    if (!hasLive) bad.push('live: no live header while a match is on');
    if (postCount) bad.push(`no-stale-verdict: ${postCount} last-game panel(s) on a live card`);
  }
  if (phase === 'post') {
    if (hasLive) bad.push('post: a live header with no match on');
    if (!postCount) bad.push('post: no last-game panel after a game');
    // The footer's one-line "last" is the RESTING card's stand-in for the
    // verdict panel. With the panel itself on screen the banner, the
    // head-to-head row and this line are three copies of one result.
    if (painted(card.querySelector('.sess-last'))) {
      bad.push('post: the footer repeats the verdict already on the card');
    }
  }
  if (phase === 'idle' || phase === 'fresh') {
    if (hasLive) bad.push(`${phase}: a live header with no match on`);
    if (postCount) bad.push(`${phase}: ${postCount} last-game panel(s) on a resting card`);
  }

  // board: the resting card is a scoreboard, not a smudge.
  //
  // Every other check on this list passed for the whole of the release where
  // this state was two dim lines in a corner — "the session module is present"
  // was true, its type cleared the 0.8rem floor, and it fitted. So this one
  // grades SIZE: the score at broadcast weight, and the card tall enough to
  // read as an object on a scene rather than a caption.
  //
  // Both floors are in rem-equivalents against the page's own root font size,
  // so the check means the same thing at every scale.
  if (phase === 'idle' || phase === 'fresh') {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const cardH = card.getBoundingClientRect().height;
    if (cardH < 5.5 * rem) {
      bad.push(`board: resting card is ${Math.round(cardH)}px tall, floor is ${Math.round(5.5 * rem)}px`);
    }
    if (phase === 'fresh' && !painted(card.querySelector('.waiting'))) {
      bad.push('board: nothing standing in for the game that has never landed');
    }
    if (phase === 'idle') {
      const score = card.querySelector('.session .score');
      if (!painted(score)) bad.push('board: no session score on the resting card');
      else {
        const px = parseFloat(getComputedStyle(score).fontSize);
        if (px < 1.6 * rem - 0.01) {
          bad.push(`board: session score at ${px.toFixed(1)}px, floor is ${(1.6 * rem).toFixed(1)}px`);
        }
      }
      // The night's shape. It is the one element here that is not a number and
      // the reason the resting card is worth looking at at all.
      const pips = Array.from(card.querySelectorAll('.session .form .pip')).filter(painted);
      if (!pips.length) bad.push('board: no form rail on the resting card');
      // And the last result, which is what the board shows INSTEAD of the
      // verdict panel it just collapsed. Without it a resting card says a game
      // happened and never says how it went.
      if (!painted(card.querySelector('.sess-last'))) {
        bad.push('board: no last result on a resting card that has one');
      }
    }
  }

  // readable: nothing under the project's 0.8rem floor, and nothing invisible
  // against its own bed.
  const parse = (c) => {
    const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(c || '');
    return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
  };
  const lum = (c) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  // The bed a run of text actually sits on: the nearest ancestor painting a
  // non-transparent background. A theme that drops the panel inherits the
  // page's, which is exactly the case worth catching.
  const bedOf = (node) => {
    for (let n = node; n && n !== document.documentElement; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.5) return c;
    }
    return parse(getComputedStyle(document.body).backgroundColor) || { r: 0, g: 0, b: 0, a: 1 };
  };

  const seen = new Set();
  for (const n of card.querySelectorAll('*')) {
    // Only what is on screen. The resting card keeps the whole last game in the
    // DOM behind display:none, and grading type nobody can see would report the
    // collapsed board's problems as the full card's and vice versa.
    if (!painted(n)) continue;
    const text = Array.from(n.childNodes)
      .filter(x => x.nodeType === 3 && x.textContent.trim())
      .map(x => x.textContent.trim()).join(' ');
    if (!text) continue;
    const cs = getComputedStyle(n);
    const px = parseFloat(cs.fontSize);
    const key = n.className + '|' + Math.round(px);
    if (px < minPx - 0.01 && !seen.has(key)) {
      seen.add(key);
      bad.push(`readable: "${text.slice(0, 24)}" at ${px.toFixed(1)}px, floor is ${minPx.toFixed(1)}px`);
    }
    // Contrast is only meaningful where the type is not carrying its own
    // outline. The etched theme's whole legibility mechanism is a text-shadow,
    // which no computed-style ratio can see.
    if (cs.textShadow && cs.textShadow !== 'none') continue;
    const fg = parse(cs.color);
    if (!fg || fg.a < 0.95) continue;
    const bg = bedOf(n);
    const a = lum(fg);
    const b = lum(bg);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    // 3:1, the large-text bar. This card's smallest type is 0.8rem at a
    // viewing distance of several metres, so this is a floor and not a target.
    if (ratio < 3 && !seen.has('c' + key)) {
      seen.add('c' + key);
      bad.push(`readable: "${text.slice(0, 24)}" contrast ${ratio.toFixed(2)}:1`);
    }
  }

  // portraits: hero art is the card's ONE remote asset, and overlay-render.js
  // promises a blank tile when it does not arrive, because an OBS machine with
  // no internet still has to draw the whole layout. A broken-image glyph on a
  // live broadcast is the thing that promise exists to prevent.
  // A failed portrait must be GONE from the DOM, not an <img> wearing a blank
  // class: a browser keeps painting its broken-image mark on an image element
  // that already failed, whatever is done to the src afterwards.
  for (const img of card.querySelectorAll('img.portrait')) {
    if (img.naturalWidth === 0) bad.push('portraits: a failed portrait is still an <img>');
  }

  // fits
  const cr = card.getBoundingClientRect();
  if (cr.width > window.innerWidth + 0.5) {
    bad.push(`fits: card is ${Math.round(cr.width)}px in a ${window.innerWidth}px source`);
  }
  if (card.scrollWidth > card.clientWidth + 1) bad.push('fits: card scrolls horizontally');

  return bad;
}
/* eslint-enable no-undef */

(async () => {
  const html = harness();
  if (html.indexOf('/*OVERLAY_CSS*/') !== -1) throw new Error('css placeholder was not replaced');
  if (html.indexOf('/*OVERLAY_RENDER_JS*/') !== -1) throw new Error('renderer placeholder was not replaced');
  // The construction, not the word: shell.html's header comment names
  // EventSource while explaining which origins the page talks to.
  if (html.indexOf('new EventSource(') !== -1) {
    throw new Error('shell client script was not stripped');
  }

  fs.mkdirSync(shotsDir, { recursive: true });
  const harnessPath = path.join(shotsDir, 'harness.html');
  fs.writeFileSync(harnessPath, html);

  const browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: 'new',
    args: ['--no-sandbox', '--force-device-scale-factor=2']
  });

  const failures = [];
  const stops = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 900, deviceScaleFactor: 2 });
    // The card's only remote asset. Blank tiles are a supported state (an OBS
    // machine can be offline), and a real CDN fetch would make this tool's
    // result depend on the network.
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      if (r.url().startsWith('https://cdn.wc3v.com/')) r.abort();
      else r.continue();
    });
    await page.goto('file://' + harnessPath.replace(/\\/g, '/'), { waitUntil: 'load' });

    // The Size control, as shell.html applies it: the scale multiplies the root
    // font size and the whole rem-laid-out card follows. Done here rather than
    // through the URL because the harness strips the shell's client script.
    if (scale !== 1) {
      await page.evaluate((s) => {
        document.documentElement.style.fontSize = (16 * s) + 'px';
      }, scale);
    }

    if (selfTest) {
      // Prove each check can fail before trusting it when it passes.
      for (const s of SABOTAGE) {
        const phase = s.phase || 'live';
        await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, 'carved');
        await page.evaluate((st, at) => {
          if (st.scout) st.scout.startedAt = Date.now() - 9 * 60 * 1000;
          if (at.phase) document.body.dataset.phase = at.phase;
          else delete document.body.dataset.phase;
          document.body.dataset.board = at.board;
          window.OverlayRender.render(document.getElementById('ov'), st, null);
        }, stateFor(phase), ATTRS[phase]);
        const styleId = await page.evaluate((css) => {
          const n = document.createElement('style');
          n.id = 'sabotage';
          n.textContent = css;
          document.head.appendChild(n);
          return n.id;
        }, s.css);
        const bad = await page.evaluate(auditInPage, phase, 12.8 * scale);
        await page.evaluate((id) => {
          const n = document.getElementById(id);
          if (n) n.remove();
        }, styleId);

        const caught = bad.some(b => b.indexOf(s.expect) !== -1);
        console.log(`${caught ? 'ok  ' : 'FAIL'} self-test: ${s.check}`);
        if (!caught) {
          failures.push({ id: `self-test:${s.check}`, bad: [`expected "${s.expect}", got ${JSON.stringify(bad)}`] });
        }
      }
      console.log('');
    }

    for (const theme of themes) {
      for (const phase of phases) {
        const state = stateFor(phase);
        await page.evaluate((t) => {
          document.documentElement.dataset.theme = t;
          document.body.dataset.view = 'obs';
        }, theme);
        await page.evaluate((s, at) => {
          if (s.scout) s.scout.startedAt = Date.now() - 9 * 60 * 1000;
          // What shell.html stamps. `phase` collapses the last game, `board`
          // sizes the resting card; grading without them would grade a state
          // the Browser Source is never in.
          if (at.phase) document.body.dataset.phase = at.phase;
          else delete document.body.dataset.phase;
          document.body.dataset.board = at.board;
          window.OverlayRender.render(document.getElementById('ov'), s, null);
        }, state, ATTRS[phase]);

        // Let the portraits resolve. They are the card's only remote asset, and
        // auditing before their requests have failed would grade the blank-on-
        // error path before it has had a chance to run.
        await page.evaluate(() => Promise.all(
          Array.from(document.querySelectorAll('img.portrait'))
            .filter(i => !i.complete)
            .map(i => new Promise(r => {
              i.addEventListener('load', r, { once: true });
              i.addEventListener('error', r, { once: true });
            }))
        ));

        // The 0.8rem floor, in the page's own pixels: rem-relative, so it means
        // the same thing at every scale.
        const bad = await page.evaluate(auditInPage, phase, 12.8 * scale);

        // live-clock: the card is redrawn every 20-60s, so the clock has to
        // advance on its own between renders or it reads as frozen.
        if (phase === 'live') {
          const first = await page.$eval('.live-head .clk', n => n.textContent).catch(() => null);
          if (!first) bad.push('live-clock: no clock on the live card');
          else {
            await new Promise(r => setTimeout(r, 2100));
            const second = await page.$eval('.live-head .clk', n => n.textContent);
            if (second === first) bad.push(`live-clock: frozen at ${first} across 2s`);
          }
        }

        const id = `${theme}-${phase}`;
        stops.push({ theme, phase, failures: bad });
        if (bad.length) failures.push({ id, bad });
        const line = bad.length ? `FAIL ${id}` : `ok   ${id}`;
        console.log(line);
        bad.forEach(b => console.log(`       ${b}`));

        if (!auditOnly) {
          // Painted only for the shot, and removed straight after, so the next
          // stop's audit never sees it.
          await page.evaluate((bg) => { document.body.style.background = bg; }, backdrop);
          const card = await page.$('.card');
          if (card) await card.screenshot({ path: path.join(shotsDir, `${id}.png`) });
          await page.evaluate(() => { document.body.style.background = ''; });
        }
      }
    }
  } finally {
    await browser.close();
  }

  fs.writeFileSync(path.join(shotsDir, 'audit.json'),
    JSON.stringify({ width, scale, stops }, null, 2));

  console.log(`\n${stops.length} stops, ${failures.length} failed`);
  if (!auditOnly) console.log(`shots in ${shotsDir}`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
