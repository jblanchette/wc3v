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

  const { node } = window.UIBits;

  const SEP = /[\\/]/;
  const parentOf = (path) => {
    const s = String(path || '');
    const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
    return i > 0 ? s.slice(0, i) : '';
  };

  window.createFolders = (deps) => {
    // deps: invoke, log, errText, onChange()
    //
    // onChange fires after every mutation that changes what the scanner
    // reads, so app.js can rescan and restart the watcher.
    let list = [];
    let dirs = {};             // game key -> directory it was parsed from
    let pending = [];          // sources not yet written
    let flushTimer = 0;
    const hosts = new Set();   // mounted trees, redrawn on every change

    const apply = (tree) => {
      list = Array.isArray(tree) ? tree : [];
      for (const h of hosts) draw(h.host, h.opts);
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

    const fmt = (n) => Number(n || 0).toLocaleString();

    const summary = () => {
      let on = 0;
      let replays = 0;
      for (const f of list) {
        if (!f.enabled) continue;
        on++;
        replays += f.direct_count || 0;
      }
      if (!list.length) return 'No replay folder found. Add the one Warcraft III saves to.';
      const folders = `${on} of ${list.length} folder${list.length === 1 ? '' : 's'} on`;
      return replays
        ? `${folders}, ${fmt(replays)} replays`
        : `${folders}, no replays in them yet`;
    };

    // Every folder under `f`, by path prefix. Used to cascade a switch: turning
    // a root off and leaving its children on would be a surprise in the other
    // direction.
    const descendants = (f) => {
      const prefix = f.path.replace(/[\\/]+$/, '');
      return list.filter(o => o !== f && o.path.startsWith(prefix) && SEP.test(o.path.charAt(prefix.length)));
    };

    const row = (f, i, opts) => {
      const r = node('div', 'frow');
      r.style.setProperty('--depth', String(f.depth));
      if (!f.enabled) r.classList.add('is-off');
      if (f.depth === 0) r.classList.add('is-root');

      const check = node('label', 'check frow-check');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !!f.enabled;
      box.setAttribute('aria-label', `Read ${f.label}`);
      box.title = f.enabled ? 'On. Untick to skip this folder' : 'Off. Tick to read this folder';
      box.addEventListener('change', async () => {
        const on = box.checked;
        box.disabled = true;
        const self = list[i];
        const kids = descendants(self);
        // Cascade DOWN only. Switching a child on does not drag its parent.
        let ok = await mutate('set_folder_enabled', { path: self.path, enabled: on }, 'change that folder');
        for (const k of kids) {
          if (!ok) break;
          if (k.enabled === on) continue;
          ok = await mutate('set_folder_enabled', { path: k.path, enabled: on }, 'change that folder');
        }
        if (!ok) box.checked = !on;
        box.disabled = false;
      });
      check.appendChild(box);
      r.appendChild(check);

      const name = node('span', 'frow-name', f.label);
      if (f.custom_label) name.title = `Folder: ${f.name}`;
      r.appendChild(name);

      // Direct count is the honest number for a row; a root that holds only
      // subfolders says so rather than showing a zero next to thousands.
      const meta = node('span', 'frow-meta');
      if (f.direct_count) meta.textContent = fmt(f.direct_count);
      else if (f.total_count) meta.textContent = `${fmt(f.total_count)} in subfolders`;
      else meta.textContent = 'empty';
      meta.title = f.direct_count ? 'replays in this folder' : '';
      r.appendChild(meta);

      const rename = node('button', 'btn btn-sm frow-act', 'Rename');
      rename.type = 'button';
      rename.title = 'Change the name shown here. The folder on disk keeps its name.';
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
      r.appendChild(rename);

      const remove = node('button', 'btn btn-sm frow-act', 'Remove');
      remove.type = 'button';
      remove.title = 'Stop reading this folder. Nothing on disk is deleted.';
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        await mutate('remove_folder', { path: list[i].path }, 'remove that folder');
      });
      r.appendChild(remove);

      if (opts && opts.compact) {
        rename.textContent = '✎';
        rename.setAttribute('aria-label', 'Rename');
        remove.textContent = '×';
        remove.setAttribute('aria-label', 'Remove');
      }
      return r;
    };

    const draw = (host, opts) => {
      host.innerHTML = '';
      if (!list.length) {
        host.appendChild(node('div', 'empty', 'No replay folders found.'));
        return;
      }
      list.forEach((f, i) => host.appendChild(row(f, i, opts)));
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
