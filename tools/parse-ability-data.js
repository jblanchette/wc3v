/*
  Parses AbilityData.slk + (optional) AbilityMetaData.slk + per-race
  AbilityFunc.txt files to generate helpers/heroAbilityStats.json with
  strict, per-level data extracted from the actual WC3 CASC game files.

  Sources (all under tools/ability-data/, case-insensitive filenames):
    abilitydata.slk         — required; raw per-level numbers (Cost, Cool,
                              Dur, Area, DataA-I) for every ability in the
                              game.
    abilitymetadata.slk     — optional; defines what DataA/B/C/D mean for
                              each ability ID (so the raw fields can be
                              labelled). Without it, raw fields are passed
                              through unlabelled.
    {race}abilityfunc.txt   — optional; the in-game Ubertip strings per
                              level. These contain the actual numbers a
                              player sees in the spellbook tooltip, wrapped
                              in gold-color codes |cffffcc00<num>|r. With
                              this, we can extract the *displayed* values
                              directly (strict — matches in-game exactly).
                              Files: humanabilityfunc.txt, orcabilityfunc.txt,
                              nightelfabilityfunc.txt, undeadabilityfunc.txt,
                              neutralabilityfunc.txt, commonabilityfunc.txt.

  Output:
    helpers/heroAbilityStats.json    — keyed by spellItemId, per-spell data:
      { name, maxLevel, manaCost[lvl], cooldown[lvl], duration[lvl],
        area[lvl], castRange[lvl], data: { DataA[lvl], DataB[lvl], ... },
        dataMeta: { DataA: { useSpecific, name }, ... },   // if metadata present
        ubertips: [str, str, ...],                          // if func files present
        ubertipNumbers: [[n,n,...], [n,n,...], ...],        // gold-text numbers per level
        tip: str,                                           // 1st level tooltip headline
        sources: [files used] }

  Usage: node tools/parse-ability-data.js
*/

'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR     = path.join(__dirname, 'ability-data');
const OUTPUT_JSON  = path.join(__dirname, '..', 'helpers',   'heroAbilityStats.json');
const OUTPUT_JS    = path.join(__dirname, '..', 'client', 'js', 'HeroAbilityStats.js');

// We only emit entries for spells listed in heroAbilities. The parser already
// canonicalizes variant IDs (Tinker rocket levels, Lich Frost Armor autocast)
// to their base ID, so per-level data only needs to exist on the base IDs.
const { heroAbilities, spellVariantToBase } = require('../helpers/mappings.js');

