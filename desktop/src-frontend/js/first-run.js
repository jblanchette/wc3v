// The first-run screen. Once, on a machine that has never been set up.
//
// Four rows: where your replays are, who you are, whether ladder lookups are
// on, and whether to read the history already on disk. A fifth appears only
// for a big library: whether to read 1v1 games only. Every one of them is
// reachable from Settings afterwards, so nothing here is a decision anybody is
// stuck with, and every row is skippable.
//
// What it is NOT: a tour, a carousel, or a sequence of screens. The app is a
// feed of your games and the fastest way to explain it is to show it.
//
// ── The W3Champions row ─────────────────────────────────────────────────────
//
// It ships checked, because it is what most people want and an opt-in nobody
// ever sees is an opt-in nobody gets. What makes that acceptable is that it is
// stated in front of the person, in the same breath: what it sends, what it
// never sends, and where the switch lives afterwards.
//
// The checkbox is not the setting. It writes through `set_w3c_enabled`, the
// same command Settings uses, and w3c.rs refuses every request until its marker
// file exists. Skipping this screen leaves that marker absent, which means
// skipping is genuinely off rather than defaulted-on-by-omission.

(function () {
  'use strict';

  const el = (id) => document.getElementById(id);

  window.createFirstRun = (deps) => {
    // deps: invoke, log, errText, roots(), addRoot(root), onScan(path),
    //       setIdentity(name), startBackfill(), onW3cChange(on),
    //       onOnly1v1Set(), onDone()

    const sheet = () => el('setup-sheet');

    // Below this the whole run fits in a coffee break and the question is not
    // worth a row on the screen. Above it, hours of parsing are on the table
    // and the filter is offered pre-checked, with the count in front of the
    // person so the default is stated rather than sprung.
    const ONLY_1V1_SUGGEST_AT = 500;

    const renderRoots = () => {
      const roots = deps.roots() || [];
      const line = el('setup-roots');
      const filterRow = el('setup-only1v1-row');
      if (!roots.length) {
        line.textContent = 'No replay folder found. Add the one Warcraft III saves to.';
        if (filterRow) filterRow.hidden = true;
        return;
      }
      // The count is the reassurance. "Found a folder" could be the wrong one;
      // "3,128 replays" is somebody's actual history.
      const total = roots.reduce((n, r) => n + (r.replay_count || 0), 0);
      line.textContent = total
        ? `${roots.length} folder${roots.length > 1 ? 's' : ''}, ${total.toLocaleString()} replays`
        : `${roots.length} folder${roots.length > 1 ? 's' : ''}, no replays in it yet`;

      if (filterRow) {
        filterRow.hidden = total < ONLY_1V1_SUGGEST_AT;
        if (!filterRow.hidden) {
          el('setup-only1v1-hint').textContent =
            `Reading all ${total.toLocaleString()} replays takes hours. This skips ` +
            'team, FFA and custom games; the switch stays in Settings.';
        }
      }
    };

    const close = async () => {
      sheet().hidden = true;
      try {
        await deps.invoke('mark_setup_done');
      } catch (e) {
        // Failing to write the marker means this screen comes back next launch.
        // Annoying, not broken, and worth saying out loud rather than silently
        // looping somebody through setup every time they start the app.
        deps.log(`could not record that setup is done: ${deps.errText(e)}`, 'warn');
      }
      if (deps.onDone) deps.onDone();
    };

    const wire = () => {
      el('setup-folder').addEventListener('click', async () => {
        let dir;
        try {
          dir = await window.__TAURI__.dialog.open({ directory: true });
        } catch (e) {
          deps.log(`could not open the folder picker: ${deps.errText(e)}`, 'err');
          return;
        }
        if (!dir) return;
        try {
          const root = await deps.invoke('add_root', { path: dir });
          deps.addRoot(root);
          renderRoots();
          deps.onScan(root.path);
        } catch (e) {
          deps.log(`could not add that folder: ${deps.errText(e)}`, 'err');
        }
      });

      // Enter on the name field is Start. Somebody who has typed their tag has
      // finished this screen, and making them hunt for a button is friction for
      // its own sake.
      el('setup-name').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') el('setup-start').click();
      });

      el('setup-skip').addEventListener('click', close);

      el('setup-start').addEventListener('click', async () => {
        const name = String(el('setup-name').value || '').trim();
        if (name) deps.setIdentity(name);

        // The W3Champions switch, through the binary rather than around it.
        // Read back what Rust reports rather than what the box says, so a
        // refused write cannot leave the app polling a service it was told not
        // to touch.
        const wantW3c = el('setup-w3c').checked;
        try {
          const actual = await deps.invoke('set_w3c_enabled', { enabled: wantW3c });
          deps.onW3cChange(actual);
          if (actual) deps.log('W3Champions lookups on. Off any time in Settings.', 'ok');
        } catch (e) {
          deps.log(`could not change the W3Champions setting: ${deps.errText(e)}`, 'err');
        }

        // The 1v1 filter, only when its row was actually shown. On a small
        // library nothing is written and the default of reading everything
        // stands. Written before the backfill starts, because the backfill
        // reads the setting at the start of its run.
        const filterRow = el('setup-only1v1-row');
        if (filterRow && !filterRow.hidden) {
          try {
            await deps.invoke('set_only_1v1_enabled', { enabled: el('setup-only1v1').checked });
            if (deps.onOnly1v1Set) deps.onOnly1v1Set();
          } catch (e) {
            deps.log(`could not change the 1v1 filter: ${deps.errText(e)}`, 'err');
          }
        }

        // Backfill last, because it is the long-running one and everything
        // above it changes what it produces. It also needs the identity to be
        // set first, or every game it reads has no seat to score from.
        if (el('setup-backfill').checked) deps.startBackfill();

        await close();
      });
    };

    wire();

    return {
      // Shown only when the marker is absent. Anything that goes wrong reading
      // it counts as "already set up": a broken check must not put a setup
      // screen in front of an existing user.
      async maybeShow () {
        let done = true;
        try {
          done = await deps.invoke('setup_done');
        } catch (e) {
          deps.log(`could not check setup state: ${deps.errText(e)}`, 'warn');
        }
        if (done) return false;
        renderRoots();
        sheet().hidden = false;
        el('setup-name').focus();
        return true;
      },
      renderRoots
    };
  };
})();
