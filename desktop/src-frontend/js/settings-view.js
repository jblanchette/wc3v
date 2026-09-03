// Settings: folders, history parsing, startup, updates, ladder lookups.
//
// This is where the machinery went. It used to be the front page, so the app
// opened on a file browser and a log.
//
// NEVER render a filesystem path. Paths contain the user's account name and
// this window is aimed at streamers. The folder tree (js/folders.js) shows
// labels, and the raw path stays in state, out of the DOM as well as off
// screen.

(function () {
  'use strict';

  const el = (id) => document.getElementById(id);

  window.createSettingsView = (deps) => {
    // deps: invoke, log, backfill, folders, errText, identityName(),
    //       onW3cChange(enabled)

    // The folder tree is drawn by js/folders.js and redraws itself on every
    // change; this only keeps the summary line above it current.
    const renderRoots = () => {
      const line = el('folders-summary');
      if (line) line.textContent = deps.folders.summary();
    };
    // Compact, like the first-run screen. Word buttons ("Rename", "Remove")
    // beside a name and a count do not fit one line in a 430px sheet, so every
    // root row wrapped to two and somebody with fifteen folders could see three
    // of them at a time. The icons are the same controls with the same labels
    // on hover and to a screen reader.
    deps.folders.mount(el('folders'), { compact: true });
    renderRoots();

    const syncRetryButton = () => {
      const btn = el('backfill-retry');
      const n = deps.backfill().failedCount;
      btn.hidden = deps.backfill().running || n === 0;
      if (n) btn.textContent = `Retry ${n} failed`;
    };

    // Which build this is. The update panel only ever said what was AVAILABLE,
    // so "did my change land" had no answer anywhere in the app. Comes from
    // Tauri's package_info, which reads tauri.conf.json, because the Cargo
    // manifest disagreed with it for three releases.
    (async () => {
      const out = el('app-version');
      if (!out) return;
      try {
        const v = await deps.invoke('app_version');
        out.textContent = `WC3V ${v}`;
        // Copyable, because the first thing anybody is asked in a bug report is
        // which version they are on.
        out.addEventListener('click', () => {
          navigator.clipboard.writeText(`WC3V ${v}`).then(
            () => deps.log(`version ${v} copied`, 'ok'),
            () => {}
          );
        });
      } catch (e) {
        out.textContent = 'WC3V (version unavailable)';
      }
    })();

    el('pick-folder').addEventListener('click', async () => {
      let dir;
      try {
        dir = await window.__TAURI__.dialog.open({ directory: true });
      } catch (e) {
        deps.log(`could not open the folder picker: ${deps.errText(e)}`, 'err');
        return;
      }
      if (!dir) return;
      await deps.folders.add(dir);
      renderRoots();
    });

    // Bring back removed folders and look for new ones. The way out of
    // "I removed the wrong one", and the way in for a folder made after the
    // app last looked.
    el('folders-restore').addEventListener('click', async () => {
      if (await deps.folders.restore()) {
        renderRoots();
        deps.log('looked for replay folders again', 'ok');
      }
    });

    el('backfill-toggle').addEventListener('click', () => deps.backfill().toggle());
    el('backfill-retry').addEventListener('click', () => deps.backfill().retryFailed());

    el('autostart-toggle').addEventListener('change', async (e) => {
      const wanted = e.target.checked;
      try {
        // Trust the OS over the click: re-read the real state afterwards, so a
        // silently-refused registry write cannot leave the box lying.
        const actual = await deps.invoke('set_autostart', { enabled: wanted });
        e.target.checked = actual;
        deps.log(actual ? 'WC3V will start with Windows' : 'startup entry removed', 'ok');
      } catch (err) {
        e.target.checked = !wanted;
        deps.log(`could not change the startup setting: ${deps.errText(err)}`, 'err');
      }
    });

    // A local preference with no OS state behind it, unlike autostart. The OS
    // permission gets asked for at the first real notification. A prompt raised
    // from a settings screen has no context to justify it.
    el('notify-toggle').checked = deps.notifyEnabled();
    el('notify-toggle').addEventListener('change', (e) => {
      deps.setNotifyEnabled(e.target.checked);
      deps.log(e.target.checked
        ? 'WC3V will tell you when a game finishes'
        : 'game notifications off', 'ok');
    });

    // An available update is shown and never applied on its own. This app sits
    // in the tray while you play, and a background installer would close the
    // window and raise UAC mid-game.
    const showAvailable = (version, notes) => {
      el('check-update').textContent = `Install ${version}`;
      el('check-update').dataset.install = '1';
      el('update-status').textContent = `version ${version} is ready`;
      const box = el('update-notes');
      box.textContent = notes || '';
      box.hidden = !notes;
      deps.onUpdateAvailable(version);
    };

    const runUpdateCheck = async (install) => {
      const out = el('update-status');
      out.textContent = 'checking…';
      try {
        const r = await deps.invoke('check_for_update', { install });
        if (r.status === 'current') {
          out.textContent = 'up to date';
        } else if (r.status === 'unconfigured') {
          // A dev build, or one shipped without an update endpoint. Say so
          // rather than implying the app is current.
          out.textContent = 'updates are not configured for this build';
        } else if (r.status === 'available') {
          showAvailable(r.version, r.notes);
          deps.log(`update ${r.version} available; click again to install`, 'ok');
        } else if (r.status === 'installed') {
          out.textContent = `installed ${r.version}, restart to apply`;
          deps.log(`update ${r.version} installed; restart WC3V to apply it`, 'ok');
          el('update-notes').hidden = true;
        }
      } catch (err) {
        out.textContent = 'update check failed';
        deps.log(`update check failed: ${deps.errText(err)}`, 'err');
      }
    };

    el('check-update').addEventListener('click', (e) =>
      runUpdateCheck(e.currentTarget.dataset.install === '1'));

    el('autoupdate-toggle').checked = deps.autoUpdateEnabled();
    el('autoupdate-toggle').addEventListener('change', (e) => {
      deps.setAutoUpdateEnabled(e.target.checked);
      deps.log(e.target.checked
        ? 'WC3V will check for updates on its own'
        : 'automatic update checks off', 'ok');
    });

    // W3Champions lookups. Like autostart, the truth lives outside this window:
    // the Rust side refuses every request unless its marker file exists. So the
    // checkbox is re-read from there after every change, and everything that
    // polls hears the answer through onW3cChange.
    const syncW3c = async () => {
      const box = el('w3c-toggle');
      const out = el('w3c-status');
      let on = false;
      try {
        on = !!(await deps.invoke('w3c_enabled'));
        box.checked = on;
        out.textContent = '';
        // The live-match lookup keys off a ladder identity. A name saved
        // outside W3Champions has no tag, and nothing would ever appear.
        const me = deps.identityName();
        if (on && me && !/#\d+$/.test(me)) {
          out.textContent = `Live matches need a battle tag. "${me}" has no #number.`;
        }
      } catch (err) {
        box.checked = false;
        out.textContent = 'unavailable in this build';
      }
      deps.onW3cChange(on);
    };

    // The anonymous usage counter. Same shape as W3C: the truth is a marker
    // file the Rust side (stats.rs) checks on every ping, so the checkbox is
    // re-read after every change rather than trusted.
    const syncStats = async () => {
      const box = el('stats-toggle');
      try {
        box.checked = !!(await deps.invoke('stats_enabled'));
      } catch (err) {
        box.checked = false;
        box.disabled = true;
      }
    };

    // The 1v1 filter for the history backfill. Same authority rule as W3C and
    // stats: the marker file (filter.rs) is the setting, so the box is re-read
    // from Rust after every change rather than trusted.
    const syncOnly1v1 = async () => {
      const box = el('only1v1-toggle');
      try {
        box.checked = !!(await deps.invoke('only_1v1_enabled'));
      } catch (err) {
        box.checked = false;
        box.disabled = true;
      }
    };

    el('only1v1-toggle').addEventListener('change', async (e) => {
      const want = e.target.checked;
      try {
        await deps.invoke('set_only_1v1_enabled', { enabled: want });
        deps.log(want
          ? 'only 1v1 games will be parsed when reading your history'
          : '1v1 filter off; the next Parse all replays reads every game', 'ok');
      } catch (err) {
        deps.log(`could not change the 1v1 filter: ${deps.errText(err)}`, 'err');
      }
      await syncOnly1v1();
    });

    el('stats-toggle').addEventListener('change', async (e) => {
      const want = e.target.checked;
      try {
        await deps.invoke('set_stats_enabled', { enabled: want });
        deps.log(want
          ? 'anonymous usage counter on'
          : 'anonymous usage counter off; this install sends nothing', 'ok');
      } catch (err) {
        deps.log(`could not change the usage counter setting: ${deps.errText(err)}`, 'err');
      }
      await syncStats();
    });

    el('w3c-toggle').addEventListener('change', async (e) => {
      const want = e.target.checked;
      try {
        await deps.invoke('set_w3c_enabled', { enabled: want });
        deps.log(want
          ? 'W3Champions lookups on; replays still never leave this machine'
          : 'W3Champions lookups off', 'ok');
      } catch (err) {
        deps.log(`could not change the W3Champions setting: ${deps.errText(err)}`, 'err');
      }
      await syncW3c();
    });

    return {
      renderRoots,
      syncRetryButton,
      syncW3c,
      syncStats,
      syncOnly1v1,
      // The silent boot and interval check. A failure here is not news: a
      // laptop that woke without a network would otherwise force the Activity
      // drawer open on a red line nobody asked for.
      async checkQuietly () {
        try {
          const r = await deps.invoke('check_for_update', { install: false });
          if (r.status === 'available') showAvailable(r.version, r.notes);
        } catch (e) { /* offline is normal; say nothing */ }
      },
      async syncAutostart () {
        try {
          el('autostart-toggle').checked = await deps.invoke('get_autostart');
        } catch (e) {
          el('autostart-toggle').disabled = true;
        }
      }
    };
  };
})();