// ── Hand-maintained English labels for AbilityMetaData's internal IDs ─────
// The WC3 locale namespace (where WESTRING_AEVAL_* strings live) hasn't been
// reliably extractable in this project's CASC tooling, so we maintain a
// small label map keyed by the metadata's stable internal IDs (Udc1, Htb1,
// etc.). The NUMBERS remain strict-from-CASC; only the column LABEL and a
// small format hint are hand-typed.
//
// Coverage: every Data field, on the basic skills of the 8 most-picked
// first heroes (DK, Lich, DH, KotG, AM, MK, BM, FS), where the field is
// real per AbilityMetaData. Verified against the SLK values + standard WC3
// ability documentation. Stable across patches — internal IDs don't change.
//
// Format codes:
//   'flat'    — plain number rendering ("100", "1.5")
//   'pct'     — value is a ratio 0..1, render as percent ("10%")
//   'sec'     — render with trailing "s"
//   'mult'    — multiplier like "2x"
//   'pps'     — "per second", render as "1.5/s"
const INTERNAL_ID_LABELS = {
  // Death Knight
  Udc1: { label: 'Heal value (dmg = ½)', format: 'flat' },   // 200/400/600 — heal; damage is half
  Udp1: { label: 'Mana returned',        format: 'pct'  },   // Dark Ritual: 0.33/0.55/0.80 of HP→mana
  Udp2: { label: 'HP gained mult',       format: 'mult' },   // Death Pact: 1×/2×/3× target HP gained
  Uau1: { label: 'Move speed bonus',     format: 'pct'  },   // 10/15/20%
  Uau2: { label: 'HP regen /s',          format: 'pps'  },   // 0.5/1.0/1.5 HP per second

  // Lich
  Ufn1: { label: 'Splash damage',        format: 'flat' },   // 50/100/150
  Ufn2: { label: 'Splash radius',        format: 'flat' },   // 100 flat
  Ufa2: { label: 'Armor bonus',          format: 'flat' },   // +3/+5/+7

  // Demon Hunter
  Emb1: { label: 'Mana burned',          format: 'flat' },   // 50/100/150
  Emb2: { label: 'Damage per mana',      format: 'pct'  },   // 0.25 (25% — damage = mana burned × this)
  Eim1: { label: 'Damage /s',            format: 'pps'  },   // 6/11/17 dps
  Eev1: { label: 'Dodge chance',         format: 'pct'  },   // 0.10/0.20/0.30

  // Keeper of the Grove
  Eer1: { label: 'Damage /s',            format: 'pps'  },   // 15/20/30 dps
  Efn1: { label: 'Treants summoned',     format: 'flat' },   // 2/3/4
  Eah1: { label: 'Return damage',        format: 'pct'  },   // 15/30/45%

  // Archmage
  Hbz1: { label: 'Wave count',           format: 'flat' },   // 6/8/10
  Hbz2: { label: 'Damage / wave',        format: 'flat' },   // 30/40/50
  Hbz3: { label: 'Wave duration',        format: 'sec'  },   // 6/7/10 s
  Hbz6: { label: 'Effect radius',        format: 'flat' },   // 150/200/250
  Hab1: { label: 'Mana regen /s',        format: 'pps'  },   // 0.75/1.25/2.00 mana/s

  // Mountain King
  Htb1: { label: 'Damage',               format: 'flat' },   // 100/200/310
  Htc1: { label: 'Damage',               format: 'flat' },   // 60/110/150
  Hbh1: { label: 'Bonus damage',         format: 'flat' },   // 20/30/40
  Hbh3: { label: 'Proc chance',          format: 'flat' },   // 25/40/55 (already in %)

  // Blademaster
  Owk2: { label: 'Speed bonus',          format: 'pct'  },   // +10/+40/+70%
  Owk3: { label: 'Backstab damage',      format: 'flat' },   // 40/70/100
  Ocr2: { label: 'Damage multiplier',    format: 'mult' },   // 2×/3×/4×

  // Mirror Image
  Omi1: { label: 'Images summoned',      format: 'flat' },   // 1/2/3

  // Far Seer
  Ocl1: { label: 'Damage',               format: 'flat' },   // 85/125/180
  Ocl2: { label: 'Targets hit',          format: 'flat' },   // 4/6/8
  Osf2: { label: 'Wolves summoned',      format: 'flat' }    // 2 flat
};

// ── Generic SLK parser (same shape as parse-upgrade-data.js's) ─────────────
function parseSLK (text) {
  const rows = {};
  const headers = {};
  let curCol = 1, curRow = 1;

  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('C;')) continue;
    let x = curCol, y = curRow, value = null;
    for (const p of line.split(';').slice(1)) {
      if (p[0] === 'X') x = parseInt(p.slice(1), 10);
      else if (p[0] === 'Y') y = parseInt(p.slice(1), 10);
      else if (p[0] === 'K') {
        value = p.slice(1);
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        else {
          const num = Number(value);
          if (!isNaN(num)) value = num;
        }
      }
    }
    curCol = x; curRow = y;
    if (y === 1) headers[x] = value;
    else (rows[y] = rows[y] || {})[headers[x]] = value;
  }
  return Object.values(rows);
}

