//
// CampPanel — click-driven neutral creep-camp UI (Project C).
//
// Replaces the hover-only camp popup with: small clickable icons rendered
// near each camp on screen, and a detail panel with two tabs —
//   • Credit  : per-player event stages + the credit checklist, confidence,
//               honest "uncertain / why" labelling, and a durable per-camp
//               manual override (pros can correct the engine's call).
//   • Info    : the camp's creep roster + potential drops (reuses
//               GameDisplayBox.renderNeutralCamp so there is one source).
//
// Live-synced to playback time: event stages check off progressively and the
// credit checklist updates from the parser-exported playerCreditTimeline
// (the client never re-derives the credit formula).
//
// Coordinator pattern: constructed by Wc3vViewer, hangs off window. Never
// mutates parsed .wc3v data — overrides are shadow data in localStorage.
//
const CampPanel = class {
  constructor (viewer) {
    this.viewer = viewer;
    this.teamColorMap = (viewer && viewer.teamColorMap) || {};
    this.neutralGroups = null;
    this.replayId = (viewer && viewer.replayId) || 'default';

    this.openUuid = null;
    this.openTab = 'credit';
    this._lastSyncTime = -1;
    this._iconEls = {};   // uuid -> { wrap, info, timeline }

    this.iconLayer = document.getElementById('camp-icon-layer');
    this.panel = document.getElementById('camp-detail-panel');
    const canvasGroup = document.getElementById('canvas-group');
    if (!this.iconLayer) {
      // defensive: must live INSIDE canvas-group so it shares the canvases'
      // exact box and any live-mode CSS transform.
      this.iconLayer = document.createElement('div');
      this.iconLayer.id = 'camp-icon-layer';
      (canvasGroup || document.body).appendChild(this.iconLayer);
    } else if (canvasGroup && this.iconLayer.parentNode !== canvasGroup) {
      // older markup may have it as a sibling — re-home it.
      canvasGroup.appendChild(this.iconLayer);
    }
    if (!this.panel) {
      this.panel = document.createElement('div');
      this.panel.id = 'camp-detail-panel';
      this.panel.setAttribute('role', 'dialog');
      this.panel.hidden = true;
      ((canvasGroup && canvasGroup.parentNode) || document.body).appendChild(this.panel);
    }

    // dismiss on Escape / outside click
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.panel.hidden) this.close();
    });
    document.addEventListener('mousedown', (e) => {
      if (this.panel.hidden) return;
      if (this.panel.contains(e.target)) return;
      if (e.target.closest && e.target.closest('.camp-icon-btn')) return;
      this.close();
    });
  }

  setData (neutralGroups) {
    this.neutralGroups = neutralGroups || null;
    this.replayId = (this.viewer && this.viewer.replayId) || 'default';
  }

  _isNonOneVsOne () {
    return !!(window.wc3v && typeof window.wc3v.isNonOneVsOne === 'function'
      && window.wc3v.isNonOneVsOne());
  }

  // ---- per-camp manual override (durable shadow data) ------------------

  _ovKey (uuid) { return `wc3v.campOverride.${this.replayId}.${uuid}`; }

  getOverride (uuid) {
    try {
      const raw = localStorage.getItem(this._ovKey(uuid));
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  setOverride (uuid, value) {
    try {
      if (value == null) localStorage.removeItem(this._ovKey(uuid));
      else localStorage.setItem(this._ovKey(uuid), JSON.stringify(value));
    } catch (e) { /* storage may be blocked — non-fatal */ }
  }

  // ---- on-screen icons -------------------------------------------------

  // campHitBuf: [{ rawGroup, cx, cy, r }] in canvas-PIXEL space (same numbers
  // MapRenderer drew). Convert to CSS px exactly as GameDisplayBox maps the
  // mouse, but inverted: cssX = canvasPx / (canvas.width / canvas.clientWidth).
  // The layer is inside #canvas-group so its (0,0) == the canvases' (0,0) and
  // any live-mode CSS transform applies equally — no displayScale needed.
  syncIcons (campHitBuf) {
    if (!this.iconLayer) return;
    const canvas = document.getElementById('main-canvas');
    if (!canvas || !canvas.width) return;
    const cssW = canvas.clientWidth || canvas.width;
    const cssH = canvas.clientHeight || canvas.height;
    const scaleX = canvas.width / cssW;   // canvas px per CSS px
    const scaleY = canvas.height / cssH;
    if (!scaleX || !scaleY || !isFinite(scaleX) || !isFinite(scaleY)) return;
    const seen = {};

    (campHitBuf || []).forEach(hit => {
      const g = hit.rawGroup;
      if (!g || !g.uuid) return;
      // only surface icons once the camp is actually in play
      const hasEvents = g.perPlayerEvents && g.perPlayerEvents.length;
      const touched = (g.claimState && g.claimState !== 0) || hasEvents;
      if (!touched) return;

      // Cull camps that aren't actually on screen. In zoomed/follow/split
      // cameras a camp's world point can project far outside the canvas
      // (negative or > size); without this the icons render in the black
      // letterbox / outside the canvas box entirely.
      const cCssX = hit.cx / scaleX;
      const cCssY = hit.cy / scaleY;
      const M = 30; // allow camps right at the edge to still show
      if (cCssX < -M || cCssX > cssW + M || cCssY < -M || cCssY > cssH + M) {
        const ex = this._iconEls[g.uuid];
        if (ex) ex.wrap.style.display = 'none';
        return; // not in `seen` -> stays hidden
      }
      seen[g.uuid] = true;

      let els = this._iconEls[g.uuid];
      if (!els) {
        els = this._makeIconPair(g.uuid);
        this._iconEls[g.uuid] = els;
      }
      // Place at the camp ring's right edge, converting canvas px -> CSS px,
      // then CLAMP inside the canvas so an edge camp's icon tucks against the
      // edge instead of spilling into the letterbox / sidebar / minimap.
      const ICON_W = 24;          // single button width
      const ICON_H = 50;          // two stacked buttons + gap
      let x = (hit.cx + hit.r + 6) / scaleX;
      let y = (hit.cy - hit.r) / scaleY;
      // if the right-side placement would overflow, flip to the ring's left
      if (x + ICON_W > cssW - 2) x = (hit.cx - hit.r - 6) / scaleX - ICON_W;
      x = Math.max(2, Math.min(x, cssW - ICON_W - 2));
      y = Math.max(2, Math.min(y, cssH - ICON_H - 2));
      els.wrap.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      els.wrap.style.display = '';
    });

    // hide icons for camps no longer in the buffer
    Object.keys(this._iconEls).forEach(uuid => {
      if (!seen[uuid]) this._iconEls[uuid].wrap.style.display = 'none';
    });
  }

  _makeIconPair (uuid) {
    const wrap = document.createElement('div');
    wrap.className = 'camp-icon-wrap';

    const timeline = document.createElement('button');
    timeline.type = 'button';
    timeline.className = 'camp-icon-btn camp-icon-timeline';
    timeline.title = 'Player camp events & credit';
    timeline.setAttribute('aria-label', 'Show player creep-camp events and credit');
    timeline.textContent = '⚔';
    timeline.addEventListener('click', (e) => { e.stopPropagation(); this.open(uuid, 'credit'); });

    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'camp-icon-btn camp-icon-info';
    info.title = 'Camp creeps & drops';
    info.setAttribute('aria-label', 'Show creep-camp unit and drop info');
    info.textContent = 'ⓘ';
    info.addEventListener('click', (e) => { e.stopPropagation(); this.open(uuid, 'info'); });

    wrap.appendChild(timeline);
    wrap.appendChild(info);
    this.iconLayer.appendChild(wrap);
    return { wrap, timeline, info };
  }

  _group (uuid) {
    if (!this.neutralGroups) return null;
    return this.neutralGroups[uuid] ||
      Object.values(this.neutralGroups).find(g => g.uuid === uuid) || null;
  }

  // ---- detail panel ----------------------------------------------------

  open (uuid, tab) {
    this.openUuid = uuid;
    this.openTab = tab || 'credit';
    this._lastSyncTime = -1;
    this.render();
    this.panel.hidden = false;
  }

  close () {
    this.panel.hidden = true;
    this.openUuid = null;
  }

  _fmt (gt) {
    return (typeof formatGameTime === 'function') ? formatGameTime(gt)
      : `${Math.floor(gt / 60000)}:${String(Math.floor((gt % 60000) / 1000)).padStart(2, '0')}`;
  }

  _playerName (pid) {
    const p = this.viewer && this.viewer.players &&
      this.viewer.players.find(pl => String(pl.playerId) === String(pid));
    return (p && (p.name || p.playerName)) || `Player ${pid}`;
  }

  // latest playerCreditTimeline snapshot <= gameTime
  _snapAt (g, gameTime) {
    const tl = g.playerCreditTimeline || [];
    if (!tl.length || gameTime < tl[0].gameTime) return null;
    let lo = 0, hi = tl.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (tl[mid].gameTime <= gameTime) lo = mid; else hi = mid - 1;
    }
    return tl[lo];
  }

  render () {
    const g = this._group(this.openUuid);
    if (!g) { this.close(); return; }

    const tabs =
      `<div class="cdp-tabs">
         <button type="button" class="cdp-tab ${this.openTab === 'credit' ? 'active' : ''}" data-tab="credit">Credit</button>
         <button type="button" class="cdp-tab ${this.openTab === 'info' ? 'active' : ''}" data-tab="info">Camp Info</button>
         <button type="button" class="cdp-close" aria-label="Close">✕</button>
       </div>`;

    let body;
    if (this.openTab === 'info') {
      body = `<div class="cdp-body">${this._infoHtml(g)}</div>`;
    } else if (this._isNonOneVsOne()) {
      body = `<div class="cdp-body"><div class="cdp-gate">
        Per-player creep credit analysis is available for 1v1 replays only.
        Use the <b>Camp Info</b> tab for this camp's creeps and drops.
      </div></div>`;
    } else {
      body = `<div class="cdp-body">${this._creditHtml(g)}</div>`;
    }

    this.panel.innerHTML = tabs + body;

    this.panel.querySelectorAll('.cdp-tab').forEach(btn => {
      btn.addEventListener('click', () => { this.openTab = btn.dataset.tab; this.render(); });
    });
    this.panel.querySelector('.cdp-close').addEventListener('click', () => this.close());

    if (this.openTab === 'credit' && !this._isNonOneVsOne()) {
      this._wireOverrideControls(g);
      const gt = (this.viewer && this.viewer.gameTime) || 0;
      this._applyLiveState(g, gt);
    }
  }

  _infoHtml (g) {
    try {
      if (typeof GameDisplayBox !== 'undefined' && GameDisplayBox.renderNeutralCamp) {
        return GameDisplayBox.renderNeutralCamp(g, this.teamColorMap,
          (this.viewer && this.viewer.assignedPlayerColors) || {});
      }
    } catch (e) { /* fall through */ }
    const units = (g.units || []).map(u => `<li>${u.displayName} (Lv${(u.balanceInfo && u.balanceInfo.level) || 0})</li>`).join('');
    return `<h3>Creep Camp — Lv${g.totalLevel}</h3><ul class="cdp-unitlist">${units}</ul>`;
  }

  _creditHtml (g) {
    const pc = g.playerCredit || {};
    const pids = Object.keys(pc);
    const ov = this.getOverride(g.uuid);
    const leashNote = (g.leashSource === 'wc3Default')
      ? `<span class="cdp-approx" title="The in-camp vs creep-pull boundary uses the standard WC3 default leash (${g.leashDistance}u) because this map does not record a per-camp leash.">pull boundary: standard default</span>`
      : `<span class="cdp-exact">pull boundary: map-exact</span>`;

    let head = `<div class="cdp-head">
      <h3>Creep Camp — Lv${g.totalLevel}</h3>
      <div class="cdp-sub">model ${g.creditModel || '?'} · ${leashNote}</div>`;
    if (ov) {
      head += `<div class="cdp-override-badge" title="${ov.note || ''}">Manually adjusted: ${this._ovLabel(ov, g)}
        <button type="button" class="cdp-ov-clear">reset</button></div>`;
    }
    head += `</div>`;

    if (!pids.length) {
      return head + `<div class="cdp-empty">No player interacted with this camp.</div>`;
    }

    const rows = pids.map(pid => {
      const p = pc[pid];
      const m = p.measured || {};
      const teamColor = this.teamColorMap[p.teamId] || '#888';
      const credited = p.credited;
      const overridden = ov && String(ov.creditedPlayerId) === String(pid);
      const deniedByOv = ov && ov.creditedPlayerId != null &&
        ov.creditedPlayerId !== 'unclear' && String(ov.creditedPlayerId) !== String(pid);

      const statusCls = overridden ? 'ov' : (credited ? 'yes' : 'no');
      const statusTxt = overridden ? 'CREDITED (manual)'
        : (deniedByOv ? 'not credited (manual)'
          : (credited ? 'CREDITED' : 'not credited'));

      const conf = Math.round((p.confidence || 0) * 100);
      const uncertain = p.uncertain
        ? `<span class="cdp-uncertain" title="${(p.confidenceReasons || []).join('; ')}">UNCERTAIN · ${conf}%</span>`
        : `<span class="cdp-conf">confidence ${conf}%</span>`;

      const crit = (p.criteria || []).map(c => {
        const meas = (c.unit === 'ms') ? (c.measured / 1000).toFixed(1) + 's' : c.measured;
        const req = (c.unit === 'ms') ? (c.required / 1000).toFixed(1) + 's' : c.required;
        return `<li class="cdp-crit ${c.pass ? 'cdp-crit-pass' : 'cdp-crit-fail'}">
          <span class="cdp-box">${c.pass ? '✓' : '✗'}</span>
          <span class="cdp-crit-label">${c.label}</span>
          <span class="cdp-crit-val">${meas} / ${req}</span></li>`;
      }).join('');

      const why = (!credited && p.whyNot)
        ? `<div class="cdp-why">Why not credited: ${p.whyNot}</div>` : '';
      const reasons = (p.uncertain && p.confidenceReasons && p.confidenceReasons.length)
        ? `<div class="cdp-reasons">Uncertainty: ${p.confidenceReasons.join('; ')}</div>` : '';

      const ev = (p.evidence || []).map(e =>
        `<span class="cdp-ev ${e.zone}">${this._fmt(e.gameTime)} ${e.stage}${e.labels && e.labels.indexOf('contested') >= 0 ? ' ⚔' : ''}</span>`
      ).join('');

      return `<div class="cdp-player" data-pid="${pid}">
        <div class="cdp-prow">
          <span class="cdp-swatch" style="background:${teamColor}"></span>
          <span class="cdp-pname">${this._playerName(pid)}</span>
          <span class="cdp-status cdp-${statusCls}" data-live-status>${statusTxt}</span>
          ${uncertain}
        </div>
        <ul class="cdp-crits" data-live-crit>${crit}</ul>
        <div class="cdp-measure" data-live-measure>
          effective <b>${(m.effectiveMs / 1000).toFixed(1)}s</b> / ${(m.requiredMs / 1000).toFixed(1)}s
          · in-camp ${(m.inCampMs / 1000).toFixed(1)}s · pull ${(m.pullMs / 1000).toFixed(1)}s
          · interactions ${m.interactionCount} · items ${m.itemInteractions} · share ${Math.round((m.share || 0) * 100)}%
        </div>
        ${why}${reasons}
        <div class="cdp-evidence">${ev}</div>
      </div>`;
    }).join('');

    const ovOpts = [`<option value="">— set manual outcome —</option>`]
      .concat(pids.map(pid => `<option value="${pid}">Credit ${this._playerName(pid)}</option>`))
      .concat([`<option value="none">No one (no credit)</option>`,
               `<option value="unclear">Unclear / disputed</option>`]).join('');

    const overrideUi = `<div class="cdp-override">
      <label>Override engine call:
        <select class="cdp-ov-select">${ovOpts}</select>
      </label>
      <div class="cdp-ov-hint">Saved to this browser for this replay. Never changes the parsed data.</div>
    </div>`;

    return head + rows + overrideUi;
  }

  _ovLabel (ov, g) {
    if (!ov) return '';
    if (ov.creditedPlayerId === 'none') return 'no credit';
    if (ov.creditedPlayerId === 'unclear') return 'unclear / disputed';
    return this._playerName(ov.creditedPlayerId);
  }

  _wireOverrideControls (g) {
    const sel = this.panel.querySelector('.cdp-ov-select');
    if (sel) {
      sel.addEventListener('change', () => {
        const v = sel.value;
        if (!v) return;
        this.setOverride(g.uuid, { creditedPlayerId: v, ts: Date.now() });
        this.render();
      });
    }
    const clr = this.panel.querySelector('.cdp-ov-clear');
    if (clr) {
      clr.addEventListener('click', () => { this.setOverride(g.uuid, null); this.render(); });
    }
  }

  // ---- live sync -------------------------------------------------------

  update (gameTime) {
    if (this.panel.hidden || this.openTab !== 'credit') return;
    if (this._isNonOneVsOne()) return;
    if (this._lastSyncTime >= 0 && Math.abs(gameTime - this._lastSyncTime) < 250) return;
    const g = this._group(this.openUuid);
    if (!g) return;
    this._applyLiveState(g, gameTime);
  }

  _applyLiveState (g, gameTime) {
    this._lastSyncTime = gameTime;
    const snap = this._snapAt(g, gameTime);
    const ov = this.getOverride(g.uuid);

    this.panel.querySelectorAll('.cdp-player').forEach(row => {
      const pid = row.getAttribute('data-pid');
      const sp = snap && snap.players ? snap.players[pid] : null;
      const finalP = (g.playerCredit && g.playerCredit[pid]) || {};

      const statusEl = row.querySelector('[data-live-status]');
      const overridden = ov && String(ov.creditedPlayerId) === String(pid);
      const deniedByOv = ov && ov.creditedPlayerId != null &&
        ov.creditedPlayerId !== 'unclear' && String(ov.creditedPlayerId) !== String(pid);
      const liveCredited = sp ? sp.credited : false;

      if (statusEl) {
        if (overridden) { statusEl.textContent = 'CREDITED (manual)'; statusEl.className = 'cdp-status cdp-ov'; }
        else if (deniedByOv) { statusEl.textContent = 'not credited (manual)'; statusEl.className = 'cdp-status cdp-no'; }
        else if (liveCredited) { statusEl.textContent = 'CREDITED'; statusEl.className = 'cdp-status cdp-yes'; }
        else { statusEl.textContent = 'not credited'; statusEl.className = 'cdp-status cdp-no'; }
      }

      const meas = row.querySelector('[data-live-measure]');
      if (meas && sp) {
        meas.innerHTML =
          `effective <b>${(sp.effectiveMs / 1000).toFixed(1)}s</b> / ${(sp.requiredMs / 1000).toFixed(1)}s` +
          ` · in-camp ${(sp.inCampMs / 1000).toFixed(1)}s · pull ${(sp.pullMs / 1000).toFixed(1)}s` +
          ` · interactions ${sp.interactionCount}` +
          ` · <span class="cdp-final">final: ${finalP.credited ? 'credited' : 'not credited'}</span>`;
      }
      row.classList.toggle('cdp-live-credited', !!liveCredited);
    });
  }
};

window.CampPanel = CampPanel;
