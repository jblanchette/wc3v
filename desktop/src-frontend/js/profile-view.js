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
