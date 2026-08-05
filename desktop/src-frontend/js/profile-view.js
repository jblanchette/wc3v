// Coach screen.
//
// A profile is just a name (ProfileAggregate.buildProfile), so "my profile" and
// "look up the guy I just played" run the same code over the same local
// history. Nothing here calls out to anything. Every claim comes from games on
// this machine and carries the sample size it was drawn from.

(function () {
  'use strict';

  const el = (id) => document.getElementById(id);
  const PA = () => window.ProfileAggregate;
  const RACE = { O: 'Orc', H: 'Human', U: 'Undead', E: 'Night Elf', R: 'Random' };

  const node = (tag, className, text) => {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  };

  const month = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : '?');

  // One table shape covers matchups, maps and opponents, which are all
  // "label, games, record". `nameClick` turns the label column into a button.
  // In the Most-faced table every row is a player, and a player is a door.
  const recordTable = (heading, rows, labelKey, nameClick) => {
    const table = node('table', 'stat-table');
    const head = node('tr');
    head.appendChild(node('th', null, heading === 'Most faced' ? 'Player' : labelKey));
    head.appendChild(node('th', null, 'Games'));
    head.appendChild(node('th', null, 'Record'));
    table.appendChild(head);

    for (const r of rows) {
      const tr = node('tr');
      const label = String(r[labelKey.toLowerCase()] ?? r.name ?? '?');
      const td = node('td');
      if (nameClick) {
        const b = node('button', 'name-link', label);
        b.type = 'button';
        b.title = `Open ${label} in Coach`;
        b.addEventListener('click', () => nameClick(label));
        td.appendChild(b);
      } else {
        td.textContent = label;
      }
      tr.appendChild(td);
      tr.appendChild(node('td', 'num', String(r.games)));
      const decided = r.wins + r.losses;
      tr.appendChild(node('td', 'num', decided
        ? `${r.wins}–${r.losses} (${r.winRate}%)`
        : 'no results'));
      table.appendChild(tr);
    }
    return table;
  };

  window.createProfileView = (deps) => {
    // deps: log, store, identityName()

    const showMessage = (text) => {
      el('coach-title').innerHTML = '';
      const host = el('profile-body');
      host.innerHTML = '';
      host.appendChild(node('div', 'empty', text));
    };

    // ── Trend over time ─────────────────────────────────────────────────────
    //
    // Each measure gets its own plot. Win rate is a percentage and T2 is a
    // duration, and sharing a y-axis would invent a relationship out of the
    // scaling.
    //
    // One series each, so the heading is the legend. First and last points are
    // labelled directly and the rest carry their numbers in a native tooltip.
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const svgEl = (tag, attrs) => {
      const n = document.createElementNS(SVG_NS, tag);
      for (const k of Object.keys(attrs || {})) n.setAttribute(k, attrs[k]);
      return n;
    };

    const sparkline = (points, opts) => {
      // points: [{ value, label, n }] oldest-first, value already numeric.
      const W = 560;
      const H = 96;
      const PAD_X = 8;
      const PAD_Y = 14;
      // Three points minimum. Two points joined by a line looks like a trend
      // while being two averages with a slope drawn between them, so that case
      // gets the then/now readout and no plot.
      const usable = points.filter(pt => pt.value !== null && pt.value !== undefined);
      if (usable.length < 3) return null;

      let lo = Math.min(...usable.map(pt => pt.value));
      let hi = Math.max(...usable.map(pt => pt.value));
      // A flat series divides by zero, and draws a line through the middle
      // that implies a range it does not have.
      if (hi === lo) { hi = lo + 1; lo = lo - 1; }

      const x = (i) => PAD_X + (i / (points.length - 1)) * (W - PAD_X * 2);
      const y = (v) => H - PAD_Y - ((v - lo) / (hi - lo)) * (H - PAD_Y * 2);

      const svg = svgEl('svg', {
        class: 'spark',
        viewBox: `0 0 ${W} ${H}`,
        preserveAspectRatio: 'none',
        role: 'img',
        'aria-label': opts.ariaLabel
      });

      const d = points
        .map((pt, i) => (pt.value === null ? null : `${i === 0 ? 'M' : 'L'}${x(i)} ${y(pt.value)}`))
        .filter(Boolean)
        .join(' ');
      svg.appendChild(svgEl('path', { class: 'spark-line', d }));

      points.forEach((pt, i) => {
        if (pt.value === null || pt.value === undefined) return;
        const dot = svgEl('circle', {
          class: 'spark-dot', cx: x(i), cy: y(pt.value), r: 4
        });
        const t = svgEl('title', {});
        t.textContent = `${pt.label} · ${opts.fmt(pt.value)} (n=${pt.n})`;
        dot.appendChild(t);
        svg.appendChild(dot);
      });
      return svg;
    };

    const trendPlot = (title, points, fmt) => {
      const first = points.find(pt => pt.value !== null && pt.value !== undefined);
      const last = [...points].reverse().find(pt => pt.value !== null && pt.value !== undefined);
      // Nothing to compare against.
      if (!first || !last || first === last) return null;

      const box = node('div', 'trend-plot');
      box.appendChild(node('h3', null, title));

      // Optional; see sparkline(). Below three points this panel is a
      // comparison rather than a chart.
      const chart = sparkline(points, { fmt, ariaLabel: title });
      if (chart) box.appendChild(chart);

      // Both ends carry their n. Anyone comparing two numbers is entitled to
      // know how many games sit behind each of them.
      const ends = node('div', 'trend-ends');
      ends.appendChild(node('span', 'trend-end', `${fmt(first.value)} then (n=${first.n})`));
      ends.appendChild(node('span', 'trend-end is-now', `${fmt(last.value)} now (n=${last.n})`));
      box.appendChild(ends);
      return box;
    };

    const trendPanel = (p) => {
      const windows = p.trend || [];
      if (windows.length < 2) return null;

      const label = (w, i) => {
        const from = w.from ? month(w.from) : `window ${i + 1}`;
        const to = w.to ? month(w.to) : '';
        return from === to || !to ? `${from} · ${w.games} games` : `${from} → ${to} · ${w.games} games`;
      };

      const panel = node('section', 'panel trend-band');
      panel.appendChild(node('h2', null, 'Over time'));
      // "up to", because the oldest window is the remainder and usually runs
      // short. Claiming every point is the same size would misstate what each
      // one is worth. It lives on a title because the band has no room for a
      // paragraph.
      panel.title =
        `Blocks of up to ${windows[windows.length - 1].games} games, oldest first.`;

      const plots = node('div', 'trend-plots');
      const wr = trendPlot('Win rate',
        windows.map((w, i) => ({ value: w.decided ? w.winRate : null, label: label(w, i), n: w.decided })),
        (v) => `${v}%`);
      const t2 = trendPlot('Tier 2',
        windows.map((w, i) => ({ value: w.t2Median, label: label(w, i), n: w.t2N })),
        (v) => PA().fmtMs(v));
      const w5 = trendPlot('Workers at 5:00',
        windows.map((w, i) => ({ value: w.workersAt5mMedian, label: label(w, i), n: w.workersAt5mN })),
        (v) => String(v));

      for (const plot of [wr, t2, w5]) if (plot) plots.appendChild(plot);
      if (!plots.children.length) return null;
      panel.appendChild(plots);
      return panel;
    };

    // The dashboard. The head band is fixed and the two lower panels of the
    // grid below it are the only scrollers, so the whole view fits the window.
    // "Am I improving" should be answerable at a glance.
    const render = (p) => {
      // Head band: who this is, in one line.
      const title = el('coach-title');
      title.innerHTML = '';
      title.appendChild(node('h1', 'profile-name', p.name));
      const sub = [`${p.games} games`, `${month(p.firstPlayedAt)} → ${month(p.lastPlayedAt)}`];
      if (p.decided) sub.push(`${p.wins}–${p.losses} (${p.winRate}%)`);
      if (p.unknownResults) sub.push(`${p.unknownResults} without a result`);
      if (p.races && p.races.length) {
        sub.push(p.races.map(r => `${RACE[r.race] || r.race} ${r.games}`).join(', '));
      }
      title.appendChild(node('p', 'profile-sub', sub.join(' · ')));
      if (p.recentForm && p.recentForm.n) {
        title.appendChild(node('span', 'form-chip',
          `${p.recentForm.wins}–${p.recentForm.losses} last ${p.recentForm.n}`));
      }

      const host = el('profile-body');
      host.innerHTML = '';

      const trend = trendPanel(p);
      if (trend) host.appendChild(trend);

      // Statements panel: the coach's voice, every claim carrying its n.
      const say = node('section', 'panel coach-cell');
      say.appendChild(node('h2', null, 'What the games say'));
      const sayBody = node('div', 'cell-body scroll');
      if (p.statements && p.statements.length) {
        const list = node('ul', 'coach');
        for (const s of p.statements) list.appendChild(node('li', null, s.text));
        sayBody.appendChild(list);
      } else {
        sayBody.appendChild(node('p', 'lead', 'Not enough decided games yet.'));
      }
      say.appendChild(sayBody);
      host.appendChild(say);

      // Records panel: one switched table at a time, each capped and scrolling
      // inside the cell.
      const records = node('section', 'panel coach-cell');
      const tables = [
        p.matchups && p.matchups.length && {
          key: 'matchups', label: 'Matchups',
          build: () => recordTable('Matchups', p.matchups.slice(0, 10), 'Matchup')
        },
        p.maps && p.maps.length && {
          key: 'maps', label: 'Maps',
          build: () => recordTable('Maps', p.maps.slice(0, 12), 'Map')
        },
        p.opponents && p.opponents.length && {
          key: 'faced', label: 'Most faced',
          build: () => recordTable('Most faced', p.opponents.slice(0, 15), 'Name',
            (name) => show(name, true))
        }
      ].filter(Boolean);

      if (tables.length) {
        const strip = node('div', 'seg records-seg');
        const body = node('div', 'cell-body scroll');
        let active = tables[0].key;
        for (const t of tables) {
          const btn = node('button', 'seg-btn' + (t.key === active ? ' is-on' : ''), t.label);
          btn.type = 'button';
          btn.addEventListener('click', () => {
            active = t.key;
            for (const b of strip.children) b.classList.toggle('is-on', b === btn);
            body.innerHTML = '';
            body.appendChild(t.build());
            body.scrollTop = 0;
          });
          strip.appendChild(btn);
        }
        records.appendChild(strip);
        body.appendChild(tables[0].build());
        records.appendChild(body);
      } else {
        records.appendChild(node('p', 'lead', 'No records yet.'));
      }
      host.appendChild(records);
    };

    // mirrorInput: a name arriving from a click, whether a most-faced row or a
    // name link elsewhere, lands in the lookup box too. What the screen shows
    // and what the box says never disagree.
    const show = async (rawName, mirrorInput) => {
      const corpus = await deps.store.loadCorpus();
      if (!corpus.length) {
        showMessage('No games parsed yet. Parse your history in Settings.');
        return;
      }
      const name = (rawName || '').trim() || deps.identityName() ||
        ((PA().detectPrimaryName(corpus) || {}).name);
      if (!name) {
        showMessage('Set your name up top, or type one to look up.');
        return;
      }
      if (mirrorInput) el('profile-name').value = rawName || '';
      const profile = PA().buildProfile(corpus, name);
      if (!profile.games) {
        showMessage(`No games with "${name}" in your history.`);
        return;
      }
      render(profile);
    };

    el('profile-view').addEventListener('click', () => show(el('profile-name').value));
    el('profile-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') show(el('profile-name').value);
    });

    return { show };
  };
})();
