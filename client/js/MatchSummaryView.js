/**
 * MatchSummaryView.js — the Match Summary screen, as a shared renderer.
 *
 * Three tabs about one finished game: Overview (who was ahead, who each player
 * was, what was measured about them), Army (what they built and researched) and
 * Economy (what they earned, spent, and how it all trended). This file draws
 * all of them and knows about neither app.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The viewer's Match Summary is the best-laid-out screen in the product, and
 * the desktop app now shows the same screen for a game you just played. Two
 * implementations of one screen is the drift the mount-seam rule exists to
 * prevent — the same rule that stops the desktop redrawing the dominance chart
 * (js/dominance-panel.js) or re-deriving a build (schema v5 stores what
 * BuildOrderData produces rather than reimplementing it).
 *
 * So: one renderer, two adapters.
 *
 *   client/js/MatchSummary.js            modal chrome + tabs, viewer adapter
 *   desktop/.../game-report-view.js      report frame, stored-summary adapter
 *
 * ── DOM, not strings ────────────────────────────────────────────────────────
 *
 * The viewer's version built HTML strings and escaped replay text on the way in
 * through Security.js. This builds nodes and assigns `textContent`, so there is
 * no string for a player name to break out of and no escape layer to forget.
 * That is also the desktop's house rule for anything a stranger's replay
 * supplied. The one place a raw string is still trusted is a colour, which is
 * validated by safeColor() below because it reaches a style attribute.
 *
 * ── The model ───────────────────────────────────────────────────────────────
 *
 * Deliberately close to what BuildOrderData already produces, because as of
 * schema v5 both apps hold exactly that shape and a heavier normalisation layer
 * would be work for its own sake.
 *
 *   matchEndMs
 *   players[] {
 *     name, race, raceLabel, raceAccent, raceIconId, color, teamId,
 *     isYou           true for the reader's own seat. Desktop only: that app
 *                     asks who you are once and remembers it, and the viewer
 *                     cannot know which of two strangers loaded the replay.
 *     production      { buildings[], units[] }              BuildOrderData
 *     tierProduction  { heroes[], tierProd{1,2,3} }         BuildOrderData
 *     finalSnapshot   { army, workers, supply, economy, upgrades }
 *     tier2Time, tier3Time            ms, or null for "never"
 *     hasExpansion
 *     apm             { perMinute[], peak, average, categories } | null
 *     itemPurchases[] { itemId, name, count, gold }
 *     itemUses[]      { itemId, name, count }
 *     mercenaries[]   { itemId, name, count, gold }
 *     researchTimeline[] { itemId, name, level, timeFormatted }
 *     heroInventories[]  { name, items[{itemId, name}] }
 *   }
 *   camps[] { groupId, totalLevel, claimState, ownerTeamId, order,
 *             timeFormatted, units[{itemId,name,level}], heroXp[{uuid,name,xp}] }
 *
 * Tier times are null rather than Infinity. The viewer uses Infinity for "never
 * reached" and a stored summary uses null; null is the one that survives JSON,
 * so the adapters converge on it here.
 *
 * ── Injected by the caller ──────────────────────────────────────────────────
 *
 *   icon(itemId)  an <img> (or blank placeholder) for unit/hero/item art.
 *                 The two apps serve art from different origins and disagree
 *                 about the fallback, so neither base URL is in this file.
 *   asset(file)   a URL for a named asset file, e.g. 'atk-normal.jpg'. Separate
 *                 from icon() because these are file names, not item ids, and
 *                 the extensions differ (atk-magic is an SVG).
 */

