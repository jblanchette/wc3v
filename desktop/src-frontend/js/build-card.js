// The build card: what a player built, in one card per seat.
//
// This is the site's own `.site-build-card` shape (client/index.html
// `buildCard()`), which packs a whole build into ~280px: heroes with their
// skill grid, the key units, the upgrades, and whether they expanded. The
// desktop Build tab used to be a hero card stack followed by a 16-row
// chronological list per player — the same facts down a column two screens
// tall, in a scroller ~150px high.
//
// The chronological list is not deleted, it moved to Full details, which is
// what that tab is for. This card answers "what was the build"; the list
// answers "in what order, exactly".
//
// The site builds this with template strings from a curated manifest. Here it
// is DOM built from a stored summary, because every string on the card came out
// of a replay a stranger made.
//
// ── What is derived, and from what ──────────────────────────────────────────
//
// Key units    buildPreview (type 'unit', tier 1) + t2Units + t3Units, deduped
//              in first-seen order. buildPreview is capped at 20 events by
//              SummaryExtract, so tier-1 coverage is "the opening" rather than
//              "everything", which is what a build card wants anyway.
// Skill levels highest skillLevel per abilityId across skillOrder. The order
//              itself is a Full details question.
// Upgrades     highest level per itemId across upgradeTimeline.