// ── INI-style AbilityFunc.txt parser ───────────────────────────────────────
// Sections look like [AUdc], keys like Ubertip[0]="..." or Tip="...". Values
// may be quoted; some entries span multiple lines with a trailing ", \" — we
// handle the common case (single-line entries) plus simple continuation.
function parseAbilityFunc (text) {
  const out = {};
  let cur = null;
  let pendingKey = null, pendingVal = '';
  const flushPending = () => {
    if (cur && pendingKey != null) {
      out[cur][pendingKey] = stripQuotes(pendingVal);
    }
    pendingKey = null; pendingVal = '';
  };

  for (let raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\r$/, '');
    const t = line.trim();
    if (!t || t.startsWith('//')) continue;
    const sec = t.match(/^\[([A-Za-z0-9_]+)\]$/);
    if (sec) {
      flushPending();
      cur = sec[1];
      out[cur] = out[cur] || {};
      continue;
    }
    if (!cur) continue;
    // Continuation of a multi-line value (rare): line starts with a quote
    // and we have a pending key buffered.
    if (pendingKey != null && !/^[A-Za-z][A-Za-z0-9_]*\s*=/.test(t)) {
      pendingVal += '\n' + t.replace(/^"/, '').replace(/",?\s*\\?$/, '');
      if (!t.endsWith('\\')) flushPending();
      continue;
    }
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    flushPending();
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    // Multi-line if it ends with a backslash-continued quoted form.
    if (/^".*"\s*\\$/.test(val)) {
      pendingKey = key; pendingVal = val.replace(/^"/, '').replace(/"\s*\\$/, '');
      continue;
    }
    out[cur][key] = stripQuotes(val);
  }
  flushPending();
  return out;
}
function stripQuotes (v) {
  if (typeof v !== 'string') return v;
  v = v.trim();
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  return v;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function toNum (v) {
  if (v === undefined || v === null || v === '-' || v === '_' || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function safeStr (v) {
  if (v === undefined || v === null || v === '-' || v === '_') return null;
  return String(v);
}

// Gold-coloured numbers in an Ubertip (|cffffcc00<num>|r) — these are the
// exact figures the spellbook tooltip displays in-game. Order preserved.
function extractUbertipNumbers (ubertip) {
  if (!ubertip) return [];
  const out = [];
  const re = /\|c[fF]{2}[fF]{2}[cC]{2}00([0-9]+(?:\.[0-9]+)?)\|r/g;
  let m;
  while ((m = re.exec(ubertip)) !== null) out.push(Number(m[1]));
  return out;
}
// Strip color/format codes from an Ubertip for a clean readable version.
function plainText (ubertip) {
  if (!ubertip) return '';
  return ubertip
    .replace(/\|c[0-9a-fA-F]{8}/g, '')
    .replace(/\|r/g, '')
    .replace(/\|n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Per-level field extraction from an abilitydata.slk row ────────────────
// The SLK column names use 1/2/3/... level suffixes. We pull as many levels
// as the row's `levels` field says exist (TFT has 1-4 for most spells).
function buildLevels (row, maxLevel) {
  const out = {
    manaCost: [], cooldown: [], duration: [], durationHero: [],
    area: [], castRange: [], data: {}
  };
  const dataLetters = 'ABCDEFGHI'.split('');
  for (let lvl = 1; lvl <= maxLevel; lvl++) {
    out.manaCost.push(toNum(row['Cost' + lvl]));
    out.cooldown.push(toNum(row['Cool' + lvl]));
    out.duration.push(toNum(row['Dur' + lvl]));
    out.durationHero.push(toNum(row['HeroDur' + lvl]));
    out.area.push(toNum(row['Area' + lvl]));
    out.castRange.push(toNum(row['Rng' + lvl]));
    for (const L of dataLetters) {
      const v = toNum(row['Data' + L + lvl]);
      if (v != null) (out.data['Data' + L] = out.data['Data' + L] || new Array(maxLevel).fill(null))[lvl - 1] = v;
    }
  }
  return out;
}

// ── AbilityMetaData.slk → DataA/B/C/D semantics per spell ─────────────────
// AbilityMetaData rows have this shape (the columns we care about):
//   ID          — internal row id, e.g. "Htb1" (useful as a fallback label
//                 when the locale strings aren't extracted yet)
//   field       — column TYPE: "Data" for the per-level Data fields,
//                 plus other types like "Name", "Cost", etc.
//   slk         — which SLK file the field belongs to ("AbilityData" /
//                 "UnitData" / "UpgradeData" / "Profile"). We only want rows
//                 from AbilityData for spell-effect Data fields.
//   data        — for Data fields, the column INDEX (1=DataA, 2=DataB, ...).
//                 The SLK columns themselves are named DataA1, DataB1, ...
//                 per level, but the metadata refers to the unsuffixed
//                 letter via this integer.
//   displayName — locale WESTRING key, e.g. "WESTRING_AEVAL_HTB1". The
//                 readable English value lives in a different CASC namespace
//                 (war3local.w3mod). Until that's extracted we pass the
//                 token through verbatim.
//   useSpecific — comma-separated list of ability IDs that use this row's
//                 field, or "_" (or empty) for "all spells with this field".
function buildDataMeta (metaRows) {
  // Index by ability ID → { 'DataA': { internalId, westring, useSpecific }, ... }
  const idx = {};
  const numToLetter = (n) => 'ABCDEFGHI'[Number(n) - 1] || null;
  for (const r of metaRows) {
    if (!r) continue;
    const field   = safeStr(r.field);
    const slk     = safeStr(r.slk);
    const dataIdx = toNum(r.data);
    if (field !== 'Data' || slk !== 'AbilityData' || dataIdx == null) continue;
    const letter = numToLetter(dataIdx);
    if (!letter) continue;
    const dataKey = 'Data' + letter;
    const entry = {
      internalId: safeStr(r.ID),
      westring:   safeStr(r.displayName),
      useSpecific: null   // set below
    };
    const us = safeStr(r.useSpecific);
    const ids = (us && us !== '_')
      ? us.split(',').map(s => s.trim()).filter(Boolean)
      : null;
    entry.useSpecific = ids;
    if (ids && ids.length) {
      for (const id of ids) (idx[id] = idx[id] || {})[dataKey] = entry;
    } else {
      (idx.__default = idx.__default || {})[dataKey] = entry;
    }
  }
  return idx;
}
function metaFor (itemId, dataLetter, metaIdx) {
  const spell = metaIdx[itemId];
  if (spell && spell[dataLetter]) return spell[dataLetter];
  const def = metaIdx.__default || {};
  if (def[dataLetter]) return def[dataLetter];
  return null;
}

// ── Find a file in DATA_DIR by case-insensitive name ──────────────────────
function findFile (name) {
  if (!fs.existsSync(DATA_DIR)) return null;
  const wanted = name.toLowerCase();
  for (const f of fs.readdirSync(DATA_DIR)) {
    if (f.toLowerCase() === wanted) return path.join(DATA_DIR, f);
  }
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────
function main () {
  const sources = [];

  // 1. abilitydata.slk — required.
  const abilityPath = findFile('abilitydata.slk');
  if (!abilityPath) {
    console.error('FATAL: tools/ability-data/abilitydata.slk not found.');
    process.exit(1);
  }
  sources.push(path.basename(abilityPath));
  const abilityRows = parseSLK(fs.readFileSync(abilityPath, 'utf8'));
  const byAlias = {};
  for (const r of abilityRows) {
    const a = safeStr(r.alias);
    if (a && /^[A-Za-z][A-Za-z0-9]{3}$/.test(a)) byAlias[a] = r;
  }

  // 2. abilitymetadata.slk — optional.
  let metaIdx = {};
  const metaPath = findFile('abilitymetadata.slk');
  if (metaPath) {
    sources.push(path.basename(metaPath));
    const metaRows = parseSLK(fs.readFileSync(metaPath, 'utf8'));
    metaIdx = buildDataMeta(metaRows);
  }

  // 3a. Summoned-unit data (unitbalance.slk + unitweapons.slk + unitabilities.slk)
  //     — needed for spells that summon temporary units (wolves, treants,
  //     water elementals, beetles, ...). Each spell level picks a different
  //     unit from its summonItemId array; the unit's HP, damage, and ability
  //     list scale with the spell level via its underlying unit entry.
  const unitBalance = {};
  {
    const fp = findFile('unitbalance.slk');
    if (fp) {
      sources.push(path.basename(fp));
      for (const r of parseSLK(fs.readFileSync(fp, 'utf8'))) {
        const id = safeStr(r.unitBalanceID);
        if (id) unitBalance[id] = r;
      }
    }
  }
  const unitWeapons = {};
  {
    const fp = findFile('unitweapons.slk');
    if (fp) {
      sources.push(path.basename(fp));
      for (const r of parseSLK(fs.readFileSync(fp, 'utf8'))) {
        const id = safeStr(r.unitWeaponID);
        if (id) unitWeapons[id] = r;
      }
    }
  }
  const unitAbilities = {};
  {
    const fp = findFile('unitabilities.slk');
    if (fp) {
      sources.push(path.basename(fp));
      for (const r of parseSLK(fs.readFileSync(fp, 'utf8'))) {
        const id = safeStr(r.unitAbilID);
        if (id) unitAbilities[id] = r;
      }
    }
  }
  function unitSummary (unitId) {
    if (!unitId) return null;
    const b = unitBalance[unitId];
    const w = unitWeapons[unitId];
    const a = unitAbilities[unitId];
    if (!b && !w && !a) return null;
    const dmgMin = toNum(w && w.mindmg1);
    const dmgMax = toNum(w && w.maxdmg1);
    const out = {
      unitId,
      comment: safeStr(b && b['comment(s)']) || safeStr(a && a['comment(s)']) || null,
      hp:        toNum(b && b.HP),
      mana:      toNum(b && b.manaN),
      armor:     toNum(b && b.def),
      sight:     toNum(b && b.sight),
      speed:     toNum(b && b.spd),
      damageMin: dmgMin,
      damageMax: dmgMax,
      damageAvg: (dmgMin != null && dmgMax != null) ? (dmgMin + dmgMax) / 2 : null,
      attackCooldown: toNum(w && w.cool1),
      attackType:     safeStr(w && w.atkType1),
      abilities:      (a && safeStr(a.abilList) && a.abilList !== '_') ? a.abilList.split(',').map(s => s.trim()).filter(Boolean) : []
    };
    return out;
  }

  // 3b. {race}AbilityFunc.txt — optional, multiple files.
  const funcFileNames = [
    'humanabilityfunc.txt',
    'orcabilityfunc.txt',
    'nightelfabilityfunc.txt',
    'undeadabilityfunc.txt',
    'neutralabilityfunc.txt',
    'commonabilityfunc.txt'
  ];
  const funcs = {};
  for (const fname of funcFileNames) {
    const fp = findFile(fname);
    if (!fp) continue;
    sources.push(path.basename(fp));
    Object.assign(funcs, parseAbilityFunc(fs.readFileSync(fp, 'utf8')));
  }

  // 4. Emit one entry per heroAbilities key. The parser canonicalizes
  //    variant IDs already, so we don't need entries for AUfu (Lich Frost
  //    Armor autocast) etc. — those resolve to AUfa via spellVariantToBase.
  const out = {};
  const missing = [];
  const noTooltip = [];
  for (const itemId of Object.keys(heroAbilities)) {
    if (spellVariantToBase[itemId]) continue;   // variant — base entry covers it
    const r = byAlias[itemId];
    if (!r) { missing.push(itemId + ' (' + (heroAbilities[itemId].displayName || '?') + ')'); continue; }
    const maxLevel = Math.max(1, toNum(r.levels) || 1);
    const lvl = buildLevels(r, maxLevel);

    // Attach metadata labels to each populated Data* field. Drop fields the
    // metadata says aren't used by THIS spell — the SLK row often has stale
    // values left over from a template that we don't want to render. (e.g.
    // many spells have DataB,C... cells populated with "0" or junk values
    // even though the spell only consumes DataA.)
    const dataMeta = {};
    const usedData = {};
    for (const letter of Object.keys(lvl.data)) {
      const m = metaFor(itemId, letter, metaIdx);
      if (!m) continue;
      // metaFor returns the default entry too — only keep entries explicitly
      // listing this spell in useSpecific. Without that, we can't be sure
      // the field actually means anything here.
      if (!(m.useSpecific && m.useSpecific.indexOf(itemId) !== -1)) continue;
      // Attach the hand-mapped English label + format hint when we have one
      // for this internal ID. Locale-namespace WESTRINGs would replace this
      // map once that data lands; the field is purely presentational.
      const lbl = INTERNAL_ID_LABELS[m.internalId];
      dataMeta[letter] = lbl ? Object.assign({}, m, { label: lbl.label, format: lbl.format }) : m;
      usedData[letter] = lvl.data[letter];
    }

    // Ubertip strings (one per level) + the gold-text numbers extracted from
    // each. ubertipNumbers[lvl] is the order the tooltip mentions them.
    const fn = funcs[itemId] || {};
    const ubertips = [];
    const ubertipNumbers = [];
    let anyTip = false;
    for (let i = 0; i < maxLevel; i++) {
      const u = fn['Ubertip[' + i + ']'] || (i === 0 ? fn['Ubertip'] : '') || '';
      ubertips.push(plainText(u));
      ubertipNumbers.push(extractUbertipNumbers(u));
      if (u) anyTip = true;
    }
    if (!anyTip) noTooltip.push(itemId);

    // For summon spells, look up the per-level summoned unit's stats. This
    // is how we answer "what does the L2 wolf give over the L1 wolf" — the
    // summoned units (osw1/osw2/osw3 etc.) are full unit entries with their
    // own HP, damage roll, and ability list.
    let summons = null;
    const ha = heroAbilities[itemId];
    const summonIds = Array.isArray(ha.summonItemId) ? ha.summonItemId : null;
    if (summonIds && summonIds.length) {
      summons = [];
      // De-dup: some heroAbilities entries have ['osw1','osw1','osw1'] (same
      // unit at every level — see AUcb Carrion Beetles). Keep all levels but
      // tag them with the actual level number so the renderer knows.
      for (let i = 0; i < summonIds.length; i++) {
        const u = unitSummary(summonIds[i]);
        if (u) { u.spellLevel = i + 1; summons.push(u); }
      }
      if (!summons.length) summons = null;
    }

    out[itemId] = {
      name: heroAbilities[itemId].displayName || itemId,
      slkComment: safeStr(r.comments),
      maxLevel,
      manaCost: lvl.manaCost,
      cooldown: lvl.cooldown,
      duration: lvl.duration,
      durationHero: lvl.durationHero,
      area: lvl.area,
      castRange: lvl.castRange,
      data: Object.keys(usedData).length ? usedData : lvl.data,    // metadata-filtered when available
      dataMeta: Object.keys(dataMeta).length ? dataMeta : null,
      summons,
      tip: fn.Tip ? plainText(fn.Tip) : null,
      ubertips: anyTip ? ubertips : null,
      ubertipNumbers: anyTip ? ubertipNumbers : null
    };
  }

  // 5. Write JSON + the client UMD wrapper that hangs it off window.
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(out, null, 2));
  const stamp = new Date().toISOString().slice(0, 10);
  const jsContent = `/**\n` +
` * HeroAbilityStats.js — STRICT per-level data for every hero ability,\n` +
` * generated from WC3 CASC game files by tools/parse-ability-data.js.\n` +
` * DO NOT EDIT BY HAND — re-run the tool to regenerate.\n` +
` *\n` +
` * Generated: ${stamp}\n` +
` * Sources:   ${sources.join(', ')}\n` +
` *\n` +
` * Schema per spell (keyed by spellItemId):\n` +
` *   { name, slkComment, maxLevel,\n` +
` *     manaCost[], cooldown[], duration[], durationHero[], area[], castRange[],\n` +
` *     data: { DataA[], DataB[], ... },     // raw per-level Data fields from SLK\n` +
` *     dataMeta: { DataA: { name, useSpecific }, ... } | null,  // from AbilityMetaData.slk\n` +
` *     tip: string | null,\n` +
` *     ubertips: string[] | null,            // one tooltip per level (plain text)\n` +
` *     ubertipNumbers: number[][] | null }   // gold-text numbers, in tooltip order, per level\n` +
` *\n` +
` * Walkthrough's spike step derives its presentation rows from this raw shape\n` +
` * at render time (see _guideSpikeBlock in client/js/app.js). When Ubertips\n` +
` * are present, those numbers drive the displayed effect rows; without them\n` +
` * only mana/cooldown/duration/area changes appear.\n` +
` */\n` +
`(function (root, factory) {\n` +
`  const mod = factory();\n` +
`  if (typeof module !== 'undefined' && module.exports) module.exports = mod;\n` +
`  else root.HeroAbilityStats = mod;\n` +
`})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {\n` +
`  'use strict';\n` +
`  return ${JSON.stringify(out, null, 2)};\n` +
`});\n`;
  fs.writeFileSync(OUTPUT_JS, jsContent);

  console.log(`Wrote ${Object.keys(out).length} hero abilities to:`);
  console.log(`  - ${path.relative(process.cwd(), OUTPUT_JSON)}`);
  console.log(`  - ${path.relative(process.cwd(), OUTPUT_JS)}`);
  console.log(`Sources used: ${sources.join(', ')}`);
  if (missing.length) console.warn(`No SLK row for ${missing.length} hero abilities: ${missing.join(', ')}`);
  if (noTooltip.length) {
    // The AbilityFunc.txt files in the base war3.w3mod namespace only carry
    // button positions / order strings. The Ubertip text + WESTRING values
    // live in the locale namespace (war3local.w3mod). Extract THAT and drop
    // its units/*abilityfunc.txt files in here too.
    console.warn(`No Ubertip text for ${noTooltip.length} abilities — those strings live in the locale namespace (war3local.w3mod). Extract it and drop units/*abilityfunc.txt from there.`);
  }
  if (!metaPath) console.warn('No abilitymetadata.slk found — Data* fields are passed through unlabelled. Drop it into tools/ability-data/ to label them.');
}

main();
