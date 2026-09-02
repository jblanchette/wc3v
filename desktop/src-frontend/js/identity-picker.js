// "Which player are you?", answered from your most recent games.
//
// The header of every replay names its seats, so the ten newest games on
// disk are read (headers only, ~50 ms each) and every name in them becomes a
// card: the name, the races it played, how many of those games it was in.
// The account owner is in nearly all of them and nobody else comes close, so
// the right card is the first one. Picking a card is the whole job.
//
// Only when none of the cards is right does typing come into it, and typing
// is forgiving: "jeef" finds "Jeef#1496". The match runs over every name the
// app has seen, from the recent headers and from the parsed history, so the
// battle tag comes from the replay rather than from memory.
//
// One component, two hosts. The first-run screen mounts it as a step, and
// the "You" popover in the app bar mounts it again, so changing your mind
// later looks exactly like choosing the first time. Both are handed the same
// dependencies by app.js; neither reads anything of its own.

(function () {
  'use strict';

  const { node, raceMark, buildIcon } = window.UIBits;

  // The race as the game draws it: the town hall of each race off the icon
  // CDN, the way the build cards draw units. Random and unknown have no
  // building and keep the heraldic mark.
  const RACE_ICON = { H: 'htow', O: 'ogre', E: 'etol', U: 'unpl' };
  const raceIcon = (race, big) => {
    const id = RACE_ICON[race];
    if (!id) {
      const m = raceMark(race || 'N', big);
      m.classList.add('who-icon');
      return m;
    }
    const img = buildIcon(id);
    img.classList.add('who-icon');
    if (big) img.classList.add('is-big');
    img.title = ({ H: 'Human', O: 'Orc', E: 'Night Elf', U: 'Undead' })[race];
    return img;
  };

  // In at least this share of the recent games, and clear of whoever is
  // second: the leader gets the big card and everyone else the small ones.
  const STRONG_SHARE = 0.8;

  const norm = (s) => String(s || '').toLowerCase().trim();
  const baseOf = (s) => norm(s).replace(/#\d+$/, '');

  // Names from the recent headers, folded into one row per player.
  // seats: [{ name, race, fileName, playedAt }]
  const summarise = (seats) => {
    const games = new Set();
    const byKey = new Map();
    for (const s of seats || []) {
      const key = norm(s.name);
      if (!key) continue;
      games.add(s.fileName);
      const cur = byKey.get(key) || { name: s.name, races: [], games: new Set(), lastAt: 0 };
      if (s.race && !cur.races.includes(s.race)) cur.races.push(s.race);
      cur.games.add(s.fileName);
      cur.lastAt = Math.max(cur.lastAt, s.playedAt || 0);
      byKey.set(key, cur);
    }
    const rows = [...byKey.values()]
      .map(r => ({ name: r.name, races: r.races, games: r.games.size, lastAt: r.lastAt }))
      .sort((a, b) => b.games - a.games || b.lastAt - a.lastAt);
    return { total: games.size, rows };
  };

  // Typed text against every known name. Exact first, then the part before
  // the #tag, then a prefix, then anywhere inside. Case never matters, and
  // each name appears once however many ways it matched.
  const matchNames = (query, names) => {
    const q = norm(query);
    if (!q) return [];
    const qBase = q.replace(/#\d+$/, '');
    const tiers = [[], [], [], []];
    const seen = new Set();
    for (const raw of names || []) {
      const n = norm(raw);
      if (!n || seen.has(n)) continue;
      let tier = -1;
      if (n === q) tier = 0;
      else if (baseOf(raw) === qBase) tier = 1;
      else if (n.startsWith(q)) tier = 2;
      else if (n.includes(q)) tier = 3;
      if (tier < 0) continue;
      seen.add(n);
      tiers[tier].push(raw);
    }
    return tiers.flat();
  };

  window.IdentityPicker = { summarise, matchNames };

  window.createIdentityPicker = (deps) => {
    // deps: recentSeats() -> Promise<seat[]>, knownNames() -> string[],
    //       onPick(name), current() -> name|null, log,
    //       onSuggest(name) [optional; a strong leader with nothing set yet]
    let host = null;
    let opts = {};
    let summary = null;     // { total, rows } once the headers are read
    let reading = false;
    let searching = false;
    let query = '';

    const fmtWhen = (ms) => {
      if (!ms) return '';
      const d = new Date(ms);
      const days = Math.round((Date.now() - ms) / 86400000);
      if (days <= 0) return 'today';
      if (days === 1) return 'yesterday';
      if (days < 7) return `${days} days ago`;
      return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
    };

    const pick = (name) => {
      const clean = String(name || '').trim();
      if (!clean) return;
      searching = false;
      query = '';
      deps.onPick(clean);
      draw();
    };

    const card = (row, total, kind) => {
      // kind: 'hero' (the one big card), 'small' (the others under it), or
      // '' (the even grid when nobody leads).
      const active = norm(row.name) === norm(deps.current());
      const b = node('button', 'who-card' + (active ? ' is-active' : '') +
        (kind === 'hero' ? ' is-hero' : kind === 'small' ? ' is-small' : ''));
      b.type = 'button';
      if (row.races.length === 1) b.dataset.race = row.races[0];

      const icons = node('span', 'who-races');
      for (const r of row.races.slice(0, 3)) icons.appendChild(raceIcon(r, kind === 'hero'));
      b.appendChild(icons);

      const text = node('div', 'who-text');
      text.appendChild(node('span', 'who-name', row.name));
      const meta = node('div', 'who-meta');
      meta.appendChild(node('span', null,
        `${row.games} of ${total} recent game${total === 1 ? '' : 's'}`));
      if (row.lastAt && kind !== 'small') meta.appendChild(node('span', 'who-when', `last ${fmtWhen(row.lastAt)}`));
      text.appendChild(meta);
      b.appendChild(text);

      if (active) b.appendChild(node('span', 'who-tag is-you', kind === 'hero' ? 'This is you' : 'You'));
      else if (kind === 'hero') b.appendChild(node('span', 'who-tag', 'Most likely you'));
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
      b.addEventListener('click', () => pick(row.name));
      return b;
    };

    const searchBlock = () => {
      const box = node('div', 'who-search');
      const field = node('label', 'field');
      field.appendChild(node('span', 'field-label', 'Your name, or the start of it'));
      const input = document.createElement('input');
      input.type = 'text';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.placeholder = 'jeef finds Jeef#1496';
      input.value = query;
      field.appendChild(input);
      box.appendChild(field);
      const out = node('div', 'who-matches');
      box.appendChild(out);

      const pool = () => {
        const names = [];
        if (summary) for (const r of summary.rows) names.push(r.name);
        try { for (const n of deps.knownNames() || []) names.push(n); } catch (e) { /* no history yet */ }
        return names;
      };

      const redraw = () => {
        out.innerHTML = '';
        const q = input.value.trim();
        query = q;
        if (!q) return;
        const hits = matchNames(q, pool()).slice(0, 8);
        for (const name of hits) {
          const b = node('button', 'choice', name);
          b.type = 'button';
          b.addEventListener('click', () => pick(name));
          out.appendChild(b);
        }
        // Exactly what was typed, when nothing on disk says otherwise. A
        // name without a #tag scores games under the pre-Reforged name and
        // cannot be looked up on the ladder, and the hint says so.
        const exact = hits.some(h => norm(h) === norm(q));
        if (!exact) {
          const b = node('button', 'choice choice-typed', `Use "${q}" as typed`);
          b.type = 'button';
          b.addEventListener('click', () => pick(q));
          out.appendChild(b);
          if (!/#\d+$/.test(q)) {
            out.appendChild(node('p', 'hint',
              'Include the #number to match the ladder. It is in every replay you play.'));
          }
        }
      };
      input.addEventListener('input', redraw);
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const first = out.querySelector('button');
        if (first) first.click();
      });
      redraw();
      setTimeout(() => input.focus(), 0);
      return box;
    };

    const draw = () => {
      if (!host) return;
      host.innerHTML = '';
      const wrap = node('div', 'who' + (opts.compact ? ' is-compact' : ''));

      const status = node('p', 'who-status');
      if (reading) status.textContent = 'Reading your most recent games…';
      else if (!summary || !summary.total) status.textContent = 'No recent games found on disk yet.';
      else status.textContent = `From your ${summary.total} most recent game${summary.total === 1 ? '' : 's'}. Click your name.`;
      wrap.appendChild(status);

      if (summary && summary.rows.length) {
        const rows = summary.rows.slice(0, opts.compact ? 5 : 9);
        if (strongLeader(summary)) {
          // One big card for the person this almost certainly is, and the
          // rest small under a heading, so the obvious click is the big one.
          wrap.appendChild(card(rows[0], summary.total, 'hero'));
          if (rows.length > 1) {
            wrap.appendChild(node('p', 'who-others', 'Other names in these games'));
            const grid = node('div', 'who-grid is-small');
            for (const r of rows.slice(1)) grid.appendChild(card(r, summary.total, 'small'));
            wrap.appendChild(grid);
          }
        } else {
          const grid = node('div', 'who-grid');
          for (const r of rows) grid.appendChild(card(r, summary.total, ''));
          wrap.appendChild(grid);
        }
      }

      // With nothing to list (still reading, or nothing on disk) the search
      // is the only way in and shows on its own, without the toggle. That is
      // computed per draw rather than stored, so cards arriving after a
      // read do not find the search already open.
      const hasCards = !!(summary && summary.rows.length);
      const showSearch = searching || (!hasCards && !reading);
      if (hasCards) {
        const els = node('div', 'who-else');
        const notMe = node('button', 'btn btn-sm', searching ? 'Back to the list' : 'None of these are me');
        notMe.type = 'button';
        notMe.addEventListener('click', () => { searching = !searching; draw(); });
        els.appendChild(notMe);
        wrap.appendChild(els);
      }
      if (showSearch) wrap.appendChild(searchBlock());

      host.appendChild(wrap);
    };

    const strongLeader = (sum) => {
      if (!sum || !sum.rows.length || !sum.total) return false;
      const [top, second] = sum.rows;
      return (!second || top.games > second.games) && top.games / sum.total >= STRONG_SHARE;
    };

    const refresh = async () => {
      reading = true;
      draw();
      let seats = [];
      try {
        seats = await deps.recentSeats();
      } catch (e) {
        deps.log(`could not read your recent games: ${e && e.message ? e.message : e}`, 'warn');
      }
      summary = summarise(seats);
      reading = false;
      // A strong leader with nothing chosen yet is put in place as a guess,
      // so the big card already reads "This is you" and Start needs no
      // click here. It stays a guess (not confirmed) until a card is clicked.
      if (deps.onSuggest && strongLeader(summary) && !deps.current()) {
        deps.onSuggest(summary.rows[0].name);
      }
      draw();
      return summary;
    };

    return {
      mount (h, o) {
        host = h;
        opts = o || {};
        draw();
      },
      refresh,
      // The current name changed elsewhere; repaint so the "You" tag moves.
      redraw: draw,
      get summary () { return summary; }
    };
  };
})();