(function () {
  'use strict';

  const node = (tag, className, text) => {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  };

  const ORDINALS = ['1st', '2nd', '3rd', '4th'];

  const fmt = (ms) => {
    if (ms === null || ms === undefined) return null;
    const total = Math.round(ms / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  };

  // Distinct combat units in first-seen order. Named separately from the
  // extraction so the reason for each source is visible at the call site.
  //
  // Deduped by NAME as well as by itemId. A Troll Headhunter and its upgraded
  // Berserker form are two item ids that the parser gives one display name,
  // "Troll Headhunter/Berserker", so an id-only dedupe printed that chip twice
  // in the same row with the same art. Anything the card cannot tell apart is
  // one entry, because two identical chips read as a bug.
  const keyUnits = (p) => {
    const seen = new Set();
    const out = [];
    const take = (id, name) => {
      const nameKey = String(name || '').toLowerCase();
      if (!id || seen.has(id) || (nameKey && seen.has(nameKey))) return;
      seen.add(id);
      if (nameKey) seen.add(nameKey);
      out.push({ itemId: id, name: name || '' });
    };
    for (const b of (p.buildPreview || [])) {
      if (b.type === 'unit') take(b.itemId, b.name);
    }
    for (const u of (p.t2Units || [])) take(u.itemId, u.name);
    for (const u of (p.t3Units || [])) take(u.itemId, u.name);
    return out;
  };

  const upgrades = (p) => {
    const best = new Map();
    for (const u of (p.upgradeTimeline || [])) {
      if (!u.itemId) continue;
      const level = u.level || 1;
      const prev = best.get(u.itemId);
      if (!prev || level > prev.level) best.set(u.itemId, { ...u, level });
    }
    return Array.from(best.values());
  };

  // One entry per hero TYPE, keeping the richest record.
  //
  // `SummaryExtract.extractHeroBuilds` walks every unit with `meta.hero` set,
  // and a Blademaster's Mirror Image illusions are hero-flagged units carrying
  // the Blademaster's own itemId — the client tracks illusions as real units on
  // purpose (`tryResolveIllusion`). So a game with one Blademaster stores four
  // "heroes": the real one at level 4 with its skill order, and three level-1
  // copies with nothing on them.
  //
  // Warcraft III allows exactly one hero of a type per player, so collapsing by
  // itemId cannot merge two heroes somebody actually had. The stack of hero
  // cards this replaced had the same duplicates and simply hid them down a
  // scroller; a card puts them side by side, which is how this got noticed.
  //
  // Deliberately fixed here rather than in the extractor: every summary already
  // stored carries the duplicates, so a render-side fix is the one that works
  // without re-parsing 3,000 games.
  const heroesOf = (p) => {
    const best = new Map();
    for (const h of (p.heroBuilds || [])) {
      if (!h || !h.itemId) continue;
      const prev = best.get(h.itemId);
      const score = (h.finalLevel || 1) * 100 +
        (h.skillOrder || []).length * 10 + (h.items || []).length;
      if (!prev || score > prev.score) best.set(h.itemId, { hero: h, score });
    }
    return Array.from(best.values()).map(e => e.hero);
  };

  const skillLevels = (hero) => {
    const best = new Map();
    for (const s of (hero.skillOrder || [])) {
      if (!s.abilityId) continue;
      const level = s.skillLevel || 1;
      const prev = best.get(s.abilityId);
      if (!prev || level > prev.level) {
        best.set(s.abilityId, { abilityId: s.abilityId, name: s.skillName || '', level });
      }
    }
    return Array.from(best.values());
  };

  window.BuildCard = {
    // p: a summary player. opts: { icon(itemId), title(node), isYou }
    //
    // `icon` is injected rather than imported so this file holds no second copy
    // of the CDN base and the id whitelist that games-view.js already owns.
    build (p, opts) {
      const o = opts || {};
      const icon = o.icon;
      const card = node('article', 'bc');
      if (o.title) card.appendChild(o.title);

      // ── Heroes ───────────────────────────────────────────────────────────
      const heroes = heroesOf(p).slice(0, 4);
      if (heroes.length) {
        const sec = node('div', 'bc-sec bc-heroes');
        sec.appendChild(node('span', 'bc-label', 'Heroes'));
        const row = node('div', 'bc-heroes-row');
        heroes.forEach((h, i) => {
          const cell = node('div', 'bc-hero');

          const portraitWrap = node('div', 'bc-hero-portrait');
          const img = icon(h.itemId);
          img.classList.add('bc-portrait-img');
          img.title = h.name || 'Hero';
          portraitWrap.appendChild(img);
          // Level rides the portrait rather than a line of its own. A hero's
          // final level and its face are one fact.
          portraitWrap.appendChild(node('span', 'bc-hero-lvl', String(h.finalLevel || 1)));
          portraitWrap.appendChild(node('span', 'bc-hero-ord', ORDINALS[i] || ''));
          cell.appendChild(portraitWrap);

          const skills = skillLevels(h);
          if (skills.length) {
            const grid = node('div', 'bc-skills');
            for (const s of skills) {
              const chip = node('span', 'bc-skill');
              const si = icon(s.abilityId);
              si.classList.add('bc-skill-img');
              chip.appendChild(si);
              chip.appendChild(node('span', 'bc-skill-lvl', String(s.level)));
              chip.title = `${s.name || 'Skill'} ${s.level}`;
              grid.appendChild(chip);
            }
            cell.appendChild(grid);
          }

          const items = (h.items || []).filter(it => it.itemId);
          if (items.length) {
            const bag = node('div', 'bc-items');
            for (const it of items) {
              const ii = icon(it.itemId);
              ii.classList.add('bc-item-img');
              ii.title = it.name || 'Item';
              bag.appendChild(ii);
            }
            cell.appendChild(bag);
          }

          row.appendChild(cell);
        });
        sec.appendChild(row);
        card.appendChild(sec);
      }

      // ── Units ────────────────────────────────────────────────────────────
      const units = keyUnits(p);
      if (units.length) {
        const sec = node('div', 'bc-sec');
        sec.appendChild(node('span', 'bc-label', 'Units'));
        const row = node('div', 'bc-units');
        for (const u of units) {
          const cell = node('div', 'bc-unit');
          const ui = icon(u.itemId);
          ui.classList.add('bc-unit-img');
          cell.appendChild(ui);
          cell.appendChild(node('span', 'bc-unit-name', u.name || ''));
          cell.title = u.name || '';
          row.appendChild(cell);
        }
        sec.appendChild(row);
        card.appendChild(sec);
      }

      // ── Upgrades ─────────────────────────────────────────────────────────
      const ups = upgrades(p);
      if (ups.length) {
        const sec = node('div', 'bc-sec');
        sec.appendChild(node('span', 'bc-label', 'Upgrades'));
        const row = node('div', 'bc-ups');
        for (const u of ups) {
          const chip = node('span', 'bc-up');
          const ui = icon(u.itemId);
          ui.classList.add('bc-up-img');
          chip.appendChild(ui);
          // A level pip only where levels exist. Every upgrade showing "1"
          // makes the ones that reached 3 stop standing out.
          if (u.level > 1) chip.appendChild(node('span', 'bc-up-lvl', String(u.level)));
          chip.title = `${u.name || 'Upgrade'}${u.level > 1 ? ` ${u.level}` : ''}`;
          row.appendChild(chip);
        }
        sec.appendChild(row);
        card.appendChild(sec);
      }

      const mercs = (p.mercenariesHired || []).filter(m => m.itemId);
      if (mercs.length) {
        const sec = node('div', 'bc-sec');
        sec.appendChild(node('span', 'bc-label', 'Mercs'));
        const row = node('div', 'bc-ups');
        for (const m of mercs) {
          const chip = node('span', 'bc-up');
          const mi = icon(m.itemId);
          mi.classList.add('bc-up-img');
          chip.appendChild(mi);
          chip.title = `${m.name || 'Mercenary'} · ${m.gameTimeFormatted || ''}${m.goldCost ? ` · ${m.goldCost}g` : ''}`;
          row.appendChild(chip);
        }
        sec.appendChild(row);
        card.appendChild(sec);
      }

      // ── The shape of the build, as chips ─────────────────────────────────
      //
      // The site card carries one expansion badge. A replay knows more than a
      // curated build does, so the timings that define a build ride here too.
      // Nothing that is null gets a chip: "T3 —" is a row of furniture.
      const chips = node('div', 'bc-chips');
      const chip = (label, value, kind) => {
        if (!value) return;
        const c = node('span', 'bc-chip', `${label} ${value}`);
        if (kind) c.dataset.kind = kind;
        chips.appendChild(c);
      };
      chip('T2', fmt(p.tier2Time), 'tier');
      chip('T3', fmt(p.tier3Time), 'tier');
      chip('Tower', fmt(p.firstTowerTime), 'tower');
      if (p.expansionTime !== null && p.expansionTime !== undefined) {
        const c = node('span', 'bc-chip', `Expo ${fmt(p.expansionTime)}`);
        c.dataset.kind = 'expo';
        chips.appendChild(c);
      } else {
        const c = node('span', 'bc-chip', 'No expo');
        c.dataset.kind = 'no-expo';
        chips.appendChild(c);
      }
      if (chips.children.length) card.appendChild(chips);

      return card;
    }
  };
})();
