/**
 * MatchSummary.js — the viewer's Match Summary modal.
 *
 * This file owns the modal: the chrome, the tabs, the lifecycle, and the
 * dominance plot mounted into the Overview tab. It draws NONE of the tab
 * content.
 *
 * The six tab renderers live in MatchSummaryView.js, because the desktop app
 * shows this same screen for a game you just played, and two implementations of
 * one screen is the drift the mount-seam rule exists to prevent. What is left
 * here is the viewer adapter: it turns `viewer.buildOrderPlayers` and the parsed
 * map data into the model that renderer takes.
 *
 * The adapter is deliberately thin. As of schema v5 the desktop STORES what
 * BuildOrderData produces, so `production`, `tierProduction` and
 * `finalSnapshot` pass straight through on both sides and only the things that
 * live outside BuildOrderData (items, mercs, research, APM, camps) need
 * normalising.
 *
 * Replay text is no longer escaped on the way into a string, because the
 * renderer builds nodes and assigns textContent. Security.js is still the right
 * answer for anything here that does build markup; nothing does any more.
 */

const MatchSummary = class {
  constructor (viewer) {
    this.viewer = viewer;
    this.boData = new BuildOrderData();
    this.modal = null;
    this.visible = false;
    this.activeTab = 'overview';
    this._model = null;
    this._renderedTabs = {};
    // The Overview tab's dominance plot. Held because DominanceChart registers
    // a ResizeObserver, so dropping its nodes is not enough to release it.
    this._domChart = null;
  }

  setup () {
    this.modal = document.getElementById('ms-modal');
    if (!this.modal) return;

    // A fresh MatchSummary is constructed on every replay load, but #ms-modal
    // and document persist — so a per-instance guard can't prevent re-binding.
    // Remove the listeners a prior instance bound (stashed on the modal) before
    // re-wiring, or each reload stacks another keydown/click handler set.
    if (this.modal._msTeardown) this.modal._msTeardown();

    const onClose = () => this.hide();
    const onBackdrop = (e) => { if (e.target === this.modal) this.hide(); };
    const onKeydown = (e) => { if (e.key === 'Escape' && this.visible) this.hide(); };
    const onTab = (e) => this._switchTab(e.currentTarget.dataset.tab);

    const closeBtn = this.modal.querySelector('.ms-close');
    if (closeBtn) closeBtn.addEventListener('click', onClose);
    this.modal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKeydown);
    const tabs = [...this.modal.querySelectorAll('.ms-tab')];
    tabs.forEach(tab => tab.addEventListener('click', onTab));

    this.modal._msTeardown = () => {
      if (closeBtn) closeBtn.removeEventListener('click', onClose);
      this.modal.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKeydown);
      tabs.forEach(tab => tab.removeEventListener('click', onTab));
      // Closes over the PRIOR instance, which is the point: loading a replay
      // constructs a new MatchSummary whose setup() runs this, and the old
      // instance's chart observer would otherwise outlive its own nodes.
      this._destroyDominance();
    };

    this._createTriggerButton();
  }

  _createTriggerButton () {
    const scrubber = document.getElementById('scrubber-bar-scrubber');
    if (!scrubber) return;

    const btn = document.createElement('div');
    btn.className = 'ms-trigger-btn';
    btn.textContent = 'Summary';
    btn.addEventListener('click', () => {
      this.viewer.showMatchSummary();
    });

    scrubber.appendChild(btn);
  }

  show () {
    if (!this.viewer.gameLoaded || !this.modal) return;

    this._model = this._buildModel();
    this._renderedTabs = {};

    const mapNameEl = this.modal.querySelector('.ms-map-name');
    const durationEl = this.modal.querySelector('.ms-duration');

    if (mapNameEl) {
      const raw = (this.viewer.mapInfo && this.viewer.mapInfo.name) || this.viewer.mapName || '';
      mapNameEl.textContent = this._cleanMapName(raw);
    }

    if (durationEl && this.viewer.matchEndTime) {
      durationEl.textContent = formatGameTime(this.viewer.matchEndTime);
    }

    this._switchTab('overview');
    this.modal.style.display = 'flex';
    this.visible = true;
  }

  hide () {
    if (!this.modal) return;
    this.modal.style.display = 'none';
    this.visible = false;
  }

  _cleanMapName (raw) {
    return raw
      .replace(/\.w3[xm]$/i, '')
      .replace(/_/g, ' ')
      .replace(/[-\s]v\d+[-.]?\d*/gi, '')
      .replace(/\s+\d+$/, '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .trim();
  }

  _switchTab (tabName) {
    this.activeTab = tabName;

    this.modal.querySelectorAll('.ms-tab').forEach(tab => {
      tab.classList.toggle('ms-tab-active', tab.dataset.tab === tabName);
    });

    this.modal.querySelectorAll('.ms-tab-content').forEach(el => {
      el.style.display = 'none';
    });

    const target = this.modal.querySelector(`.ms-tab-${tabName}`);
    if (!target) return;
    target.style.display = '';

    if (this._renderedTabs[tabName] || !window.MatchSummaryView || !this._model) return;

    const content = window.MatchSummaryView.render(tabName, this._model, this._viewOpts());
    target.innerHTML = '';
    if (content) target.appendChild(content);
    // The dominance plot is DominanceChart, whose data, gate and teardown all
    // belong to whoever owns the screen. The renderer leaves a slot.
    if (tabName === 'overview') this._mountDominance(target);
    this._renderedTabs[tabName] = true;
  }

  // ── The renderer's injection points ─────────────────────────────────────────

  _viewOpts () {
    const safeId = (id) => /^[A-Za-z0-9_\-]{1,32}$/.test(String(id == null ? '' : id)) ? String(id) : '';
    return {
      icon: (itemId) => {
        const id = safeId(itemId);
        const img = document.createElement('img');
        img.alt = '';
        if (id) img.src = `/assets/wc3icons/${id}.jpg`;
        img.addEventListener('error', () => { img.style.display = 'none'; });
        return img;
      },
      asset: (file) => `/assets/wc3icons/${file}`,
      wantsDominance: !!this._dominanceInfos()
    };
  }

  // ── Viewer → model ──────────────────────────────────────────────────────────

  _buildModel () {
    const { buildOrderPlayers } = this.viewer;
    const players = [];

    const groups = (this.viewer.mapData && this.viewer.mapData.world &&
      this.viewer.mapData.world.neutralGroups) || {};
    const groupList = Object.values(groups);

    // A player's team, read off the camps rather than off the player: the
    // viewer's own Creeps tab has always derived it this way, and claimers is
    // the only place the parse states it in a form this screen can use.
    const teamOf = (playerId) => {
      for (const g of groupList) {
        if (!g.claimers) continue;
        for (const [teamId, team] of Object.entries(g.claimers)) {
          if (team.players && team.players[playerId]) return parseInt(teamId, 10);
        }
      }
      return null;
    };

    (buildOrderPlayers || []).forEach(player => {
      if (player.isNeutralPlayer) return;
      const bo = this.boData.processBuildOrderData(player);

      players.push({
        name: bo.displayName,
        race: bo.race,
        raceLabel: bo.raceInfo.label,
        raceAccent: bo.raceInfo.accent,
        raceIconId: BuildOrderData.CONFIG.raceStarterIcons[bo.race] || '',
        color: bo.playerColor,
        teamId: teamOf(player.playerId),

        production: bo.production,
        tierProduction: bo.tierProduction,
        finalSnapshot: bo.finalSnapshot,
        // The renderer takes null for "never reached". The viewer uses
        // Infinity, a stored summary uses null, and null is the one that
        // survives JSON, so both adapters converge on it.
        tier2Time: bo.tier2Time === Infinity ? null : bo.tier2Time,
        tier3Time: bo.tier3Time === Infinity ? null : bo.tier3Time,
        hasExpansion: bo.hasExpansion,

        apm: this._apmOf(player),
        itemPurchases: this._itemsOf(player, 'purchases'),
        itemUses: this._itemsOf(player, 'uses'),
        mercenaries: this._mercsOf(player),
        researchTimeline: this._researchOf(player),
        heroInventories: (player.heroes || []).map(h =>
          ({ name: h.displayName, items: (h.items || []).filter(i => i.itemId) })),

        supplyTrack: this._trackOf(player, (e) => e.supplyUsed),
        workerTrack: this._trackOf(player, (e) => {
          const w = e.workers || {};
          // UD ghouls on lumber are tracked separately and are always summed.
          return (w.totalWorkers || 0) + (w.ghoulsOnLumber || 0);
        })
      });
    });

    return {
      matchEndMs: this.viewer.matchEndTime || 0,
      players,
      camps: groupList.map(g => this._campOf(g))
    };
  }

  _apmOf (player) {
    const apm = player.apmData;
    if (!apm || !apm.effective) return null;
    return {
      perMinute: apm.effective.perMinute || [],
      peak: apm.effective.peak || 0,
      average: apm.effective.average || 0,
      categories: apm.categories || {}
    };
  }

  // The viewer's itemStream is already stacked per item, which is the shape the
  // renderer wants. Only the field names differ.
  _itemsOf (player, key) {
    const rows = (player.itemStream && player.itemStream[key]) || [];
    return rows.map(r => ({
      itemId: r.itemId,
      name: r.displayName || r.itemId || '',
      count: r.count || 0,
      gold: r.goldSpent || 0
    }));
  }

  _mercsOf (player) {
    const byId = new Map();
    for (const e of (player.eventStream || [])) {
      if (e.key !== 'hireMercenary' || !e.unit) continue;
      const id = e.unit.itemId;
      let row = byId.get(id);
      if (!row) byId.set(id, row = { itemId: id, name: e.unit.displayName || id, count: 0, gold: 0 });
      row.count++;
      row.gold += e.goldCost || 0;
    }
    return Array.from(byId.values());
  }

  _researchOf (player) {
    return (player.eventStream || [])
      .filter(e => e.key === 'research')
      .map(e => ({
        itemId: e.itemId,
        icon: e.icon,
        name: e.displayName || e.itemId || '',
        level: e.level || 0,
        timeFormatted: formatGameTime(e.gameTime)
      }));
  }

  // {t, v} pairs off the raw event stream. The desktop reads a sampled economy
  // track instead, which is why the renderer takes points rather than events.
  _trackOf (player, valueFn) {
    const out = [];
    for (const e of (player.eventStream || [])) {
      const v = valueFn(e);
      if (v === undefined || v === null) continue;
      out.push({ t: e.gameTime, v });
    }
    return out;
  }

  _campOf (g) {
    const xpByHero = {};
    for (const r of (g.heroClaimRecords || [])) {
      if (!r || !r.uuid) continue;
      if (!xpByHero[r.uuid]) xpByHero[r.uuid] = { uuid: r.uuid, name: r.displayName || '', xp: 0 };
      xpByHero[r.uuid].xp += r.xpGained || 0;
    }
    const t = (typeof g.claimTime === 'number' && g.claimTime > 0)
      ? g.claimTime : g.firstInteractionTime;
    return {
      groupId: g.uuid,
      totalLevel: g.totalLevel || 0,
      claimState: g.claimState || 0,
      ownerTeamId: (g.claimOwnerId === undefined || g.claimOwnerId === null) ? null : g.claimOwnerId,
      order: g.order || 0,
      timeFormatted: window.MatchSummaryView.fmt(t),
      units: (g.units || []).map(u => ({
        itemId: u.itemId,
        name: u.displayName || '',
        level: (u.balanceInfo && u.balanceInfo.level) || 0
      })),
      heroXp: Object.values(xpByHero)
    };
  }

  // ── Dominance (Overview) ────────────────────────────────────────────────────

  // The same gate the Insights tab uses (app.js): a 1v1, the parser's own
  // availability flag, and two players carrying a series. A degraded parse
  // emits no dominanceSeries at all. See lib/DominanceSeries.js.
  //
  // Returns the setPlayers() array or null. Called twice per render, once to
  // decide whether the section exists and once to build it, so the gate has
  // one definition rather than a boolean that can drift from the data.
  _dominanceInfos () {
    const v = this.viewer;
    if (!window.DominanceChart || !v || !v.mapData || !v.mapData.players) return null;
    if (!v.mapData.dominance || !v.mapData.dominance.available) return null;
    if (typeof v.getGameMode !== 'function' || v.getGameMode() !== '1v1') return null;

    const infos = [];
    for (const [pid, p] of Object.entries(v.mapData.players)) {
      const series = p && p.dominanceSeries;
      if (!series || !series.samples || !series.samples.length) continue;
      const cp = (v.players || []).find(c => String(c.playerId) === String(pid));
      infos.push({
        id: pid,
        color: (cp && cp.playerColor) || '#888',
        samples: series.samples,
        events: series.events || []
      });
    }
    return infos.length === 2 ? infos : null;
  }

  _mountDominance (host) {
    // show() clears _renderedTabs, so Overview re-renders on every open and the
    // previous observer has to go before a second one is registered.
    this._destroyDominance();

    const slot = host.querySelector('.ms-dom-slot');
    const infos = slot ? this._dominanceInfos() : null;
    if (!infos) return;

    // Its OWN instance. viewer.dominanceChart is bound to the Insights tab's
    // container, and setContainer() on it would move that chart in here.
    const chart = new window.DominanceChart(this.viewer);
    chart.setContainer(slot);
    // Draw into a viewBox the size of the element. The Insights panel this
    // chart was authored for is ~320px wide, which is about what the viewBox
    // says; this modal is three times that, and preserveAspectRatio="none"
    // stretches every horizontal unit to match while the vertical stays put.
    // The result reads as a zoomed chart: a 90px y-axis gutter and slopes
    // sheared flat.
    chart.setResponsive(true);
    chart.setPlayers(infos);
    // Trim the flat opening. The score eases out of an even 50/50 over the
    // engine's 150s early ramp, which is real, but on a 17-minute game it is
    // about 15% of the width spent drawing a straight line. The axis labels its
    // own start, so a plot beginning at 2:30 cannot read as a late game.
    chart.setStart(chart.firstMoveT(1));
    chart.build();

    // Drawn whole rather than up to the playhead. Progressive draw is a
    // no-spoilers rule for a game being watched, and this modal is already
    // showing final gold spent, every unit made and the closing supply.
    const endT = Math.max(
      infos[0].samples[infos[0].samples.length - 1].t,
      infos[1].samples[infos[1].samples.length - 1].t
    );
    chart.setCursor(endT);

    this._domChart = chart;
  }

  _destroyDominance () {
    if (!this._domChart) return;
    this._domChart.destroy();
    this._domChart = null;
  }
};

window.MatchSummary = MatchSummary;
