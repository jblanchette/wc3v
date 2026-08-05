// Which player is "you".
//
// Every verdict depends on this, so getting it wrong silently reports wins as
// losses. It shipped wrong once: detection ran over the parsed store, which
// held one game on a fresh install, and a prefilled text box committed the
// arbitrary first name. The app decided the user was their opponent and called
// a loss a victory.
//
// Nothing in the .w3g format marks which seat saved the replay. The account
// owner is in every game they played and opponents appear once or twice, so
// across a sample of autosaved replays one name dominates. That signal comes
// out of the replay headers alone, with no game parse.
//
// Only autosaved replays get sampled. The Replays root also holds downloaded
// and manually saved games the user was never in, which would poison the count.

(function () {
  'use strict';

  const SAMPLE = 40;
  // The owner should be in nearly every sampled game. Less than that means the
  // sample is mixed, from a shared PC or downloaded replays, so ask instead of
  // guessing.
  const MIN_SHARE = 0.6;

  const el = (id) => document.getElementById(id);

  window.createIdentity = (deps) => {
    // deps: log, makeWorker, peekPlayers, overlayState, replays(), onChange
    let candidates = [];
    let scanned = false;

    const confirmed = () => localStorage.getItem('wc3v-user-name-confirmed') === '1';

    const set = (name, opts) => {
      deps.overlayState.setUserName(name);
      if (opts && opts.confirmed) localStorage.setItem('wc3v-user-name-confirmed', '1');
      render();
      if (deps.onChange) deps.onChange(deps.overlayState.userName);
    };

    // Sample replay headers and count how often each name appears.
    const detectFromDisk = async () => {
      const pool = deps.replays().filter(r => r.autosaved && r.interesting);
      if (pool.length < 3) return null;

      // Spread the sample across the whole history rather than taking the
      // newest N. A recent smurf run or a borrowed PC should not decide this.
      const step = Math.max(1, Math.floor(pool.length / SAMPLE));
      const sample = [];
      for (let i = 0; i < pool.length && sample.length < SAMPLE; i += step) {
        sample.push(pool[i]);
      }

      const worker = deps.makeWorker();
      const counts = new Map();
      let read = 0;
      try {
        for (const r of sample) {
          try {
            const { players } = await deps.peekPlayers(worker, r.path);
            for (const p of players) {
              const key = p.name.toLowerCase().trim();
              if (!key) continue;
              const cur = counts.get(key) || { name: p.name, n: 0 };
              cur.n++;
              counts.set(key, cur);
            }
            read++;
          } catch (e) { /* an odd header; the sample absorbs it */ }
        }
      } finally {
        worker.terminate();
      }
      if (!read) return null;

      const ranked = [...counts.values()].sort((a, b) => b.n - a.n);
      const top = ranked[0];
      const share = top.n / read;
      const clearOfSecond = !ranked[1] || top.n > ranked[1].n;
      return {
        name: top.name,
        share,
        read,
        confident: share >= MIN_SHARE && clearOfSecond,
        ranked: ranked.slice(0, 6)
      };
    };

    const render = () => {
      const known = deps.overlayState.userName;
      el('identity-name').textContent = known || 'not set';
      el('identity-btn').dataset.set = known ? '1' : '0';

      // The picker is always available. A wrong auto-detection has to be one
      // click to fix, which a prefilled text box failed to make obvious.
      const choices = el('identity-choices');
      choices.innerHTML = '';
      for (const name of candidates) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'choice' + (name === known ? ' is-active' : '');
        b.textContent = name;
        b.addEventListener('click', () => {
          set(name, { confirmed: true });
          close();
          deps.log(`you are ${name}`, 'ok');
        });
        choices.appendChild(b);
      }
    };

    const open = () => {
      el('identity-pop').hidden = false;
      el('identity-btn').setAttribute('aria-expanded', 'true');
      el('identity-input').value = deps.overlayState.userName || '';
      el('identity-input').focus();
    };
    const close = () => {
      el('identity-pop').hidden = true;
      el('identity-btn').setAttribute('aria-expanded', 'false');
    };

    el('identity-btn').addEventListener('click', () => {
      if (el('identity-pop').hidden) open(); else close();
    });
    el('identity-save').addEventListener('click', () => {
      const name = el('identity-input').value.trim();
      if (!name) return;
      // Typed by hand, so it outranks any detection.
      if (candidates.indexOf(name) === -1) candidates.unshift(name);
      set(name, { confirmed: true });
      close();
      deps.log(`you are ${name}`, 'ok');
    });
    el('identity-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') el('identity-save').click();
    });
    document.addEventListener('click', (e) => {
      if (el('identity-pop').hidden) return;
      if (el('identity-pop').contains(e.target) || el('identity-btn').contains(e.target)) return;
      close();
    });

    return {
      render,
      open,
      get name () { return deps.overlayState.userName; },
      async resolve () {
        // A guess never overrides an explicit choice.
        if (confirmed()) { render(); return; }
        // Sampling reads 40 replay headers. Once per session is plenty.
        if (scanned) { render(); return; }
        scanned = true;

        const det = await detectFromDisk().catch(() => null);
        if (det) {
          candidates = det.ranked.map(r => r.name);
          if (det.confident) {
            set(det.name, { confirmed: false });
            deps.log(`you look like ${det.name}, in ${Math.round(det.share * 100)}% of ` +
              `${det.read} sampled replays. Click your name up top to change it.`, 'ok');
            return;
          }
        }

        if (!candidates.length) candidates = deps.overlayState.lastGameCandidates;
        render();
        if (candidates.length) {
          deps.log('Click "You" up top and pick your name, so games can be scored.', 'warn');
          open();
        }
      }
    };
  };
})();
