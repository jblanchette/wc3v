// Profile / coach screen.
//
// A profile is just a name (ProfileAggregate.buildProfile), so "my profile" and
// "look up the guy I just played" are the same code path over the same local
// history. Nothing here calls out to anything — every claim comes from games on
// this machine, and every claim carries the sample size it was drawn from.

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

  // One table shape for matchups / maps / opponents — they are all
  // "label, games, record".
  const recordTable = (heading, rows, labelKey) => {
    const panel = node('section', 'panel');
    panel.appendChild(node('h2', null, heading));
    const table = node('table', 'stat-table');
    const head = node('tr');
    head.appendChild(node('th', null, heading === 'Most faced' ? 'Player' : labelKey));
    head.appendChild(node('th', null, 'Games'));
    head.appendChild(node('th', null, 'Record'));
    table.appendChild(head);

    for (const r of rows) {
      const tr = node('tr');
      tr.appendChild(node('td', null, String(r[labelKey.toLowerCase()] ?? r.name ?? '?')));
      tr.appendChild(node('td', 'num', String(r.games)));
      const decided = r.wins + r.losses;
      tr.appendChild(node('td', 'num', decided
        ? `${r.wins}–${r.losses} (${r.winRate}%)`
        : 'no results'));
      table.appendChild(tr);
    }
    panel.appendChild(table);
    return panel;
  };

  window.createProfileView = (deps) => {
    // deps: log, store, identityName()

    const showMessage = (text) => {
      const host = el('profile-body');
      host.innerHTML = '';
      host.appendChild(node('div', 'empty', text));
    };

    // ── Trend over time ─────────────────────────────────────────────────────
    //
    // Two measures on two separate plots, never one plot with two y-axes: win
    // rate is a percentage and T2 is a duration, and putting them on shared
    // paint invents a relationship out of the scaling.
    //
    // One series each, so no legend — the heading names it. First and last
    // points are labelled directly; the rest carry their numbers in a native
    // tooltip rather than printing a value on every point.
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
      // Three points minimum. Two points joined by a line LOOKS like a trend
      // while being nothing more than two averages with a slope drawn between
      // them; that case gets the then/now readout and no plot.
      const usable = points.filter(pt => pt.value !== null && pt.value !== undefined);
      if (usable.length < 3) return null;

      let lo = Math.min(...usable.map(pt => pt.value));
      let hi = Math.max(...usable.map(pt => pt.value));
      // A flat series would divide by zero and, worse, draw a line through the
      // middle that implies a range it does not have.
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
        t.textContent = `${pt.label} — ${opts.fmt(pt.value)} (n=${pt.n})`;
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

      // Optional — see sparkline(). Below three points this panel is a
      // comparison, not a chart.
      const chart = sparkline(points, { fmt, ariaLabel: title });
      if (chart) box.appendChild(chart);

      // Both ends carry their n. A reader comparing two numbers is entitled to
      // know how many games are behind each of them.
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

      const panel = node('section', 'panel');
      panel.appendChild(node('h2', null, 'Over time'));
      // "up to", because the oldest window is the remainder and is usually
      // short — claiming every point is the same size would be a lie about
      // how much each one is worth.
      panel.appendChild(node('p', 'lead',
        `Blocks of up to ${windows[windows.length - 1].games} games, oldest first. ` +
        'A lifetime average cannot show this: a habit you fixed months ago still ' +
        'counts every game you played before you fixed it.'));

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

    const render = (p) => {
      const host = el('profile-body');
      host.innerHTML = '';

      const head = node('div', 'profile-head');
      head.appendChild(node('h1', 'profile-name', p.name));
      const sub = [`${p.games} games`, `${month(p.firstPlayedAt)} → ${month(p.lastPlayedAt)}`];
      if (p.decided) sub.push(`${p.wins}–${p.losses} (${p.winRate}%)`);
      if (p.unknownResults) sub.push(`${p.unknownResults} without a result`);
      head.appendChild(node('p', 'profile-sub', sub.join(' · ')));
      if (p.races && p.races.length) {
        head.appendChild(node('p', 'profile-sub',
          p.races.map(r => `${RACE[r.race] || r.race} ${r.games}`).join(' · ')));
      }
      host.appendChild(head);

      if (p.statements && p.statements.length) {
        const panel = node('section', 'panel');
        panel.appendChild(node('h2', null, 'What the games say'));
        const list = node('ul', 'coach');
        for (const s of p.statements) list.appendChild(node('li', null, s.text));
        panel.appendChild(list);
        host.appendChild(panel);
      }

      if (p.recentForm && p.recentForm.n) {
        const panel = node('section', 'panel');
        panel.appendChild(node('h2', null, 'Recent form'));
        panel.appendChild(node('p', 'lead',
          `${p.recentForm.wins}–${p.recentForm.losses} over the last ${p.recentForm.n} decided games.`));
        host.appendChild(panel);
      }

      const trend = trendPanel(p);
      if (trend) host.appendChild(trend);

      if (p.matchups && p.matchups.length) host.appendChild(recordTable('Matchups', p.matchups.slice(0, 10), 'Matchup'));
      if (p.maps && p.maps.length) host.appendChild(recordTable('Maps', p.maps.slice(0, 12), 'Map'));
      if (p.opponents && p.opponents.length) host.appendChild(recordTable('Most faced', p.opponents.slice(0, 15), 'Name'));
    };

    const show = async (rawName) => {
      const corpus = await deps.store.loadCorpus();
      if (!corpus.length) {
        showMessage('No games parsed yet. Open Settings and parse your history first.');
        return;
      }
      const name = (rawName || '').trim() || deps.identityName() ||
        ((PA().detectPrimaryName(corpus) || {}).name);
      if (!name) {
        showMessage('Set your player name up top, or type a name to look up.');
        return;
      }
      const profile = PA().buildProfile(corpus, name);
      if (!profile.games) {
        showMessage(`No games with "${name}" in your local history.`);
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
