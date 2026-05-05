// CompareView — controller for /compare. Loads:
//   - The user's replays from IndexedDB (via MyReplays)
//   - The pro replay summaries from /data/summaries/{id}.json
//   - The builds-manifest.json (for resolving pro replays to map/race/matchup)
//
// Wires the two pickers (user replay + pro replay), runs ReplayAnalyzer.compare,
// and renders the report card in the existing compare.html DOM.
//
// Critical UX guard: pre-filter pro replays to the same race + matchup as the
// user replay so the user can't pick a pro that fails the matchup guard. We
// still let them through with a warning banner.

const CompareView = class {
  constructor () {
    this.myReplays = new window.MyReplays();
    this.userRecords = [];   // [{id, race, players[], parsedJson?}]
    this.proManifest = null; // builds-manifest.json
    this.proSummaries = {};  // { replayId: summaryJson } (lazy-loaded)

    // DOM refs
    this.userSelect = null;
    this.userSlotSelect = null;
    this.proSelect = null;
    this.proSlotSelect = null;
    this.goBtn = null;
    this.empty = null;
    this.warnings = null;
    this.result = null;
  }

  async bootstrap () {
    this.userSelect = document.getElementById('user-replay-select');
    this.userSlotSelect = document.getElementById('user-slot-select');
    this.proSelect = document.getElementById('pro-replay-select');
    this.proSlotSelect = document.getElementById('pro-slot-select');
    this.goBtn = document.getElementById('compare-go-btn');
    this.empty = document.getElementById('compare-empty');
    this.warnings = document.getElementById('compare-warnings');
    this.result = document.getElementById('compare-result');

    await Promise.all([this._loadUserReplays(), this._loadProManifest()]);

    if (!this.userRecords.length) {
      this.empty.style.display = 'block';
      this.userSelect.disabled = true;
      this.proSelect.disabled = true;
      this.userSlotSelect.disabled = true;
      this.proSlotSelect.disabled = true;
      this.goBtn.disabled = true;
      return;
    }

    this._renderUserOptions();
    this._renderProOptions();
    this._wireEvents();

    // Pre-fill from URL params if present.
    const params = new URLSearchParams(window.location.search);
    const presetUser = params.get('local');
    const presetPro = params.get('r');
    const presetUserSlot = params.get('userPlayer');
    const presetProSlot = params.get('proPlayer');

    if (presetUser && this.userRecords.find(r => r.id === presetUser)) {
      this.userSelect.value = presetUser;
      this._onUserChange();
      if (presetUserSlot) this.userSlotSelect.value = presetUserSlot;
    }
    if (presetPro) {
      const opt = Array.from(this.proSelect.options).find(o => o.value === presetPro);
      if (opt) this.proSelect.value = presetPro;
    }
    if (presetProSlot) {
      this._onProChange();
      this.proSlotSelect.value = presetProSlot;
    }
    if (presetUser && presetPro) {
      this._runCompare();
    }
  }

  async _loadUserReplays () {
    const list = await this.myReplays.list();
    // Hydrate full records (need parsedJson summary fields). Each list entry
    // already has the small subset; for analysis we need the parsed JSON to
    // be derivable into a summary-shaped object.
    for (const entry of list) {
      const full = await this.myReplays.get(entry.id);
      if (!full || !full.parsedJson) continue;
      this.userRecords.push({
        id: full.id,
        race: full.race,
        mapName: full.mapName,
        durationMs: full.durationMs,
        players: full.players,
        parsedJson: full.parsedJson,
        originalFilename: full.originalFilename
      });
    }
  }

  async _loadProManifest () {
    try {
      const res = await fetch('/data/builds-manifest.json');
      this.proManifest = await res.json();
    } catch (e) {
      console.error('Failed to load builds-manifest.json:', e);
      this.proManifest = { builds: [] };
    }
  }

  // Each user replay entry; if multiple players we'll let the user pick a slot.
  _renderUserOptions () {
    this.userSelect.innerHTML = '';
    for (const r of this.userRecords) {
      const opt = document.createElement('option');
      opt.value = r.id;
      const p = (r.players || []).filter(x => x.slot < 24).map(x => x.name).join(' vs ');
      const ts = r.uploadedAt ? ` (${new Date(r.uploadedAt).toLocaleDateString()})` : '';
      opt.textContent = `${r.mapName || 'Unknown map'} — ${p}${ts}`;
      this.userSelect.appendChild(opt);
    }
    this._onUserChange();
  }

  _renderProOptions () {
    // Flatten all pro replay refs from the manifest, deduped by replayId.
    const seen = new Set();
    const refs = [];
    for (const b of (this.proManifest.builds || [])) {
      for (const r of (b.replays || [])) {
        if (!r.replayId || seen.has(r.replayId)) continue;
        seen.add(r.replayId);
        refs.push({
          replayId: r.replayId,
          playerName: r.playerName,
          opponentName: r.opponentName,
          map: r.map,
          buildName: b.name,
          buildRace: b.race,
          matchups: b.matchups || []
        });
      }
    }
    refs.sort((a, b) => (a.playerName || '').localeCompare(b.playerName || ''));
    this.proSelect.innerHTML = '';
    for (const ref of refs) {
      const opt = document.createElement('option');
      opt.value = ref.replayId;
      opt.dataset.race = ref.buildRace;
      opt.dataset.matchups = JSON.stringify(ref.matchups);
      opt.textContent = `${ref.playerName} vs ${ref.opponentName} — ${ref.map} (${ref.buildName})`;
      this.proSelect.appendChild(opt);
    }
    this._onProChange();
  }

  _wireEvents () {
    this.userSelect.addEventListener('change', () => this._onUserChange());
    this.proSelect.addEventListener('change', () => this._onProChange());
    this.goBtn.addEventListener('click', () => this._runCompare());
  }

  _onUserChange () {
    const id = this.userSelect.value;
    const rec = this.userRecords.find(r => r.id === id);
    this.userSlotSelect.innerHTML = '';
    if (!rec) return;
    for (const p of (rec.players || [])) {
      if (p.slot >= 24) continue;
      const opt = document.createElement('option');
      opt.value = String(p.slot);
      opt.textContent = `Slot ${p.slot}: ${p.name} (${p.race})`;
      this.userSlotSelect.appendChild(opt);
    }
    // Filter pro replays to same race as user's selected race.
    this._filterProByRace(rec.race);
  }

  _filterProByRace (userRace) {
    let firstVisible = null;
    for (const opt of Array.from(this.proSelect.options)) {
      // The build-level race in the manifest is the *user's* race in the
      // build, so we match that to the user's selected replay race. Show all
      // races but visually de-emphasize incompatible ones.
      const proRace = opt.dataset.race;
      const compatible = !userRace || !proRace || proRace === userRace;
      opt.disabled = !compatible;
      opt.style.color = compatible ? '' : '#666';
      if (compatible && !firstVisible) firstVisible = opt;
    }
    if (firstVisible) {
      this.proSelect.value = firstVisible.value;
      this._onProChange();
    }
  }

  _onProChange () {
    // Pro replay summary contains player slot info — fetch it (cached).
    const proId = this.proSelect.value;
    this.proSlotSelect.innerHTML = '';
    if (!proId) return;
    this._loadProSummary(proId).then(summary => {
      if (!summary) return;
      const players = summary.players || {};
      for (const slot of Object.keys(players)) {
        const p = players[slot];
        const opt = document.createElement('option');
        opt.value = slot;
        opt.textContent = `Slot ${slot}: ${p.name} (${p.race})`;
        this.proSlotSelect.appendChild(opt);
      }
    });
  }

  async _loadProSummary (replayId) {
    if (this.proSummaries[replayId]) return this.proSummaries[replayId];
    try {
      const res = await fetch(`/data/summaries/${encodeURIComponent(replayId)}.json`);
      if (!res.ok) return null;
      const json = await res.json();
      this.proSummaries[replayId] = json;
      return json;
    } catch (e) {
      console.error('Failed to load pro summary:', replayId, e);
      return null;
    }
  }

  // Build a "summary"-shaped object from a parsed wc3v JSON in IndexedDB.
  // The user's replay was parsed in-browser and stored as the full .wc3v
  // object — but ReplayAnalyzer expects the summary shape. Mirror what
  // scripts/generate-summary.js produces, with just enough fields for
  // analysis.
  _buildUserSummary (record) {
    const full = record.parsedJson;
    if (!full) return null;
    const summary = {
      replayId: record.id,
      map: this._cleanMapName((full.replay && full.replay.metadata && full.replay.metadata.map && full.replay.metadata.map.mapName) || ''),
      mapRaw: (full.replay && full.replay.metadata && full.replay.metadata.map && full.replay.metadata.map.mapName) || '',
      durationMs: (full.replay && full.replay.subheader && full.replay.subheader.replayLengthMS) || 0,
      players: {}
    };

    for (const slot of Object.keys(full.players || {})) {
      const p = full.players[slot];
      if (!p || p.isNeutralPlayer) continue;
      const replayP = (full.replay && full.replay.players && full.replay.players[slot]) || {};
      summary.players[slot] = this._derivePlayerSummary(p, replayP);
    }
    return summary;
  }

  _derivePlayerSummary (playerData, replayPlayerData) {
    const eventStream = playerData.eventStream || [];
    const tierStream = playerData.tierStream || [];
    const race = playerData.race || replayPlayerData.raceDetected;

    let heroOpener = null;
    for (const ev of eventStream) {
      // Tavern heroes are emitted as 'makeTavernHero', not 'addUnit'.
      const isHeroEvent = ev.unit && (
        (ev.key === 'addUnit' && ev.unit.isHero) ||
        ev.key === 'makeTavernHero'
      );
      if (isHeroEvent) {
        heroOpener = { name: ev.unit.displayName, itemId: ev.unit.itemId, gameTimeMs: ev.gameTime };
        break;
      }
    }

    let tier2Time = null, tier3Time = null;
    for (const t of tierStream) {
      if (t.tier === 2 && tier2Time === null) tier2Time = t.gameTime;
      if (t.tier === 3 && tier3Time === null) tier3Time = t.gameTime;
    }

    let expansionTime = null;
    for (const ev of eventStream) {
      if (ev.isExpansion) { expansionTime = ev.gameTime; break; }
    }

    const TOWER_IDS = { hgtw: 1, hgt1: 1, hgt2: 1, hwtw: 1, owtw: 1, unpl: 1, etrp: 1, etol: 1 };
    const WORKER_IDS = { opeo: 1, hpea: 1, ewsp: 1, uaco: 1, ugho: 1 };
    const SUMMON_UNIT_IDS = { uske: 1, hwat: 1, hwt2: 1, hwt3: 1, efon: 1, osw1: 1, osw2: 1, osw3: 1, ucs1: 1 };

    let firstTowerTime = null;
    let firstUnitTime = null;
    let firstHeroLevel2Time = null;
    let firstHeroLevel3Time = null;

    for (const ev of eventStream) {
      if (firstTowerTime === null && ev.key === 'addBuilding' && ev.building && TOWER_IDS[ev.building.itemId]) {
        firstTowerTime = ev.gameTime;
      }
      if (firstUnitTime === null && ev.key === 'addUnit' && ev.unit && !ev.unit.isHero
          && !WORKER_IDS[ev.unit.itemId] && !ev.unit.isSummon && !SUMMON_UNIT_IDS[ev.unit.itemId]) {
        firstUnitTime = ev.gameTime;
      }
      if (ev.key === 'heroLevel') {
        if (firstHeroLevel2Time === null && ev.level === 2) firstHeroLevel2Time = ev.gameTime;
        if (firstHeroLevel3Time === null && ev.level === 3) firstHeroLevel3Time = ev.gameTime;
      }
    }

    // economyTrack: 30s samples
    const economyTrack = [];
    let nextSampleAt = 0;
    let lastSnapshot = null;
    for (const ev of eventStream) {
      if (typeof ev.gameTime !== 'number') continue;
      if (typeof ev.supplyUsed === 'number') {
        lastSnapshot = {
          gameTimeMs: ev.gameTime,
          supplyUsed: ev.supplyUsed,
          supplyMax: ev.supplyMax || 0,
          workersOnGold: ev.workers ? (ev.workers.onGold || 0) : 0,
          workersOnLumber: ev.workers ? ((ev.workers.onLumber || 0) + (ev.workers.ghoulsOnLumber || 0)) : 0,
          totalWorkers: ev.workers ? (ev.workers.totalWorkers || 0) : 0
        };
      }
      while (lastSnapshot && ev.gameTime >= nextSampleAt && nextSampleAt <= 30 * 60 * 1000) {
        economyTrack.push({ ...lastSnapshot, gameTimeMs: nextSampleAt });
        nextSampleAt += 30 * 1000;
      }
    }

    // buildPreview: first 20 meaningful events
    const buildPreview = [];
    for (const ev of eventStream) {
      if (buildPreview.length >= 20) break;
      if (ev.key === 'addBuilding' && ev.building) {
        buildPreview.push({
          type: ev.isExpansion ? 'expansion' : 'building',
          name: ev.building.displayName,
          itemId: ev.building.itemId || '',
          gameTimeMs: ev.gameTime
        });
      } else if (ev.key === 'addUnit' && ev.unit) {
        if (WORKER_IDS[ev.unit.itemId]) continue;
        if (ev.unit.isSummon || SUMMON_UNIT_IDS[ev.unit.itemId]) continue;
        buildPreview.push({
          type: ev.unit.isHero ? 'hero' : 'unit',
          name: ev.unit.displayName,
          itemId: ev.unit.itemId || '',
          gameTimeMs: ev.gameTime
        });
      }
    }

    // archetype (mirror generate-summary.js classifyArchetype)
    const SIX_MIN = 6 * 60 * 1000;
    const EIGHT_MIN = 8 * 60 * 1000;
    const FOUR_MIN = 4 * 60 * 1000;
    const TWO_MIN = 2 * 60 * 1000;
    let archetype = 'unknown';
    if (firstTowerTime !== null && firstTowerTime < FOUR_MIN) {
      archetype = 'tower-rush';
    } else if (expansionTime !== null) {
      if (tier2Time === null) archetype = 'fast-expand';
      else if (expansionTime < tier2Time) archetype = 'fast-expand';
      else if (expansionTime - tier2Time < TWO_MIN) archetype = 'fast-expand';
    }
    if (archetype === 'unknown' && tier2Time !== null && tier2Time < SIX_MIN
        && (expansionTime === null || expansionTime > EIGHT_MIN)) {
      archetype = '1-base-t2';
    }

    return {
      name: replayPlayerData.name,
      race,
      heroOpener,
      tier2Time,
      tier3Time,
      expansionTime,
      firstTowerTime,
      firstUnitTime,
      firstHeroLevel2Time,
      firstHeroLevel3Time,
      archetype,
      economyTrack,
      buildPreview
    };
  }

  _cleanMapName (raw) {
    if (!raw) return '';
    let n = raw.replace(/\\/g, '/').split('/').pop().replace(/\.(w3x|w3m)$/i, '');
    n = n.replace(/^\(\d+\)\s*/, '').replace(/^w3c_/, '').replace(/_v[\d.-]+$/, '');
    n = n.replace(/[_]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
    return n;
  }

  async _runCompare () {
    const userId = this.userSelect.value;
    const userSlot = this.userSlotSelect.value;
    const proId = this.proSelect.value;
    const proSlot = this.proSlotSelect.value;
    if (!userId || !proId || !userSlot || !proSlot) return;

    const userRecord = this.userRecords.find(r => r.id === userId);
    if (!userRecord) return;
    const userSummary = this._buildUserSummary(userRecord);
    const proSummary = await this._loadProSummary(proId);
    if (!userSummary || !proSummary) return;

    const report = window.ReplayAnalyzer.compare({
      userSummary, userSlot, proSummary, proSlot, proResult: 'unknown'
    });

    this._renderReport(report);
  }

  _renderReport (report) {
    this.result.style.display = 'block';

    // Overall card
    document.getElementById('overall-grade').textContent = report.overall.grade;
    document.getElementById('overall-grade').className = `compare-overall-grade grade-${report.overall.grade}`;
    document.getElementById('overall-score').textContent = report.overall.score;
    if (report.meta) {
      document.getElementById('overall-vs').textContent =
        `${report.meta.userPlayer.name} (${report.meta.userPlayer.race}) vs ${report.meta.proPlayer.name} (${report.meta.proPlayer.race})`;
      document.getElementById('overall-context').textContent =
        `${report.meta.userMap} → ${report.meta.proMap}` +
        (report.meta.userPlayer.archetype && report.meta.proPlayer.archetype
          ? ` · ${report.meta.userPlayer.archetype} vs ${report.meta.proPlayer.archetype}`
          : '');
    }

    // Warnings
    if (report.warnings && report.warnings.length) {
      this.warnings.style.display = 'block';
      this.warnings.innerHTML = report.warnings.map(w => `<div class="compare-warning">${this._esc(w)}</div>`).join('');
    } else {
      this.warnings.style.display = 'none';
      this.warnings.innerHTML = '';
    }

    // Per-category tiles
    const container = document.getElementById('compare-categories');
    container.innerHTML = '';
    const order = ['macro', 'tech', 'expansion', 'buildAdherence', 'production'];
    const labels = {
      macro: 'Macro', tech: 'Tech', expansion: 'Expansion',
      buildAdherence: 'Build Adherence', production: 'Production'
    };
    for (const k of order) {
      const cat = report.categories[k];
      if (!cat) continue;
      const tile = document.createElement('div');
      tile.className = `compare-tile compare-tile-${cat.available ? 'on' : 'off'}`;
      const findings = (cat.findings || []).map(f =>
        `<li class="compare-finding compare-finding-${f.severity}">${this._esc(f.text)}</li>`
      ).join('');
      tile.innerHTML = `
        <div class="compare-tile-header">
          <div class="compare-tile-label">${labels[k]}</div>
          ${cat.available
            ? `<div class="compare-tile-grade grade-${cat.grade}">${cat.grade}</div>`
            : `<div class="compare-tile-grade grade-NA">N/A</div>`}
        </div>
        ${cat.available
          ? `<div class="compare-tile-score">${cat.score}/100</div>`
          : `<div class="compare-tile-reason">${this._esc(cat.reason || 'unavailable')}</div>`}
        ${findings ? `<ul class="compare-findings">${findings}</ul>` : ''}
      `;
      container.appendChild(tile);
    }
  }

  _esc (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
};

if (typeof window !== 'undefined') window.CompareView = CompareView;