(function () {
  'use strict';

  const node = (tag, className, text) => {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== null && text !== undefined) n.textContent = String(text);
    return n;
  };

  // Replay-derived colours reach style attributes. Hex, rgb() and a bare
  // keyword only, so a colour out of a replay cannot carry a declaration.
  const safeColor = (s) =>
    /^#[0-9A-Fa-f]{3,8}$|^rgb[a]?\([0-9.,\s%]+\)$|^[a-zA-Z]{1,20}$/.test(String(s == null ? '' : s))
      ? String(s) : '#888';

  // mm:ss, counting total minutes.
  //
  // NOT the viewer's formatGameTime, which reads getUTCMinutes() and therefore
  // wraps a 61-minute game back to 1:00. Identical below the hour, correct above
  // it, and it keeps this file off a global that lives in the viewer's enum file.
  const fmt = (ms) => {
    const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  };

  const T = () => (typeof window !== 'undefined' && window.CombatTables) || null;

  // Hero armor is not in ARMOR_TYPES — it is a matrix key with no icon of its
  // own, and both the roster and the matrix header have to name it anyway.
  const armorInfo = (key) => {
    const t = T();
    if (!t) return null;
    return t.ARMOR_TYPES[key] || (key === 'hero' ? { label: 'Hero', iconFile: '' } : null);
  };

  const attackInfo = (key) => {
    const t = T();
    return t ? t.ATTACK_TYPES[key] : null;
  };

  // ── Small shared pieces ────────────────────────────────────────────────────

  const sectionLabel = (text, extraClass) => {
    const el = node('div', 'ms-section-label' + (extraClass ? ' ' + extraClass : ''), text);
    return el;
  };

  // An icon with an optional ×N pip. The pip is suppressed at 1 for the reason
  // every other count in this product suppresses it: a row of ×1 badges stops
  // the thing somebody made six of from standing out.
  const iconWrap = (o, itemId, title, count) => {
    const wrap = node('div', 'ms-icon-wrap');
    if (title) wrap.title = String(title);
    const img = o.icon(itemId);
    img.classList.add('ms-icon');
    wrap.appendChild(img);
    const c = Number(count) || 0;
    if (c > 1) wrap.appendChild(node('span', 'ms-icon-count', c));
    return wrap;
  };

  const iconGrid = (o, entries) => {
    const grid = node('div', 'ms-icon-grid');
    for (const e of entries) grid.appendChild(iconWrap(o, e.itemId, e.title, e.count));
    return grid;
  };

  const empty = (text) => node('div', 'ms-empty', text);

  // Two columns, one per player. Every tab is built out of this.
  //
  // `p.isYou` marks the reader's own seat. It is set by the desktop adapter,
  // which knows the seat because the app asks who you are once and remembers
  // it; the viewer never sets it, because a replay you loaded off a site says
  // nothing about which of these two people you are.
  const playerColumns = (model, contentFn, colClass) => {
    const wrap = node('div', 'ms-players');
    model.players.forEach((p, i) => {
      const col = node('div', 'ms-player-col' + (colClass ? ' ' + colClass : '') +
        (p.isYou ? ' ms-is-you' : ''));
      const content = contentFn(p, i);
      if (content) col.appendChild(content);
      wrap.appendChild(col);
    });
    return wrap;
  };

  // A packed grid of titled blocks. Two per row at any usable column width,
  // one when the window is narrow enough that a half-column would start
  // wrapping unit names. `.ms-block-wide` takes the whole row.
  const blocks = (list) => {
    const wrap = node('div', 'ms-blocks');
    for (const b of list) if (b) wrap.appendChild(b);
    return wrap;
  };

  // A titled block: the label and the thing it labels, as ONE element.
  //
  // They used to be siblings, which is fine in a tall narrow modal where
  // everything stacks. The desktop's report body is wide and short — about
  // 520px of height against a 600px-wide column — and a stack of five sections
  // needs 730px of it. Packing them into the width is the only way that fits,
  // and a grid cannot pack a label away from its content while they are
  // separate children. See .ms-blocks in match-summary.css.
  const block = (labelText, content, extraClass, labelClass) => {
    const el = node('div', 'ms-block' + (extraClass ? ' ' + extraClass : ''));
    if (labelText) el.appendChild(sectionLabel(labelText, labelClass));
    if (content) el.appendChild(content);
    return el;
  };

  // Same thing with a label element the caller built. The tier headings are
  // coloured chips rather than rules, and rebuilding that as a variant of
  // sectionLabel would be two spellings of one heading.
  const blockOf = (labelEl, content, extraClass) => {
    const el = node('div', 'ms-block' + (extraClass ? ' ' + extraClass : ''));
    if (labelEl) el.appendChild(labelEl);
    if (content) el.appendChild(content);
    return el;
  };

  const frag = () => document.createDocumentFragment();

  // ── Overview ───────────────────────────────────────────────────────────────

  const heroSpells = (o, hero) => {
    const grid = node('div', 'ms-hero-spells-grid');
    for (const spell of (hero.spellList || [])) {
      const learned = hero.learnedSkills && hero.learnedSkills[spell.itemId];
      if (!learned || !learned.level) continue;
      const chip = node('span', 'ms-spell');
      chip.title = `${spell.displayName || 'Skill'} Lv${learned.level}`;
      const img = o.icon(spell.itemId);
      img.classList.add('ms-spell-icon');
      chip.appendChild(img);
      chip.appendChild(node('span', 'ms-spell-level', learned.level));
      grid.appendChild(chip);
    }
    return grid;
  };

  const playerIdentity = (o, p) => {
    const row = node('div', 'ms-player-name');
    if (p.raceIconId) {
      const img = o.icon(p.raceIconId);
      img.classList.add('ms-race-icon');
      img.style.borderColor = safeColor(p.raceAccent);
      row.appendChild(img);
    }
    const nameEl = node('span', null, p.name || '');
    nameEl.style.color = safeColor(p.color);
    row.appendChild(nameEl);
    if (p.raceLabel) {
      const lbl = node('span', 'ms-race-label', p.raceLabel);
      lbl.style.color = safeColor(p.raceAccent);
      row.appendChild(lbl);
    }
    // The one thing on this screen that is about the reader rather than about
    // the game. Loud on purpose: the two columns are otherwise symmetric, and
    // a person opening the report of a game they just played should not have
    // to read a name to find their own half of it.
    if (p.isYou) row.appendChild(node('span', 'ms-you-tag', 'You'));
    return row;
  };

  // Every distinct unit this player made that has combat data, with its count.
  const combatUnits = (tierProduction) => {
    const units = {};
    for (const t of [1, 2, 3]) {
      const tp = tierProduction && tierProduction.tierProd && tierProduction.tierProd[t];
      if (!tp || !tp.units) continue;
      for (const u of tp.units) {
        if (!u.attackType && !u.armorType) continue;
        if (units[u.itemId]) units[u.itemId].count += u.count || 1;
        else units[u.itemId] = {
          itemId: u.itemId, displayName: u.displayName,
          attackType: u.attackType, armorType: u.armorType, count: u.count || 1
        };
      }
    }
    return Object.values(units);
  };

  // The roster, and the matchup matrix when there is a single opponent.
  //
  // The roster is about one player and always renders. The matrix is about this
  // player against the OTHER one, which is only a question in a duel: with six
  // seats, "the opponent" would be whichever of the first two this player is
  // not, and the matrix would confidently compare seat 5 against seat 0.
  const combatBlock = (o, model, p, idx) => {
    const duel = model.players.length === 2;
    const opp = duel ? model.players[idx === 0 ? 1 : 0] : null;

    const mine = combatUnits(p.tierProduction);
    if (!mine.length) return null;
    const theirs = opp ? combatUnits(opp.tierProduction) : [];

    const out = [];

    // ── Unit roster ─────────────────────────────────────────────────────────
    const list = node('div', 'ms-ct-list');
    for (const u of mine) {
      const cell = node('div', 'ms-ct-unit');
      const count = Number(u.count) || 0;

      cell.appendChild(node('span', 'ms-ct-name',
        u.displayName + (count > 1 ? ' x' + count : '')));

      const portrait = node('div', 'ms-ct-portrait-wrap');
      const img = o.icon(u.itemId);
      img.classList.add('ms-ct-unit-icon');
      img.title = u.displayName || '';
      portrait.appendChild(img);
      if (count > 1) portrait.appendChild(node('span', 'ms-ct-count', count));
      cell.appendChild(portrait);

      const types = node('div', 'ms-ct-type-col');
      const typed = (info) => {
        if (!info) return;
        const row = node('div', 'ms-ct-typed');
        if (info.iconFile) {
          const ti = document.createElement('img');
          ti.className = 'ms-ct-type-icon';
          ti.src = o.asset(info.iconFile);
          ti.alt = '';
          ti.addEventListener('error', () => { ti.style.display = 'none'; });
          row.appendChild(ti);
        }
        row.appendChild(node('span', 'ms-ct-type-lbl', info.label));
        types.appendChild(row);
      };
      typed(u.attackType && attackInfo(u.attackType));
      typed(u.armorType && armorInfo(u.armorType));
      cell.appendChild(types);

      list.appendChild(cell);
    }
    out.push(block('Unit Roster', list));

    // ── Damage matchup ──────────────────────────────────────────────────────
    //
    // My attack types down the side, their armor types across the top. Needs
    // the tables and a single opponent, so it is skipped rather than
    // half-drawn without either.
    const tables = T();
    if (!tables || !opp) return out;

    const myAtk = {};
    for (const u of mine) {
      if (!u.attackType || !tables.ATTACK_TYPES[u.attackType]) continue;
      (myAtk[u.attackType] = myAtk[u.attackType] || []).push(u);
    }
    const oppArm = {};
    for (const u of theirs) {
      if (!u.armorType || !armorInfo(u.armorType)) continue;
      const bucket = oppArm[u.armorType] = oppArm[u.armorType] || [];
      if (!bucket.some(x => x.itemId === u.itemId)) bucket.push(u);
    }

    const atkKeys = Object.keys(myAtk);
    const armKeys = Object.keys(oppArm);
    if (!atkKeys.length || !armKeys.length) return out;

    const table = node('table', 'ms-matrix');

    const hdrIcon = (info) => {
      if (!info || !info.iconFile) return null;
      const img = document.createElement('img');
      img.className = 'ms-matrix-hdr-icon';
      img.src = o.asset(info.iconFile);
      img.alt = '';
      img.addEventListener('error', () => { img.style.display = 'none'; });
      return img;
    };

    const head = node('tr');
    head.appendChild(node('td', 'ms-matrix-corner'));
    for (const key of armKeys) {
      const info = armorInfo(key);
      const td = node('td', 'ms-matrix-col-hdr');
      td.title = oppArm[key].map(u => u.displayName).join(', ');
      td.appendChild(node('span', null, info.label));
      const ic = hdrIcon(info);
      if (ic) td.appendChild(ic);
      head.appendChild(td);
    }
    table.appendChild(head);

    for (const atkType of atkKeys) {
      const atk = tables.ATTACK_TYPES[atkType];
      const tr = node('tr');
      const rowHdr = node('td', 'ms-matrix-row-hdr');
      rowHdr.title = myAtk[atkType].map(u => u.displayName).join(', ');
      rowHdr.appendChild(node('span', null, atk.label));
      const ic = hdrIcon(atk);
      if (ic) rowHdr.appendChild(ic);
      tr.appendChild(rowHdr);

      for (const armKey of armKeys) {
        const matrixKey = tables.ARMOR_MATRIX_KEY[armKey];
        const mult = matrixKey && tables.DAMAGE_MATRIX[atkType]
          ? tables.DAMAGE_MATRIX[atkType][matrixKey] : undefined;
        if (mult === undefined) { tr.appendChild(node('td')); continue; }

        const pct = Math.round(mult * 100);
        const cls = mult > 1 ? 'ms-mx-strong' : mult < 1 ? 'ms-mx-weak' : 'ms-mx-neutral';
        const td = node('td', 'ms-matrix-cell ' + cls, pct + '%');
        td.title = `${atk.label} vs ${armorInfo(armKey).label} ` +
          `(${oppArm[armKey].map(u => u.displayName).join(', ')}): ${pct}%`;
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    out.push(block('Damage Matchup', table));
    return out;
  };

  // APM over the game, with the opponent behind it as a ghost line when there
  // is exactly one. Shared Y scale, so the two are comparable rather than each
  // filling its own box. `opp` is null in a team game, for the same reason the
  // matchup matrix drops out there.
  const apmChart = (p, opp) => {
    const data = (p.apm && p.apm.perMinute) || [];
    const oppData = (opp && opp.apm && opp.apm.perMinute) || [];
    const totalMin = Math.max(data.length, oppData.length);
    if (!totalMin) return null;

    const w = 280, h = 60, padL = 24, padR = 2, padT = 10, padB = 12;
    const cW = w - padL - padR;
    const cH = h - padT - padB;
    const peak = Math.max((p.apm && p.apm.peak) || 1, (opp && opp.apm && opp.apm.peak) || 0) || 1;

    const NS = 'http://www.w3.org/2000/svg';
    const svgEl = (tag, attrs) => {
      const el = document.createElementNS(NS, tag);
      for (const k in attrs) el.setAttribute(k, attrs[k]);
      return el;
    };

    const svg = svgEl('svg', { class: 'ms-apm-chart', viewBox: `0 0 ${w} ${h}` });

    // Tier markers, drawn against the same minute grid the lines use.
    const matchMs = totalMin * 60000;
    const tierMark = (t, color, label) => {
      if (t === null || t === undefined || t >= matchMs) return;
      const x = padL + (t / matchMs) * cW;
      svg.appendChild(svgEl('line', {
        x1: x, y1: padT, x2: x, y2: padT + cH,
        stroke: color, 'stroke-width': 1, 'stroke-dasharray': '2,2', opacity: 0.5
      }));
      const txt = svgEl('text', {
        x, y: padT - 2, class: 'ms-chart-label',
        'text-anchor': 'middle', fill: color, 'font-size': 7
      });
      txt.textContent = label;
      svg.appendChild(txt);
    };
    tierMark(p.tier2Time, '#21a5e3', 'T2');
    tierMark(p.tier3Time, '#FFFF33', 'T3');

    for (const f of [0.5, 1]) {
      const y = padT + cH * (1 - f);
      svg.appendChild(svgEl('line', {
        x1: padL, y1: y, x2: w - padR, y2: y, stroke: 'rgba(255,255,255,0.05)'
      }));
      const txt = svgEl('text', {
        x: padL - 3, y: y + 3, class: 'ms-chart-label', 'text-anchor': 'end', 'font-size': 7
      });
      txt.textContent = Math.round(peak * f);
      svg.appendChild(txt);
    }

    const step = Math.max(1, Math.ceil(totalMin / 5));
    for (let i = 0; i <= totalMin; i += step) {
      const txt = svgEl('text', {
        x: padL + (i / totalMin) * cW, y: h - 1,
        class: 'ms-chart-label', 'text-anchor': 'middle', 'font-size': 7
      });
      txt.textContent = i + 'm';
      svg.appendChild(txt);
    }

    const paths = (series) => {
      if (!series.length) return null;
      const pts = series.map((v, i) => ({
        x: padL + ((i + 0.5) / totalMin) * cW,
        y: padT + cH - (v / peak) * cH
      }));
      const line = pts.map((pt, i) => (i === 0 ? 'M' : 'L') + `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ');
      const area = line +
        ` L${pts[pts.length - 1].x.toFixed(1)},${padT + cH} L${pts[0].x.toFixed(1)},${padT + cH} Z`;
      return { line, area };
    };

    const ghost = paths(oppData);
    if (ghost) {
      svg.appendChild(svgEl('path', { d: ghost.area, fill: safeColor(opp.color), opacity: 0.06 }));
      svg.appendChild(svgEl('path', {
        d: ghost.line, fill: 'none', stroke: safeColor(opp.color), 'stroke-width': 1, opacity: 0.3
      }));
    }
    const me = paths(data);
    if (me) {
      svg.appendChild(svgEl('path', { d: me.area, fill: safeColor(p.color), opacity: 0.15 }));
      svg.appendChild(svgEl('path', {
        d: me.line, fill: 'none', stroke: safeColor(p.color), 'stroke-width': 1.5
      }));
    }

    svg.appendChild(svgEl('line', {
      x1: padL, y1: padT + cH, x2: w - padR, y2: padT + cH, stroke: 'rgba(255,255,255,0.08)'
    }));
    return svg;
  };

  // Seven facts about the finished game.
  //
  // Was a two-column <table>, one fact per row, which is 180px of height in a
  // column that has none to spare and leaves the other half of its grid row
  // empty. It is a flat set of label/value pairs, not tabular data — nothing
  // reads down a column — so it flows across the width instead.
  const statsTable = (o, p) => {
    const table = node('div', 'ms-stats');
    const row = (label, valueNode) => {
      const cell = node('div', 'ms-stat');
      cell.appendChild(node('span', 'ms-stat-k', label));
      const v = node('span', 'ms-stat-v');
      if (typeof valueNode === 'string' || typeof valueNode === 'number') v.textContent = valueNode;
      else if (valueNode) v.appendChild(valueNode);
      cell.appendChild(v);
      table.appendChild(cell);
    };

    const maxTier = p.tier3Time !== null ? 3 : p.tier2Time !== null ? 2 : 1;
    row('Max Tier', node('span', 'ms-tier-badge t' + maxTier, 'T' + maxTier));
    row('Expansion', p.hasExpansion
      ? node('span', 'ms-expo-yes', 'Yes')
      : node('span', 'ms-expo-no', 'No'));

    const snap = p.finalSnapshot;
    if (snap) {
      const s = snap.supply || {};
      row('Supply', `${s.used || 0} / ${s.max || 0}`);

      const w = snap.workers || {};
      const workers = node('span');
      const resIcon = (file, title, value) => {
        const img = document.createElement('img');
        img.className = 'ms-res-icon';
        img.src = o.asset(file);
        img.title = title;
        img.alt = '';
        img.addEventListener('error', () => { img.style.display = 'none'; });
        workers.appendChild(img);
        workers.appendChild(document.createTextNode(String(value || 0)));
      };
      resIcon('gold.jpg', 'Gold', w.onGold);
      resIcon('lmbr.jpg', 'Lumber', w.onLumber);
      const pip = node('span', 'ms-res-pip ms-res-build');
      pip.title = 'Building';
      workers.appendChild(pip);
      workers.appendChild(document.createTextNode(String(w.onBuild || 0)));
      row('Workers', workers);

      const eco = snap.economy || {};
      const spend = (file, cls, value) => {
        const cell = node('span');
        const img = document.createElement('img');
        img.className = 'ms-res-icon';
        img.src = o.asset(file);
        img.alt = '';
        img.addEventListener('error', () => { img.style.display = 'none'; });
        cell.appendChild(img);
        cell.appendChild(node('span', cls, Number(value) || 0));
        return cell;
      };
      row('Gold Spent', spend('gold.jpg', 'ms-gold', eco.goldSpent));
      row('Lumber Spent', spend('lmbr.jpg', 'ms-lumber', eco.lumberSpent));
    }

    if (p.apm) row('Effective APM', `${p.apm.average} avg`);
    return table;
  };

  // Tier bars, one per player, on a shared time axis.
  const tierComparison = (model) => {
    const wrap = node('div', 'ms-tier-compare');
    const matchEnd = model.matchEndMs || 0;
    if (!matchEnd) return wrap;

    for (const p of model.players) {
      const row = node('div', 'ms-tier-row' + (p.isYou ? ' ms-is-you' : ''));
      const name = node('span', 'ms-tier-player', p.name || '');
      name.style.color = safeColor(p.color);
      row.appendChild(name);

      const track = node('div', 'ms-tier-bar-track');
      const t2 = p.tier2Time !== null ? p.tier2Time : matchEnd;
      const t3 = p.tier3Time !== null ? p.tier3Time : matchEnd;

      const seg = (cls, widthPct, title) => {
        const s = node('div', 'ms-tier-seg ' + cls);
        s.style.width = widthPct.toFixed(1) + '%';
        s.title = title;
        track.appendChild(s);
      };
      seg('t1', Math.min(t2, matchEnd) / matchEnd * 100,
        `T1: 0:00 — ${fmt(t2)}`);
      if (p.tier2Time !== null) {
        seg('t2', (Math.min(t3, matchEnd) - t2) / matchEnd * 100,
          `T2: ${fmt(t2)} — ${p.tier3Time !== null ? fmt(t3) : 'end'}`);
      }
      if (p.tier3Time !== null) {
        seg('t3', (matchEnd - t3) / matchEnd * 100, `T3: ${fmt(t3)} — end`);
      }
      row.appendChild(track);

      const times = node('span', 'ms-tier-times');
      if (p.tier2Time !== null) times.appendChild(node('span', 'ms-tier-time t2', 'T2 ' + fmt(p.tier2Time)));
      if (p.tier3Time !== null) times.appendChild(node('span', 'ms-tier-time t3', 'T3 ' + fmt(p.tier3Time)));
      row.appendChild(times);

      wrap.appendChild(row);
    }
    return wrap;
  };

  // ── Creep routes ───────────────────────────────────────────────────────────
  //
  // A SLOT, not a drawing. Same seam as the dominance plot above: this file
  // knows neither app, and the route map needs the raw stored summary (camp
  // bounds, hero camp lists, starting positions, map bounds) which the model
  // deliberately does not carry. The caller holds that summary and knows how to
  // resolve a map image — the site serves /maps/, the desktop pulls the CDN —
  // so the caller fills this.
  //
  // Emitted only when the caller says it can fill it, so a runtime without
  // CreepRouteMap gets no empty box.
  const routeSlot = (o, size, cls) => {
    if (!o.wantsRoute) return null;
    const slot = node('div', 'ms-route-slot');
    slot.dataset.size = String(size);
    return block('Creep Routes', slot, cls || 'ms-wide-section ms-creep-route');
  };

  const renderOverview = (o, model) => {
    const out = frag();

    // ── The band ────────────────────────────────────────────────────────────
    //
    // Dominance and tier progression are the only two things on this tab that
    // are about the GAME rather than about a player, and both are read across
    // the whole width. They used to sit under the two columns, which put the
    // one-line answer to "who was winning" below a screenful of rosters.
    //
    // All three are short here. The dominance plot is a shape, not a table of
    // values, and the tier bars are three segments on a track; neither gains
    // anything from height, and every pixel they take is one the columns below
    // do not get.
    const band = node('div', 'ms-ov-band');

    // The dominance slot. Filled by the caller, because the plot is
    // DominanceChart and its data, its gate and its teardown all belong to
    // whoever owns the screen. Emitted only when the caller says it can fill it.
    if (o.wantsDominance) {
      band.appendChild(block('Dominance', node('div', 'ms-dom-slot'), 'ms-ov-band-dom'));
    }
    band.appendChild(block('Tier Progression', tierComparison(model), 'ms-ov-band-tier'));

    // The routes ride the band's third column, beside the result and the tier
    // bars rather than under the rosters.
    //
    // This reverses the original call ("a map squeezed into a quarter of the
    // band is a decoration"), on the grounds that a decoration you can see is
    // worth more than a map you have to scroll to: down there it opened at
    // y=939 in a 630px scroller, so nobody met it without going looking. The
    // objection was real, though, and the answer is that the band's other two
    // cells gave up the width for it. A route map is legible small in a way a
    // 17-minute plot is not, because it is a handful of ordinals on terrain.
    const route = routeSlot(o, 176, 'ms-ov-band-route');
    if (route) band.appendChild(route);

    out.appendChild(band);

    out.appendChild(playerColumns(model, (p, i) => {
      // Two panes side by side, not one stack.
      //
      // Left is who this is and what they fielded — the identity, the heroes
      // and the unit roster, which is the tallest single thing on the tab.
      // Right is everything measured about them: the matchup matrix, the APM
      // line and the closing facts, stacked down beside the roster instead of
      // under it.
      //
      // The roster is a column of five or six units and the readouts are all
      // short and wide, so the two shapes interlock. Stacked, the tab was
      // roughly twice as tall and half of every row was empty.
      const split = node('div', 'ms-ov-split');

      const left = node('div', 'ms-ov-left');
      const head = node('div', 'ms-ov-head');
      head.appendChild(playerIdentity(o, p));

      const heroes = (p.tierProduction && p.tierProduction.heroes) || [];
      if (heroes.length) {
        const row = node('div', 'ms-heroes-row');
        for (const hero of heroes) {
          const cell = node('div', 'ms-hero-inline');
          const portrait = node('div', 'ms-hero-portrait-wrap');
          const img = o.icon(hero.itemId);
          img.classList.add('ms-hero-portrait');
          img.title = hero.displayName || '';
          portrait.appendChild(img);
          portrait.appendChild(node('span', 'ms-hero-level', Number(hero.level) || 0));
          cell.appendChild(portrait);
          cell.appendChild(heroSpells(o, hero));
          row.appendChild(cell);
        }
        head.appendChild(row);
      }
      left.appendChild(head);

      const combat = combatBlock(o, model, p, i) || [];
      if (combat[0]) left.appendChild(combat[0]);        // the roster

      const right = node('div', 'ms-ov-right');
      if (combat[1]) right.appendChild(combat[1]);       // the damage matchup

      const chart = apmChart(p, model.players.length === 2
        ? model.players[i === 0 ? 1 : 0] : null);
      if (chart) right.appendChild(block('APM', chart));
      right.appendChild(block('Match Stats', statsTable(o, p)));

      split.appendChild(left);
      split.appendChild(right);
      return split;
    }, 'ms-col-overview'));

    return out;
  };

  // ── Army ───────────────────────────────────────────────────────────────────
  //
  // Was two tabs, Army and Upgrades. They answer one question — what force did
  // this player put on the map — and split across two screens neither could be
  // read against the other: three attack upgrades is a different sentence
  // beside twelve grunts than beside four.
  //
  // Neither was close to filling a screen on its own. Every section here is an
  // icon grid or a short list, so they pack two-across into the column's width
  // (.ms-blocks) rather than stacking down a page of half-empty rows.

  const upgradeList = (o, entries, rowClass, withLevel) => {
    const list = node('div', 'ms-upgrade-list');
    for (const u of entries) {
      const row = node('div', 'ms-upgrade-row ' + rowClass);
      const img = o.icon(u.icon || u.itemId);
      img.classList.add('ms-upgrade-icon');
      row.appendChild(img);
      const lvl = Number(u.level) || 0;
      row.appendChild(node('span', 'ms-upgrade-name',
        u.displayName + (!withLevel && lvl > 1 ? ` Lv ${lvl}` : '')));
      if (withLevel) row.appendChild(node('span', 'ms-upgrade-level', 'Lv ' + lvl));
      list.appendChild(row);
    }
    return list;
  };

  const renderArmy = (o, model) => playerColumns(model, (p) => {
    const out = [];
    const tp = (p.tierProduction && p.tierProduction.tierProd) || {};

    for (const tier of [1, 2, 3]) {
      const t = tp[tier];
      if (!t) continue;
      const hasBuildings = t.buildings && t.buildings.length;
      const hasUnits = t.units && t.units.length;
      if (!hasBuildings && !hasUnits) continue;

      const body = frag();
      if (hasBuildings) {
        body.appendChild(node('div', 'ms-subsection', 'Buildings'));
        body.appendChild(iconGrid(o, t.buildings.map(b =>
          ({ itemId: b.itemId, title: b.displayName, count: b.count }))));
      }
      if (hasUnits) {
        body.appendChild(node('div', 'ms-subsection', 'Units'));
        body.appendChild(iconGrid(o, t.units.map(u =>
          ({ itemId: u.itemId, title: u.displayName, count: u.count }))));
      }
      out.push(blockOf(node('div', 'ms-tier-label t' + tier, 'Tier ' + tier), body));
    }

    const army = (p.finalSnapshot && p.finalSnapshot.army) || [];
    if (army.length) {
      out.push(block('All Made Units', iconGrid(o, army.map(u =>
        ({ itemId: u.itemId, title: u.displayName, count: u.count }))), 'ms-block-wide'));
    }

    const upgrades = (p.finalSnapshot && p.finalSnapshot.upgrades) || null;
    const attack = upgrades ? Object.values(upgrades.attack || {}) : [];
    const defense = upgrades ? Object.values(upgrades.defense || {}) : [];
    const researched = upgrades ? (upgrades.researched || []) : [];

    if (attack.length) {
      out.push(block('Attack Upgrades', upgradeList(o, attack, 'ms-atk', true),
        null, 'ms-atk-label'));
    }
    if (defense.length) {
      out.push(block('Defense Upgrades', upgradeList(o, defense, 'ms-def', true),
        null, 'ms-def-label'));
    }
    if (researched.length) {
      out.push(block('Research', upgradeList(o, researched, 'ms-res', false),
        null, 'ms-res-label'));
    }
    if (upgrades && !attack.length && !defense.length && !researched.length) {
      out.push(block('Upgrades', empty('No upgrades researched')));
    }

    const timeline = p.researchTimeline || [];
    if (timeline.length) {
      // A real element, not a fragment: .ms-block-cols runs this list in two
      // columns, and a fragment's children are adopted straight into the block
      // where there is nothing for `columns` to apply to.
      const list = node('div', 'ms-timeline-list');
      for (const e of timeline) {
        const row = node('div', 'ms-timeline-mini');
        row.appendChild(node('span', 'ms-timeline-time', e.timeFormatted || ''));
        const img = o.icon(e.icon || e.itemId);
        img.classList.add('ms-timeline-icon');
        row.appendChild(img);
        const lvl = Number(e.level) || 0;
        row.appendChild(node('span', null, e.name + (lvl > 1 ? ` Lv ${lvl}` : '')));
        list.appendChild(row);
      }
      out.push(block('Research Timeline', list, 'ms-block-wide ms-block-cols'));
    }

    return out.length ? blocks(out) : empty('No production recorded');
  });

  // ── Economy ────────────────────────────────────────────────────────────────
  //
  // Was three tabs: Economy, Creeps and Charts. One question again — where the
  // resources came from and where they went. Creeping IS income in this game,
  // gold and hero experience both, and reading a 900g item spend without the
  // camps that paid for it was the split that made the Economy tab look thin.
  //
  // Per-player sections pack into the two columns. What is about the game
  // rather than about a player — the creep score, the four time series — runs
  // full width underneath, in that order.

  const economyBlocks = (o, model, p) => {
    const out = [];

    const eco = (p.finalSnapshot && p.finalSnapshot.economy) || null;
    if (eco) {
      const body = frag();
      const statRow = (label, value, cls) => {
        const row = node('div', 'ms-stat-row');
        row.appendChild(node('span', null, label));
        row.appendChild(node('span', 'ms-stat-value ' + cls, Number(value) || 0));
        body.appendChild(row);
      };
      statRow('Gold Spent', eco.goldSpent, 'ms-gold');
      statRow('Lumber Spent', eco.lumberSpent, 'ms-lumber');
      out.push(block('Resources', body));
    }

    const purchases = p.itemPurchases || [];
    if (purchases.length) {
      const total = purchases.reduce((s, e) => s + (Number(e.gold) || 0), 0);
      out.push(block(`Item Purchases (${total}g)`, iconGrid(o, purchases.map(e => ({
        itemId: e.itemId,
        count: e.count,
        title: `${e.name} x${Number(e.count) || 0}${e.gold ? ` (${e.gold}g)` : ''}`
      })))));
    }

    const uses = p.itemUses || [];
    if (uses.length) {
      out.push(block('Item Uses', iconGrid(o, uses.map(e =>
        ({ itemId: e.itemId, count: e.count, title: `${e.name} x${Number(e.count) || 0}` })))));
    }

    const mercs = p.mercenaries || [];
    if (mercs.length) {
      const total = mercs.reduce((s, m) => s + (Number(m.gold) || 0), 0);
      out.push(block(`Mercenaries (${total}g)`, iconGrid(o, mercs.map(m => ({
        itemId: m.itemId,
        count: m.count,
        title: `${m.name} x${Number(m.count) || 0} (${Number(m.gold) || 0}g)`
      })))));
    }

    const bags = p.heroInventories || [];
    const carried = bags.filter(h => (h.items || []).length);
    if (carried.length) {
      const body = frag();
      for (const hero of carried) {
        body.appendChild(node('div', 'ms-hero-inv-label', hero.name || ''));
        body.appendChild(iconGrid(o, hero.items.map(it =>
          ({ itemId: it.itemId, title: it.name || it.itemId }))));
      }
      out.push(block('Hero Inventories', body));
    }

    // Camps are claimed by TEAMS. In a duel each column is its own team, so
    // the blocks live here; past two players the same team-scoped route
    // repeated identically in three teammate columns, so team games render
    // them once per team, full width, below the columns.
    if (model.players.length <= 2) {
      const xp = creepXpBlock(o, model, p);
      if (xp) out.push(xp);
      const route = creepRouteBlock(o, model, p);
      if (route) out.push(route);
    }

    return out;
  };

  // One section per team: the route and the hero XP, drawn once instead of
  // once per teammate. The hero-XP portraits search every teammate's heroes,
  // which is also what fixes the blank portraits the per-column form had.
  const teamCreepSections = (o, model) => {
    const teams = [];
    for (const p of model.players) {
      if (p.teamId === null || p.teamId === undefined) continue;
      if (!teams.some(t => t.teamId === p.teamId)) {
        teams.push({ teamId: p.teamId, players: [] });
      }
      teams.find(t => t.teamId === p.teamId).players.push(p);
    }
    if (!teams.length) return null;

    const out = frag();
    for (const team of teams) {
      // A representative player carries the teamId for campsOf, and a merged
      // hero list so every portrait resolves.
      const rep = {
        teamId: team.teamId,
        color: team.players[0].color,
        tierProduction: {
          heroes: team.players.flatMap(p =>
            (p.tierProduction && p.tierProduction.heroes) || [])
        }
      };
      const xp = creepXpBlock(o, model, rep);
      const route = creepRouteBlock(o, model, rep);
      if (!xp && !route) continue;

      const names = team.players.map(p => p.name).join(', ');
      const section = node('div', 'ms-wide-section ms-team-creeps');
      section.appendChild(sectionLabel(`Creeps — ${names}`));
      section.appendChild(blocks([xp, route]));
      out.appendChild(section);
    }
    return out;
  };

  const renderEconomy = (o, model) => {
    const out = frag();

    out.appendChild(playerColumns(model, (p) => {
      const list = economyBlocks(o, model, p);
      return list.length ? blocks(list) : empty('No economy recorded');
    }));

    // The same map at the size this tab can afford. The per-camp text list in
    // the columns above says WHAT was killed and in what order; this says where,
    // which is the half a list cannot carry.
    const route = routeSlot(o, 520);
    if (route) out.appendChild(route);

    if (model.players.length > 2) {
      const teamCreeps = teamCreepSections(o, model);
      if (teamCreeps) out.appendChild(teamCreeps);
    }

    const score = creepScore(model);
    if (score) out.appendChild(score);

    out.appendChild(chartsSection(model));
    return out;
  };

  // ── Creeps ─────────────────────────────────────────────────────────────────

  // Matches GameDisplayBox.getDifficultyClass.
  const campDifficulty = (totalLevel) => {
    if (totalLevel <= 9) return { cls: 'green', label: 'Green Camp', color: '#00c850' };
    if (totalLevel <= 19) return { cls: 'orange', label: 'Orange Camp', color: '#ff8c00' };
    return { cls: 'red', label: 'Red Camp', color: '#e02020' };
  };

  const campXp = (camp) =>
    (camp.heroXp || []).reduce((s, h) => s + (Number(h.xp) || 0), 0);

  // Camps a player's team finished (`[2]`) or touched (`[1, 2]`).
  const campsOf = (model, p, states) => (model.camps || []).filter(c =>
    states.indexOf(c.claimState) !== -1 &&
    c.ownerTeamId !== null && c.ownerTeamId === p.teamId);

  const creepXpBlock = (o, model, p) => {
    if (!(model.camps || []).length) return null;

    const totals = {};
    for (const camp of campsOf(model, p, [2])) {
      for (const h of (camp.heroXp || [])) {
        if (!totals[h.uuid]) totals[h.uuid] = { name: h.name, itemId: h.itemId, xp: 0 };
        totals[h.uuid].xp += Number(h.xp) || 0;
      }
    }
    const heroes = Object.values(totals).sort((a, b) => b.xp - a.xp);
    if (!heroes.length) return null;

    const body = frag();
    const max = heroes[0].xp || 1;
    for (const h of heroes) {
      const row = node('div', 'ms-hero-xp-row');
      // The hero's own portrait, matched by name against what it built.
      const known = ((p.tierProduction && p.tierProduction.heroes) || [])
        .find(x => x.displayName === h.name);
      if (known) {
        const img = o.icon(known.itemId);
        img.classList.add('ms-hero-xp-icon');
        row.appendChild(img);
      }
      row.appendChild(node('span', 'ms-hero-xp-name', h.name || ''));
      const track = node('div', 'ms-hero-xp-bar-track');
      const bar = node('div', 'ms-hero-xp-bar');
      bar.style.width = (h.xp / max * 100).toFixed(0) + '%';
      bar.style.background = safeColor(p.color);
      track.appendChild(bar);
      row.appendChild(track);
      row.appendChild(node('span', 'ms-hero-xp-val', h.xp));
      body.appendChild(row);
    }
    return block('Hero XP from Creeps', body);
  };

  // The route, grouped by difficulty. Wide: a camp step is a row of creep
  // portraits and a time, and half a column wraps it into three lines.
  const creepRouteBlock = (o, model, p) => {
    const mine = campsOf(model, p, [1, 2]).slice()
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    if (!mine.length) return null;

    const byDiff = { green: [], orange: [], red: [] };
    mine.forEach((camp, i) => {
      byDiff[campDifficulty(camp.totalLevel || 0).cls].push({ camp, order: i + 1 });
    });

    const body = frag();
    for (const key of ['green', 'orange', 'red']) {
      const group = byDiff[key];
      if (!group.length) continue;
      const diff = campDifficulty(key === 'green' ? 0 : key === 'orange' ? 10 : 20);

      const label = node('div', 'ms-creep-diff-label', `${diff.label}s (${group.length})`);
      label.style.color = safeColor(diff.color);
      body.appendChild(label);

      const route = node('div', 'ms-creep-route');
      for (const { camp, order } of group) {
        const step = node('div', 'ms-creep-step');
        const num = node('span', 'ms-creep-order', order);
        num.style.borderColor = safeColor(diff.color);
        num.style.color = safeColor(diff.color);
        step.appendChild(num);

        const cell = node('div', 'ms-creep-camp');
        const icons = node('div', 'ms-creep-icons');
        for (const u of (camp.units || [])) {
          const wrap = node('div', 'ms-creep-icon-wrap');
          wrap.title = `${u.name} Lv ${u.level || 0}`;
          const img = o.icon(u.itemId);
          img.classList.add('ms-creep-icon');
          wrap.appendChild(img);
          if (u.level) wrap.appendChild(node('span', 'ms-creep-lvl', u.level));
          icons.appendChild(wrap);
        }
        cell.appendChild(icons);

        const info = node('div', 'ms-creep-camp-info');
        info.appendChild(node('span', 'ms-creep-meta', camp.timeFormatted || ''));
        const xp = campXp(camp);
        if (xp) info.appendChild(node('span', 'ms-creep-xp', '+' + xp + ' XP'));
        cell.appendChild(info);

        step.appendChild(cell);
        route.appendChild(step);
      }
      body.appendChild(route);
    }
    return block('Creep Route', body, 'ms-block-wide');
  };

  // The share of the map's camps each SIDE took, plus what nobody finished.
  // About the game rather than about a player, so it runs full width under
  // the columns. Sides are teams: camps are claimed by teams, and building
  // one side per player out of team-scoped camps counted every camp once per
  // teammate — a 3v3 read as six sides sharing double the real total.
  const creepScore = (model) => {
    const camps = model.camps || [];
    if (!camps.length) return null;

    const sides = [];
    for (const p of model.players) {
      if (p.teamId === null || p.teamId === undefined) continue;
      let side = sides.find(s => s.teamId === p.teamId);
      if (!side) {
        sides.push(side = { teamId: p.teamId, names: [], color: p.color, isYou: false });
      }
      side.names.push(p.name);
      side.isYou = side.isYou || !!p.isYou;
    }
    const scores = sides.map(side => {
      const cleared = campsOf(model, side, [2]);
      return {
        name: side.names.join(', '), color: side.color, isYou: side.isYou,
        count: cleared.length,
        totalLvl: cleared.reduce((s, c) => s + (c.totalLevel || 0), 0),
        totalXp: cleared.reduce((s, c) => s + campXp(c), 0)
      };
    });
    if (!scores.some(s => s.count)) return null;
    const totalCount = scores.reduce((s, x) => s + x.count, 0) || 1;

    const body = frag();
    const scoreRow = node('div', 'ms-creep-score');
    for (const s of scores) {
      const side = node('div', 'ms-creep-score-side' + (s.isYou ? ' ms-is-you' : ''));
      const name = node('span', 'ms-creep-score-name', s.name || '');
      name.style.color = safeColor(s.color);
      side.appendChild(name);
      side.appendChild(node('span', 'ms-creep-score-stat',
        `${s.count} camps · Lv ${s.totalLvl}${s.totalXp ? ` · ${s.totalXp} XP` : ''}`));
      scoreRow.appendChild(side);
    }
    body.appendChild(scoreRow);

    const bar = node('div', 'ms-creep-bar');
    for (const s of scores) {
      const seg = node('div', 'ms-creep-bar-seg');
      seg.style.width = Math.max(2, s.count / totalCount * 100).toFixed(1) + '%';
      seg.style.background = safeColor(s.color);
      bar.appendChild(seg);
    }
    body.appendChild(bar);

    // Everything nobody finished. One line, because it is context and not a
    // per-camp story.
    const contested = camps.filter(c => c.claimState === 1).length;
    const untouched = camps.filter(c => c.claimState === 0).length;
    if (contested || untouched) {
      const footer = node('div', 'ms-creep-footer');
      if (contested) footer.appendChild(node('span', 'ms-creep-footer-item', contested + ' contested'));
      if (untouched) footer.appendChild(node('span', 'ms-creep-footer-item', untouched + ' untouched'));
      body.appendChild(footer);
    }

    return block('Creep Score', body, 'ms-wide-section');
  };

  // ── Charts ─────────────────────────────────────────────────────────────────

  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs) => {
    const el = document.createElementNS(NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  };

  // One line per player over the game clock, area-filled. `track` is a series
  // of {t, v} the adapter supplies, because the viewer walks an event stream
  // and the desktop reads a sampled economy track, and neither should be the
  // shape this file assumes.
  const areaChart = (model, seriesFor, fixedMax) => {
    const width = 500, height = 120, padL = 35, padR = 5, padT = 5, padB = 20;
    const chartW = width - padL - padR;
    const chartH = height - padT - padB;
    const matchEnd = model.matchEndMs || 0;
    if (!matchEnd) return empty('No data');

    let max = fixedMax || 0;
    const lines = model.players.map(p => {
      const points = (seriesFor(p) || []).slice();
      if (!fixedMax) for (const pt of points) if (pt.v > max) max = pt.v;
      if (points.length && points[points.length - 1].t < matchEnd) {
        points.push({ t: matchEnd, v: points[points.length - 1].v });
      }
      return { points, color: p.color };
    });
    if (!max) max = 10;

    const svg = svgEl('svg', { class: 'ms-chart', viewBox: `0 0 ${width} ${height}` });

    for (let i = 0; i <= 4; i++) {
      const y = padT + (chartH * i / 4);
      svg.appendChild(svgEl('line', {
        x1: padL, y1: y, x2: width - padR, y2: y, stroke: 'rgba(255,255,255,0.06)'
      }));
      const txt = svgEl('text', { x: padL - 4, y: y + 3, class: 'ms-chart-label', 'text-anchor': 'end' });
      txt.textContent = Math.round(max * (1 - i / 4));
      svg.appendChild(txt);
    }

    const steps = Math.min(5, Math.ceil(matchEnd / 60000)) || 1;
    for (let i = 0; i <= steps; i++) {
      const t = (matchEnd / steps) * i;
      const txt = svgEl('text', {
        x: padL + (t / matchEnd) * chartW, y: height - 2,
        class: 'ms-chart-label', 'text-anchor': 'middle'
      });
      txt.textContent = fmt(t);
      svg.appendChild(txt);
    }

    for (const line of lines) {
      if (!line.points.length) continue;
      const d = line.points.map((pt, i) => {
        const x = padL + (pt.t / matchEnd) * chartW;
        const y = padT + chartH - (pt.v / max) * chartH;
        return (i === 0 ? 'M' : 'L') + `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
      const firstX = padL + (line.points[0].t / matchEnd) * chartW;
      const lastX = padL + (line.points[line.points.length - 1].t / matchEnd) * chartW;
      const baseY = padT + chartH;
      svg.appendChild(svgEl('path', {
        d: `${d} L${lastX.toFixed(1)},${baseY} L${firstX.toFixed(1)},${baseY} Z`,
        fill: safeColor(line.color), opacity: 0.12
      }));
      svg.appendChild(svgEl('path', {
        d, fill: 'none', stroke: safeColor(line.color), 'stroke-width': 2
      }));
    }
    return svg;
  };

  const apmComparison = (model) => {
    const width = 500, height = 120, padL = 35, padR = 5, padT = 5, padB = 20;
    const chartW = width - padL - padR;
    const chartH = height - padT - padB;

    let max = 0;
    let minutes = 0;
    for (const p of model.players) {
      if (!p.apm) continue;
      if (p.apm.peak > max) max = p.apm.peak;
      minutes = Math.max(minutes, (p.apm.perMinute || []).length);
    }
    if (!minutes) return empty('No APM data');
    if (!max) max = 100;

    const svg = svgEl('svg', { class: 'ms-chart', viewBox: `0 0 ${width} ${height}` });
    for (let i = 0; i <= 4; i++) {
      const y = padT + (chartH * i / 4);
      svg.appendChild(svgEl('line', {
        x1: padL, y1: y, x2: width - padR, y2: y, stroke: 'rgba(255,255,255,0.06)'
      }));
      const txt = svgEl('text', { x: padL - 4, y: y + 3, class: 'ms-chart-label', 'text-anchor': 'end' });
      txt.textContent = Math.round(max * (1 - i / 4));
      svg.appendChild(txt);
    }

    const groupW = chartW / minutes;
    const barW = Math.max(2, (groupW / model.players.length) - 1);
    model.players.forEach((p, si) => {
      if (!p.apm) return;
      (p.apm.perMinute || []).forEach((v, mi) => {
        const h = (v / max) * chartH;
        svg.appendChild(svgEl('rect', {
          x: (padL + mi * groupW + si * (barW + 1)).toFixed(1),
          y: (padT + chartH - h).toFixed(1),
          width: barW.toFixed(1), height: h.toFixed(1),
          fill: safeColor(p.color), opacity: 0.7
        }));
      });
    });

    const interval = Math.max(1, Math.floor(minutes / 5));
    for (let i = 0; i < minutes; i += interval) {
      const txt = svgEl('text', {
        x: padL + (i + 0.5) * groupW, y: height - 2,
        class: 'ms-chart-label', 'text-anchor': 'middle'
      });
      txt.textContent = (i + 1) + 'm';
      svg.appendChild(txt);
    }
    return svg;
  };

  const categoryComparison = (model) => {
    const wrap = node('div', 'ms-cat-compare');
    for (const cat of ['move', 'select', 'ability', 'build', 'item', 'cancel']) {
      const values = model.players.map(p => (p.apm && p.apm.categories && p.apm.categories[cat]) || 0);
      const max = Math.max(...values, 1);

      const row = node('div', 'ms-cat-row');
      row.appendChild(node('span', 'ms-cat-label', cat));
      const bars = node('div', 'ms-cat-bars');
      model.players.forEach((p, i) => {
        const barRow = node('div', 'ms-cat-bar-row');
        const bar = node('div', 'ms-cat-bar');
        bar.style.width = (values[i] / max * 100).toFixed(1) + '%';
        bar.style.background = safeColor(p.color);
        barRow.appendChild(bar);
        barRow.appendChild(node('span', 'ms-cat-val', values[i]));
        bars.appendChild(barRow);
      });
      row.appendChild(bars);
      wrap.appendChild(row);
    }
    return wrap;
  };

  // The time series, two across. Each of these is one shape on one axis, and a
  // full-width plot of it was 500 viewBox units of chart in 1,100px of column
  // with nothing beside it — the sparsest thing in the whole summary.
  const chartsSection = (model) => {
    const list = [
      block('Supply Over Time', areaChart(model, p => p.supplyTrack, 100)),
      block('Workers Over Time', areaChart(model, p => p.workerTrack, null))
    ];
    if (model.players.some(p => p.apm)) {
      // The grouped bars only up to four seats. At six the group width
      // divides down to 2px bars, which is a texture, not a chart — and each
      // player's column already carries their own APM line.
      if (model.players.length <= 4) {
        list.push(block('APM Over Time', apmComparison(model)));
      }
      list.push(block('Action Category Breakdown', categoryComparison(model)));
    }
    const wrap = blocks(list);
    wrap.classList.add('ms-chart-blocks');
    return wrap;
  };

  // ── Public ─────────────────────────────────────────────────────────────────

  const RENDERERS = {
    overview: renderOverview,
    army: renderArmy,
    economy: renderEconomy
  };

  window.MatchSummaryView = {
    // The tab order, owned here so the two apps cannot disagree about it or
    // about what a tab is called.
    //
    // Was six. Army/Upgrades and Economy/Creeps/Charts were five screens each
    // holding one short section list, so every one of them opened on a page
    // that was mostly background — and the sections that belong side by side
    // (what you built against what you upgraded, what you spent against the
    // camps that paid for it) were never on screen together. Three tabs, each
    // one question, each one full.
    TABS: [
      { key: 'overview', label: 'Overview' },
      { key: 'army', label: 'Army' },
      { key: 'economy', label: 'Economy' }
    ],

    // Returns a node for `tab`, or null for an unknown key.
    // opts: { icon(itemId), asset(file), wantsDominance }
    render (tab, model, opts) {
      const fn = RENDERERS[tab];
      if (!fn || !model || !model.players || !model.players.length) return null;
      return fn(opts || {}, model);
    },

    // Exposed because the client's modal reuses it for the tier strip and
    // because a consumer testing this file should not have to reimplement it.
    fmt
  };
})();
