// Free tags on a game. "Grand final", "random hero", "showmatch", "study this".
//
// Free-form on purpose. A schema for tournaments would need rounds, brackets,
// formats and a series model, and every one of those is a guess about how
// somebody runs their event. A list of words the user typed is not a guess, and
// it is the thing both the Library filter and a caster's overlay actually need.
//
// ── Where they live, and why not in the summary ────────────────────────────
//
// A sidecar at <app_data>/labels.json, keyed by the same content key the
// summary is stored under. NOT a field on the summary: the summary is rebuilt
// from the replay on every re-parse, and a schema bump re-parses everything.
// Tags are the only thing in the store a person typed by hand, and a format
// upgrade must never be able to eat them.
//
// The whole map is held in memory. It is a few KB at any realistic history size
// and the Library filters across every game at once, so per-game reads would be
// the wrong shape.

(function () {
  'use strict';

  // Long enough for "Grand final, upper bracket", short enough that a tag
  // cannot become a paragraph somebody has to scroll a chip row past.
  const MAX_LEN = 32;
  const MAX_PER_GAME = 8;

  window.createGameTags = (deps) => {
    // deps: invoke, log, errText
    let map = {};        // { key: [tag, ...] }
    let loaded = false;
    let saving = null;

    // Trimmed, collapsed, deduped case-insensitively, capped. A tag list is a
    // filter index as much as a label, so "Grand Final" and "grand final" being
    // two entries would split the thing they name.
    const clean = (tags) => {
      const seen = new Set();
      const out = [];
      for (const raw of (tags || [])) {
        const t = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, MAX_LEN);
        if (!t) continue;
        const key = t.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(t);
        if (out.length >= MAX_PER_GAME) break;
      }
      return out;
    };

    const persist = () => {
      // One write in flight at a time, chained rather than concurrent. Editing
      // tags fires several saves in a row and two overlapping writes race for
      // the same temp path, so the later rename can lose to the earlier one and
      // the file ends up a version behind what is on screen.
      //
      // Each run re-serialises `map` at the moment it executes, so a queued
      // write always persists the CURRENT state rather than a stale snapshot.
      const run = () => deps.invoke('write_tags', { json: JSON.stringify(map) })
        .catch(e => deps.log(`could not save tags: ${deps.errText(e)}`, 'err'));
      saving = saving ? saving.then(run, run) : run();
      return saving;
    };

    return {
      async load () {
        try {
          const json = await deps.invoke('read_tags');
          const parsed = JSON.parse(json || '{}');
          map = {};
          for (const key of Object.keys(parsed)) {
            const tags = clean(parsed[key]);
            if (tags.length) map[key] = tags;
          }
        } catch (e) {
          // A corrupt or unreadable sidecar must not stop the app booting. It
          // costs the tags, which are recoverable by retyping; refusing to start
          // costs everything.
          deps.log(`could not read tags: ${deps.errText(e)}`, 'err');
          map = {};
        }
        loaded = true;
        return map;
      },

      get: (key) => (key && map[key]) || [],
      has: (key) => !!(key && map[key] && map[key].length),
      loaded: () => loaded,

      // Every distinct tag in use, most-used first. The filter offers these
      // rather than free text alone, because a tag you cannot remember the
      // spelling of is a tag you cannot find.
      all () {
        const counts = new Map();
        for (const key of Object.keys(map)) {
          for (const t of map[key]) {
            const k = t.toLowerCase();
            const cur = counts.get(k) || { tag: t, n: 0 };
            cur.n++;
            counts.set(k, cur);
          }
        }
        return [...counts.values()].sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag));
      },

      async set (key, tags) {
        if (!key) return [];
        const next = clean(tags);
        if (next.length) map[key] = next;
        else delete map[key];
        await persist();
        return next;
      },

      add (key, tag) {
        return this.set(key, [...this.get(key), tag]);
      },

      remove (key, tag) {
        const low = String(tag || '').toLowerCase();
        return this.set(key, this.get(key).filter(t => t.toLowerCase() !== low));
      },

      MAX_LEN,
      MAX_PER_GAME
    };
  };
})();
