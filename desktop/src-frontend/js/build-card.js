// The build card: what a player built, in one card per seat.
//
// This is the site's own `.site-build-card` shape (client/index.html
// `buildCard()`), which packs a whole build into ~280px: heroes with their
// skill grid, the key units, the upgrades, and whether they expanded. The
// desktop Build tab used to be a hero card stack followed by a 16-row
// chronological list per player — the same facts down a column two screens
// tall, in a scroller ~150px high.
//
// The chronological list is not deleted, it sits under the cards on the same
// tab. This card answers "what was the build"; the list answers "in what
// order, exactly".
//
// `heroesOf` and `keyUnits` are exported as well as used here, because the
// report frame draws the same two rows in miniature and the illusion dedupe
// below is not optional.
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
    // `t2Units` and `t3Units` are "distinct units first seen inside this tier",
    // and a hero trained at tier 2 is one of them — so the units row printed
    // Shadow Hunter and Tauren Chieftain next to the Grunts, with the same
    // heroes already drawn above it at full level with their skills.
    // `buildPreview` does not have the problem: it types heroes separately.
    const heroIds = new Set();
    for (const h of (p.heroBuilds || [])) {
      if (h && h.itemId) heroIds.add(h.itemId);
      if (h && h.name) heroIds.add(String(h.name).toLowerCase());
    }

    const seen = new Set();
    const out = [];
    const take = (id, name) => {
      const nameKey = String(name || '').toLowerCase();
      if (!id || seen.has(id) || (nameKey && seen.has(nameKey))) return;
      if (heroIds.has(id) || (nameKey && heroIds.has(nameKey))) return;
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

  // Collapse a list of timestamped transactions into one entry per itemId,
  // carrying how many there were, when, and what it cost in total.
  //
  // Map preserves insertion order, so the result is in first-purchase order —
  // the same first-seen idiom `keyUnits` uses.
  const stack = (rows) => {
    const byId = new Map();
    for (const r of (rows || [])) {
      if (!r || !r.itemId) continue;
      let e = byId.get(r.itemId);
      if (!e) {
        e = {
          itemId: r.itemId,
          name: r.name || 'Item',
          count: 0,
          firstMs: r.gameTimeMs,
          times: [],
          gold: 0
        };
        byId.set(r.itemId, e);
      }
      e.count++;
      if (r.gameTimeFormatted) e.times.push(r.gameTimeFormatted);
      if (r.goldCost) e.gold += r.goldCost;
    }
    return Array.from(byId.values());
  };

  // The hover string for a stacked chip. Six times is already more than anyone
  // reads off a tooltip; the count in front of them is the number that matters,
  // so the tail is dropped rather than the string being allowed to run.
  const stackTitle = (e, noun) => {
    const parts = [e.name || noun];
    if (e.count > 1) parts.push(`×${e.count}`);
    if (e.times.length) {
      const shown = e.times.slice(0, 6).join(', ');
      parts.push(e.times.length > 6 ? `${shown}…` : shown);
    }
    if (e.gold) parts.push(`${e.gold}g`);
    return parts.join(' · ');
  };

  // Icon + an ×N pip, the same geometry the upgrade level pip uses. The pip is
  // suppressed at 1 for the same reason a level-1 upgrade shows none: a row of
  // ×1 badges stops the item somebody bought six of from standing out.
  const stackChip = (e, icon, noun) => {
    const chip = node('span', 'bc-up');
    const img = icon(e.itemId);
    img.classList.add('bc-up-img');
    chip.appendChild(img);
    if (e.count > 1) chip.appendChild(node('span', 'bc-up-n', `×${e.count}`));
    chip.title = stackTitle(e, noun);
    return chip;
  };

  // Past this many distinct icons the Bought row stops being a row and becomes
  // a wall. Ten fits two lines at the narrowest card width the grid allows.
  const MAX_BOUGHT = 10;

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
    // Both derivations are shared. The frame's per-player strips draw the same
    // heroes and the same units in 36px, and re-deriving them there would mean
    // a second copy of the Mirror Image dedupe that nobody would remember to
    // keep in step.
    heroesOf,
    keyUnits,

    // p: a summary player. opts: { icon(itemId), title(node), isYou, compact }
    //
    // `compact` is the team-game form. Six full cards is a document rather than
    // a report, and the per-player depth that makes a 1v1 readable is noise
    // across six seats. It keeps the heroes with their levels, the units and
    // the timing chips, and drops the skill grids, the carried items, the
    // upgrades, the mercs and the purchases.
    //
    // `icon` is injected rather than imported so this file holds no second copy
    // of the CDN base and the id whitelist that games-view.js already owns.
    build (p, opts) {
      const o = opts || {};
      const icon = o.icon;
      const compact = !!o.compact;
      const card = node('article', 'bc' + (compact ? ' bc-compact' : ''));
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

          const skills = compact ? [] : skillLevels(h);
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

          const items = compact ? [] : (h.items || []).filter(it => it.itemId);
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
      const ups = compact ? [] : upgrades(p);
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

      // ── Bought ───────────────────────────────────────────────────────────
      //
      // Every shop purchase used to be its own icon, on the argument that two
      // potions are two decisions. They are — but a 30-minute game is thirty
      // icons across five wrapped rows, and at that point the row says nothing
      // except "this player bought things". The decision is still on the card:
      // it moved from N icons to one icon with an ×N pip, which is the same
      // fact in a shape that does not grow with the length of the game.
      //
      // Split rather than one flat list, because the row is answering two
      // different questions at once. What a player KEPT — claws, an orb, boots
      // — is a build decision and reads in the order it was made. What they
      // SPENT — potions, scrolls, tomes — is a volume, and reads by how much.
      // `ItemClasses` (generated by tools/build-item-classes.js) is the split;
      // anything it has never heard of counts as kept.
      //
      // The hero rows above carry the FINAL bag, which is a third question —
      // what survived to the end, not what was ever paid for.
      const bought = compact ? [] : stack(p.itemPurchases);
      if (bought.length) {
        const classes = window.ItemClasses;
        const isConsumed = (e) => !!(classes && classes.isConsumed(e.itemId));

        const kept = bought.filter(e => !isConsumed(e));
        const used = bought.filter(isConsumed)
          .sort((a, b) => (b.count - a.count) || (a.firstMs - b.firstMs));

        const sec = node('div', 'bc-sec');
        sec.appendChild(node('span', 'bc-label', 'Bought'));
        const row = node('div', 'bc-ups');

        // The cap is on the whole row, not per group, and it is spent on the
        // kept items first: an orb is worth a slot that a fifth kind of potion
        // is not.
        const shown = kept.concat(used);
        const visible = shown.slice(0, MAX_BOUGHT);
        const hidden = shown.slice(MAX_BOUGHT);

        // A hairline between the two groups, only when both are on screen —
        // with one group it points at nothing.
        const dividerAfter = (kept.length && kept.length < visible.length)
          ? kept.length : -1;

        visible.forEach((e, i) => {
          if (i === dividerAfter) row.appendChild(node('span', 'bc-div'));
          row.appendChild(stackChip(e, icon, 'Item'));
        });

        // Nothing is dropped without being counted. Clicking appends the tail
        // in place — no state to hold, and the card never re-renders under a
        // reader who has already expanded it.
        if (hidden.length) {
          const more = node('button', 'bc-more', `+${hidden.length}`);
          more.type = 'button';
          more.title = hidden.map(e => stackTitle(e, 'Item')).join('\n');
          more.addEventListener('click', () => {
            const frag = document.createDocumentFragment();
            for (const e of hidden) frag.appendChild(stackChip(e, icon, 'Item'));
            row.replaceChild(frag, more);
          });
          row.appendChild(more);
        }

        sec.appendChild(row);
        card.appendChild(sec);
      }

      // Mercs stack the same way — six batriders is one decision repeated, not
      // six. No kept/spent split (they are all the one kind) and no cap: a
      // merc camp sells four unit types, so the row cannot run away.
      const mercs = compact ? [] : stack(p.mercenariesHired);
      if (mercs.length) {
        const sec = node('div', 'bc-sec');
        sec.appendChild(node('span', 'bc-label', 'Mercs'));
        const row = node('div', 'bc-ups');
        for (const m of mercs) row.appendChild(stackChip(m, icon, 'Mercenary'));
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
