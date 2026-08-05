// Settings: folders, history parsing, startup, updates, ladder lookups.
//
// This is where the machinery went. It used to be the front page, so the app
// opened on a file browser and a log.
//
// NEVER render a filesystem path. Paths contain the user's account name and
// this window is aimed at streamers. Folders are "Replay folder 1/2" and the
// raw path stays in state, out of the DOM as well as off screen.

(function () {
  'use strict';

  const el = (id) => document.getElementById(id);

  const node = (tag, className, text) => {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  };

  window.createSettingsView = (deps) => {
    // deps: invoke, log, backfill, onScan(path), roots(), addRoot(root),
    //       errText, identityName(), onW3cChange(enabled)

    const renderRoots = () => {
      const host = el('roots');
      host.innerHTML = '';
      const roots = deps.roots();
      if (!roots.length) {
        host.appendChild(node('div', 'empty', 'No replay folders found.'));
        return;
      }
      roots.forEach((r, i) => {
        // Index, not path. The click handler closes over the index, so the
        // path stays out of the DOM.
        const row = node('div', 'root');
        row.appendChild(node('span', 'root-name', `Replay folder ${i + 1}`));
        row.appendChild(node('span', 'root-meta', `${r.replay_count.toLocaleString()} replays`));
        const btn = node('button', 'btn btn-sm', 'Rescan');
        btn.type = 'button';
        btn.addEventListener('click', () => deps.onScan(deps.roots()[i].path));
        row.appendChild(btn);
        host.appendChild(row);
      });
    };

    const syncRetryButton = () => {
      const btn = el('backfill-retry');
      const n = deps.backfill().failedCount;
      btn.hidden = deps.backfill().running || n === 0;
      if (n) btn.textContent = `Retry ${n} failed`;
    };

    el('pick-folder').addEventListener('click', async () => {
      const dir = await window.__TAURI__.dialog.open({ directory: true });
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
