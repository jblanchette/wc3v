// Replay folders: the directories the app reads, as the person labelled them.
//
// People sort replays into folders to label them. `Replays\Ladder`,
// `Replays\vs Happy`, `Replays\Study`, next to the two the game makes under
// `Autosaved`. Every directory that directly holds a replay is a folder here,
// drawn as a tree under its root, and each row can be renamed, switched off or
// removed. None of it touches the disk: Rust (src-tauri/src/folders.rs) owns
// the config, the discovery and the rule that no command in it deletes, moves
// or renames a file.
//
// This module holds the tree in memory, draws it (the same renderer serves
// the first-run screen and Settings, so the two cannot drift), and answers
// "which folder is this game from" for the feed filter and the report header.
//
// ── Paths never reach the DOM ───────────────────────────────────────────────
//
// A path holds the account name and this window is aimed at streamers. The
// tree rows close over their index into `list`; nothing sets a path on an
// element. What a person sees is `label`, which defaults to the directory's
// own name (the label they chose when they made it) and for a discovered
// root is "Replays".
//
// ── Sources ─────────────────────────────────────────────────────────────────
//
// A stored summary carries no path, so knowing a game's folder needs a side
// map, key → directory, kept by Rust in sources.json. New parses record
// theirs as they land (batched, because a backfill is thousands of them);
// games parsed before the map existed are matched by size then hash in one
// background pass at boot (`resolveAll`). A game whose file is gone has no
// folder and simply does not match a folder filter.

(function () {
  'use strict';

  const { node, raceMark } = window.UIBits;

  const SEP = /[\\/]/;
  const parentOf = (path) => {
    const s = String(path || '');
    const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
    return i > 0 ? s.slice(0, i) : '';
  };

  // How many of a folder's newest replays the open row shows. Enough to
  // recognise the folder by its contents; few enough that the tree stays a
  // tree with one row open.
  const PEEK = 5;

  // A file's age, as a person would say it. The list is the newest few, so
  // "today" and "yesterday" do most of the work.
  const fmtWhen = (ms) => {
    if (!ms) return '';
    const d = new Date(ms);
    const now = new Date();
    const day = 24 * 60 * 60 * 1000;
    const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((startOf(now) - startOf(d)) / day);
    const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (days === 0) return `today ${hm}`;
    if (days === 1) return `yesterday ${hm}`;
    if (days < 7) return `${days} days ago`;
    return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  };

  window.createFolders = (deps) => {
    // deps: invoke, log, errText, onChange(), readRecent(folder, files) [optional],
    //       peekOn(path) -> Promise<header> [optional; the newest-files table]
    //
    // onChange fires after every mutation that changes what the scanner
    // reads, so app.js can rescan and restart the watcher.
    //
    // readRecent is the "Read these" button on an open row: parse the newest
    // few games in that one folder now. Absent (the preview harness), the
    // button is not drawn.
    let list = [];
    let dirs = {};             // game key -> directory it was parsed from
    let pending = [];          // sources not yet written
    let flushTimer = 0;
    const hosts = new Set();   // mounted trees, redrawn on every change
    const open = new Set();     // roots opened with Look inside
    const peekOpen = new Set(); // parts whose newest files are listed
    const recent = new Map();  // path -> newest files, or a promise of them

    const apply = (tree) => {
      list = Array.isArray(tree) ? tree : [];
      // The tree changed under the previews, so they are re-read on the
      // next open rather than shown stale.
      recent.clear();
      peeked.clear();
      for (const h of hosts) draw(h.host, h.opts);
    };

    // The newest few files in one folder, cached per path for as long as the
    // tree stands. A folder that cannot be listed reads as empty.
    const recentIn = (path) => {
      if (!recent.has(path)) {
        recent.set(path, deps.invoke('folder_recent', { path, limit: PEEK })
          .then(files => Array.isArray(files) ? files : [])
          .catch((e) => {
            deps.log(`could not list that folder: ${deps.errText(e)}`, 'warn');
            return [];
          }));
      }
      return recent.get(path);
    };

    const load = async () => {
      try {
        apply(await deps.invoke('list_folders'));
      } catch (e) {
        deps.log(`could not read the folder list: ${deps.errText(e)}`, 'err');
      }
      return list;
    };

    const mutate = async (cmd, args, what) => {
      try {
        apply(await deps.invoke(cmd, args));
      } catch (e) {
        deps.log(`could not ${what}: ${deps.errText(e)}`, 'err');
        return false;
      }
      if (deps.onChange) deps.onChange();
      return true;
    };

    // ── Which folder a game is in ─────────────────────────────────────────

    const byPath = () => {
      const m = new Map();
      for (const f of list) m.set(f.path, f);
      return m;
    };

    // The deepest listed folder at or above the game's directory. Walking up
    // covers a game whose own directory is not a folder any more (its files
    // moved, or it was removed) but still sits under one that is.
    const folderOfDir = (dir) => {
      if (!dir) return null;
      const m = byPath();
      let cur = dir;
      while (cur) {
        const f = m.get(cur);
        if (f) return f;
        cur = parentOf(cur);
      }
      return null;
    };

    const folderOf = (key) => folderOfDir(dirs[key]);
    const labelFor = (key) => {
      const f = folderOf(key);
      return f ? f.label : null;
    };

    // Games per folder, for the filter's option list. A folder that is on
    // but has no parsed games is still offered, so switching one on and
    // filtering to it reads "nothing parsed here yet" rather than the folder
    // not existing.
    const options = (games) => {
      const counts = new Map();
      for (const g of games || []) {
        const f = folderOf(g.key);
        if (f) counts.set(f.path, (counts.get(f.path) || 0) + 1);
      }
      return list.map(f => ({
        path: f.path,
        label: f.label,
        depth: f.depth,
        enabled: f.enabled,
        games: counts.get(f.path) || 0
      }));
    };

    // ── Sources ───────────────────────────────────────────────────────────

    const flush = async () => {
      flushTimer = 0;
      if (!pending.length) return;
      const batch = pending;
      pending = [];
      try {
        await deps.invoke('record_sources', { entries: batch });
      } catch (e) {
        // Lost sources are recoverable: the boot pass re-resolves any game
        // without one. Say so once rather than per game.
        deps.log(`could not record where ${batch.length} game(s) came from: ${deps.errText(e)}`, 'warn');
      }
    };

    const recordSource = (key, path) => {
      if (!key || !path) return;
      dirs[key] = parentOf(path);
      pending.push({ key, path });
      if (!flushTimer) flushTimer = setTimeout(flush, 1500);
    };

    const resolveAll = async () => {
      try {
        dirs = (await deps.invoke('resolve_sources')) || {};
      } catch (e) {
        deps.log(`could not work out which folders your games are in: ${deps.errText(e)}`, 'warn');
      }
      return dirs;
    };

    // ── The tree ──────────────────────────────────────────────────────────
    //
    // What a person sees by default is one row per ROOT (an account's
    // Replays folder, or a folder they added by hand) with the total number
    // of replays under it. That is the level people think at: "my replays,
    // yes". "Look inside" opens the root into its parts, and the parts are
    // listed FLAT, one row each, with the files sitting directly in the root
    // as a row of their own beside the subfolders. So "skip the loose files
    // but keep Autosaved › Multiplayer" is two switches next to each other,
    // and nothing cascades: each row's switch is that row's files only. The
    // root's own switch is the sum of them (indeterminate when mixed) and
    // flips all of them at once.
    //
    // Subfolder labels inside the panel are the path BELOW the root, so a
    // nested duplicate tree reads as "Autosaved › Multiplayer › Replays ›
    // Autosaved › Multiplayer" instead of five rows all called Multiplayer.
    // Nothing above the root is ever shown.

    const fmt = (n) => Number(n || 0).toLocaleString();
    const JOIN = ' › ';

    const roots = () => list.filter(f => f.depth === 0);

    // Every folder under `root`, by path prefix, in path order (the list is
    // sorted that way already).
    const under = (root) => {
      const prefix = root.path.replace(/[\\/]+$/, '');
      return list.filter(o => o !== root && o.path.startsWith(prefix) && SEP.test(o.path.charAt(prefix.length)));
    };
    const subtree = (root) => [root, ...under(root)];
    const onCount = (fs) => fs.reduce((n, f) => n + (f.enabled ? (f.direct_count || 0) : 0), 0);
    const allCount = (fs) => fs.reduce((n, f) => n + (f.direct_count || 0), 0);

    const relLabel = (f, root) => {
      if (f.custom_label) return f.label;
      const base = root.path.replace(/[\\/]+$/, '').length;
      const rel = f.path.slice(base).replace(/^[\\/]+/, '');
      return rel.split(SEP).filter(Boolean).join(JOIN) || f.label;
    };

    const summary = () => {
      if (!list.length) return 'No replay folder found. Add the one Warcraft III saves to.';
      const r = roots().length;
      const on = onCount(list);
      const total = allCount(list);
      const head = `${r} replay folder${r === 1 ? '' : 's'}`;
      if (!total) return `${head}, no replays in them yet`;
      if (on === total) return `${head}, ${fmt(total)} replays`;
      return `${head}, ${fmt(on)} replays on, ${fmt(total - on)} skipped`;
    };

    // Switch several folders at once with ONE watcher restart at the end.
    // `folders` is a snapshot; only its paths are used after the first write,
    // since every write replaces `list`.
    const setMany = async (folders, on) => {
      let ok = true;
      for (const f of folders) {
        if (f.enabled === on) continue;
        try {
          apply(await deps.invoke('set_folder_enabled', { path: f.path, enabled: on }));
        } catch (e) {
          deps.log(`could not change that folder: ${deps.errText(e)}`, 'err');
          ok = false;
          break;
        }
      }
      if (deps.onChange) deps.onChange();
      return ok;
    };

    const checkbox = (label, checked, mixed, onToggle) => {
      const wrap = node('label', 'check frow-check');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !!checked;
      box.indeterminate = !!mixed;
      box.setAttribute('aria-label', label);
      box.title = mixed ? 'Partly on. Tick to read all of it' : (checked ? 'On. Untick to skip' : 'Off. Tick to read');
      box.addEventListener('change', async () => {
        box.disabled = true;
        const want = box.checked;
        const ok = await onToggle(want);
        if (!ok) box.checked = !want;
        box.disabled = false;
      });
      wrap.appendChild(box);
      return wrap;
    };

    const renameButton = (f, name, compact) => {
      const rename = node('button', 'btn btn-sm frow-act', compact ? '✎' : 'Rename');
      rename.type = 'button';
      rename.title = 'Change the name shown here. The folder on disk keeps its name.';
      if (compact) rename.setAttribute('aria-label', 'Rename');
      rename.addEventListener('click', () => {
        const field = document.createElement('input');
        field.type = 'text';
        field.className = 'frow-input';
        field.value = f.label;
        field.maxLength = 40;
        field.setAttribute('aria-label', 'Folder name');
        let done = false;
        const commit = async (save) => {
          if (done) return;
          done = true;
          const value = field.value;
          field.replaceWith(name);
          if (save && value.trim() !== f.label) {
            // Typing the directory's own name back is the same as clearing.
            const label = value.trim() === f.name && f.depth > 0 ? null : value;
            await mutate('set_folder_label', { path: f.path, label }, 'rename that folder');
          }
        };
        field.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') commit(true);
          if (e.key === 'Escape') commit(false);
        });
        field.addEventListener('blur', () => commit(true));
        name.replaceWith(field);
        field.focus();
        field.select();
      });
      return rename;
    };

    const removeButton = (f, compact) => {
      const remove = node('button', 'btn btn-sm frow-act', compact ? '×' : 'Remove');
      remove.type = 'button';
      remove.title = 'Stop reading this folder. Nothing on disk is deleted.';
      if (compact) remove.setAttribute('aria-label', 'Remove');
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        await mutate('remove_folder', { path: f.path }, 'remove that folder');
      });
      return remove;
    };

    // A root: the whole account's replays as one row.
    const rootRow = (root, opts) => {
      const kids = subtree(root);
      const on = onCount(kids);
      const total = allCount(kids);
      const allOn = kids.every(f => f.enabled);
      const anyOn = kids.some(f => f.enabled);
      const compact = !!(opts && opts.compact);

      const r = node('div', 'frow is-root');
      if (!anyOn) r.classList.add('is-off');
      r.appendChild(checkbox(`Read ${root.label}`, allOn, anyOn && !allOn, (want) => setMany(kids, want)));

      const name = node('span', 'frow-name', root.label);
      if (root.custom_label) name.title = `Folder: ${root.name}`;
      r.appendChild(name);

      const meta = node('span', 'frow-meta');
      if (!total) meta.textContent = 'empty';
      else if (on === total) meta.textContent = `${fmt(total)} replays`;
      else meta.textContent = `${fmt(on)} of ${fmt(total)} on`;
      r.appendChild(meta);

      const isOpen = open.has(root.path);
      const look = node('button', 'btn btn-sm frow-look', isOpen ? 'Close' : 'Look inside');
      look.type = 'button';
      look.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      look.title = isOpen ? 'Close' : 'Subfolders, and the newest replays in each';
      look.addEventListener('click', () => {
        if (open.has(root.path)) open.delete(root.path); else open.add(root.path);
        for (const h of hosts) draw(h.host, h.opts);
      });
      r.appendChild(look);

      r.appendChild(renameButton(root, name, compact));
      r.appendChild(removeButton(root, compact));
      return r;
    };

    // One part of an open root: its own loose files, or one subfolder.
    const partRow = (f, root, own, opts) => {
      const compact = !!(opts && opts.compact);
      const r = node('div', 'frow is-part');
      if (!f.enabled) r.classList.add('is-off');
      const label = own ? `In ${root.label} itself` : relLabel(f, root);
      r.appendChild(checkbox(`Read ${label}`, f.enabled, false,
        (want) => mutate('set_folder_enabled', { path: f.path, enabled: want }, 'change that folder')));

      const name = node('span', 'frow-name', label);
      if (own) name.classList.add('is-own');
      r.appendChild(name);

      const meta = node('span', 'frow-meta');
      meta.textContent = f.direct_count ? fmt(f.direct_count) : 'empty';
      r.appendChild(meta);

      if (f.direct_count) {
        const isOpen = peekOpen.has(f.path);
        const n = Math.min(PEEK, f.direct_count);
        const btn = node('button', 'btn btn-sm frow-look', isOpen ? 'Hide' : `Newest ${n}`);
        btn.type = 'button';
        btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        btn.title = isOpen ? 'Hide the list' : 'The newest replays here, and a button to read them now';
        btn.addEventListener('click', () => {
          if (peekOpen.has(f.path)) peekOpen.delete(f.path); else peekOpen.add(f.path);
          for (const h of hosts) draw(h.host, h.opts);
        });
        r.appendChild(btn);
      }
      if (!own) {
        r.appendChild(renameButton(f, name, compact));
        r.appendChild(removeButton(f, compact));
      }
      return r;
    };

    // ── The newest replays in one folder ────────────────────────────────
    //
    // A table, one game a row, read off each file's header (~50 ms): who
    // played, on what map, how long, when. The file name is what a person
    // sees only when the header cannot be read.

    const fmtLen = (ms) => {
      const total = Math.round((ms || 0) / 1000);
      return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
    };

    // Header info per file, cached per path with the listing.
    const peeked = new Map();
    const peekFile = (file) => {
      if (!deps.peekOn) return Promise.resolve(null);
      if (!peeked.has(file.path)) {
        peeked.set(file.path, deps.peekOn(file.path).catch(() => null));
      }
      return peeked.get(file.path);
    };

    const seatCell = (peek, file) => {
      const cell = node('div', 'fpeek-game');
      if (!peek || !peek.players || !peek.players.length) {
        cell.appendChild(node('span', 'fpeek-file', file.file_name.replace(/\.w3g$/i, '')));
        return cell;
      }
      const seat = (p) => {
        const sp = node('span', 'fpeek-seat');
        sp.appendChild(raceMark(p.race || 'N'));
        sp.appendChild(node('span', 'fpeek-pname', p.name));
        return sp;
      };
      const ps = peek.players;
      cell.appendChild(seat(ps[0]));
      if (ps.length === 2) {
        cell.appendChild(node('i', 'fpeek-vs', 'vs'));
        cell.appendChild(seat(ps[1]));
      } else if (ps.length > 2) {
        cell.appendChild(node('span', 'fpeek-more', `+${ps.length - 1} · ${peek.gameMode || 'team'}`));
      }
      return cell;
    };

    const peekPanel = (f) => {
      const panel = node('div', 'fpeek');
      const table = node('div', 'fpeek-table');
      const head = node('div', 'fpeek-row is-head');
      for (const t of ['Game', 'Map', 'Length', 'When']) head.appendChild(node('span', null, t));
      table.appendChild(head);
      const wait = node('div', 'fpeek-wait', 'Looking…');
      table.appendChild(wait);
      panel.appendChild(table);

      recentIn(f.path).then(async (files) => {
        wait.remove();
        if (!files.length) {
          table.appendChild(node('div', 'fpeek-wait', 'Nothing readable here.'));
          return;
        }
        for (const file of files) {
          const row = node('div', 'fpeek-row');
          if (!file.interesting) row.classList.add('is-short');
          row.title = file.interesting ? '' : 'Ended within seconds of starting. Not read.';
          const peek = await peekFile(file);
          row.appendChild(seatCell(peek, file));
          const mapName = peek && peek.mapName && window.SummaryExtract
            ? window.SummaryExtract.cleanMapName(peek.mapName) : '';
          row.appendChild(node('span', 'fpeek-map', mapName || '—'));
          row.appendChild(node('span', 'fpeek-len', peek && peek.durationMs ? fmtLen(peek.durationMs) : '—'));
          row.appendChild(node('span', 'fpeek-when', fmtWhen(file.modified_ms)));
          table.appendChild(row);
        }
        const playable = files.filter(x => x.interesting);
        const act = node('div', 'fpeek-act');
        if (deps.readRecent && playable.length) {
          if (!f.enabled) {
            act.appendChild(node('span', 'hint hint-inline', 'This folder is off. Tick it to read these.'));
          } else {
            const btn = node('button', 'btn btn-sm',
              `Read ${playable.length === 1 ? 'this game' : `these ${playable.length} games`} now`);
            btn.type = 'button';
            btn.title = 'Parse the newest games here. The rest wait for Parse all replays.';
            btn.addEventListener('click', async () => {
              btn.disabled = true;
              const ok = await deps.readRecent(f, playable);
              if (!ok) btn.disabled = false;
            });
            act.appendChild(btn);
          }
        }
        if (playable.length < files.length) {
          act.appendChild(node('span', 'hint hint-inline',
            `${files.length - playable.length} ended within seconds and ${files.length - playable.length === 1 ? 'is' : 'are'} not read.`));
        }
        if (act.childNodes.length) panel.appendChild(act);
      });
      return panel;
    };

    const draw = (host, opts) => {
      host.innerHTML = '';
      if (!list.length) {
        host.appendChild(node('div', 'empty', 'No replay folders found.'));
        return;
      }
      for (const root of roots()) {
        host.appendChild(rootRow(root, opts));
        if (!open.has(root.path)) continue;
        const inside = node('div', 'finside');
        const parts = [{ f: root, own: true }, ...under(root).map(f => ({ f, own: false }))];
        for (const part of parts) {
          if (part.own && !root.direct_count && parts.length > 1) continue;
          inside.appendChild(partRow(part.f, root, part.own, opts));
          if (peekOpen.has(part.f.path) && part.f.direct_count) inside.appendChild(peekPanel(part.f));
        }
        host.appendChild(inside);
      }
    };

    // Fill a filter <select> with the folders, indented by depth, each with
    // its game count. The current choice survives a refill while its folder
    // still exists. Hidden outright when there is only one folder to pick
    // from, because a filter with one answer is furniture.
    const fillSelect = (select, games) => {
      if (!select) return;
      const opts = options(games);
      const keep = select.value;
      select.innerHTML = '';
      const all = document.createElement('option');
      all.value = '';
      all.textContent = 'All folders';
      select.appendChild(all);
      for (const o of opts) {
        const op = document.createElement('option');
        op.value = o.path;
        op.textContent = `${'  '.repeat(o.depth)}${o.label} (${o.games})`;
        if (!o.enabled) op.textContent += ' off';
        select.appendChild(op);
      }
      select.value = opts.some(o => o.path === keep) ? keep : '';
      select.classList.toggle('is-set', !!select.value);
      select.hidden = opts.length < 2;
    };

    // Mount a tree into `host`; it is redrawn on every change until unmount.
    const mount = (host, opts) => {
      const entry = { host, opts: opts || {} };
      hosts.add(entry);
      draw(host, entry.opts);
      return () => hosts.delete(entry);
    };

    return {
      load,
      get list () { return list; },
      get count () { return list.length; },
      summary,
      mount,
      options,
      fillSelect,
      folderOf,
      labelFor,
      recordSource,
      resolveAll,
      setDirs: (map) => { dirs = map || {}; },
      // The folder picker. A folder inside a root already known is switched
      // on rather than added twice; Rust decides which.
      async add (path) {
        try {
          await deps.invoke('add_root', { path });
        } catch (e) {
          deps.log(`could not add that folder: ${deps.errText(e)}`, 'err');
          return false;
        }
        await load();
        if (deps.onChange) deps.onChange();
        return true;
      },
      // Bring back everything removed and look for new folders on disk.
      restore: () => mutate('restore_folders', {}, 'look for folders again'),
      // Exposed for the preview harness and tests.
      _folderOfDir: folderOfDir
    };
  };
})();
