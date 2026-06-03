//
// CampPanel — click-driven neutral creep-camp UI (Project C).
//
// One clickable icon per camp opens a detail panel that lands on the Credit
// tab; the panel itself still exposes both tabs:
//   • Credit    : per-player credit verdict + criteria checklist + confidence,
//                 honest "uncertain / why" labelling, and (behind an Advanced
//                 Settings toggle) a durable per-camp manual override.
//   • Camp Info : the camp's creep roster (with icons) + potential drops.
//
// This is the ONLY camp UI — the old hover popup (GameDisplayBox) is removed.
// Coordinator pattern: constructed by Wc3vViewer, hangs off window. Never
// mutates parsed .wc3v data — overrides are shadow data in localStorage.
//

// Representative icons for WC3 random item drops (Y{class}I{level}).
const CAMP_RANDOM_ITEM_ICONS = {
  'YkI1': 'phea', 'YkI2': 'pman', 'YkI3': 'rej3', 'YkI4': 'shas', 'YkI5': 'pinv', 'YkI6': 'ankh',
  'YjI1': 'rde1', 'YjI2': 'rst1', 'YjI3': 'rlif', 'YjI4': 'ofir', 'YjI5': 'ckng', 'YjI6': 'modt',
  'YiI1': 'phea', 'YiI2': 'rde1', 'YiI3': 'rej3', 'YiI4': 'ofir', 'YiI5': 'ckng', 'YiI6': 'modt',
  'YoI1': 'tpow', 'YoI2': 'tpow', 'YoI3': 'tpow'
};

const CampPanel = class {
  constructor (viewer) {
    this.viewer = viewer;
    this.teamColorMap = (viewer && viewer.teamColorMap) || {};
    this.neutralGroups = null;
    this.replayId = (viewer && viewer.replayId) || 'default';

    this.openUuid = null;
    this.openTab = 'credit';
    this._lastSyncTime = -1;
    this._advOpen = false;   // Advanced Settings <details> open state (kept across re-renders)
    this._uncertainOpen = false;   // uncertainty banner <details> open state
    this._iconEls = {};   // uuid -> { wrap, info, timeline }

    this.iconLayer = document.getElementById('camp-icon-layer');
    this.panel = document.getElementById('camp-detail-panel');
    const canvasGroup = document.getElementById('canvas-group');
    if (!this.iconLayer) {
      this.iconLayer = document.createElement('div');
      this.iconLayer.id = 'camp-icon-layer';
      (canvasGroup || document.body).appendChild(this.iconLayer);
    } else if (canvasGroup && this.iconLayer.parentNode !== canvasGroup) {
      canvasGroup.appendChild(this.iconLayer);
    }
    if (!this.panel) {
      this.panel = document.createElement('div');
      this.panel.id = 'camp-detail-panel';
      this.panel.setAttribute('role', 'dialog');
      this.panel.hidden = true;
      ((canvasGroup && canvasGroup.parentNode) || document.body).appendChild(this.panel);
    }

    // map-corner key explaining the segmented camp rings. Placement is
    // owned by BottomPanel (which adopts this element into the "Camp Key"
    // tab in app.js). Previously CampPanel reparented the legend itself,
    // which yanked it back OUT of the tab once BottomPanel had adopted it
    // — producing both an empty tab AND a duplicate legend rendered as a
    // sibling under the panel. So we only place it if it doesn't already
    // exist; placement after that is BottomPanel's job.
    this.legend = document.getElementById('camp-legend');
    if (!this.legend) {
      this.legend = document.createElement('div');
      this.legend.id = 'camp-legend';
      this.legend.hidden = true;
      ((canvasGroup && canvasGroup.parentNode) || document.body).appendChild(this.legend);
    }
    this._buildLegend();

    // Named handlers so destroy() can remove them — a fresh CampPanel is
    // constructed on every replay load (app.js setupDrawing), so anonymous
    // document listeners would accumulate one pair per reload.
    this._onKeydown = (e) => {
      if (e.key === 'Escape' && !this.panel.hidden) this.close();
    };
    this._onMousedown = (e) => {
      if (this.panel.hidden) return;
      if (this.panel.contains(e.target)) return;
      if (e.target.closest && e.target.closest('.camp-icon-btn')) return;
      this.close();
    };
    document.addEventListener('keydown', this._onKeydown);
    document.addEventListener('mousedown', this._onMousedown);
  }

  // Tear down everything this instance owns: the self-perpetuating rAF loop,
  // the two document listeners, and the per-camp icon wraps it appended. The
  // shared #camp-icon-layer / #camp-detail-panel / #camp-legend are reused by
  // id across instances, so they are intentionally left in place.
  destroy () {
    this._ownLoopRunning = false;   // tick() early-returns on the next frame
    if (this._onKeydown) document.removeEventListener('keydown', this._onKeydown);
    if (this._onMousedown) document.removeEventListener('mousedown', this._onMousedown);
    Object.values(this._iconEls || {}).forEach((els) => {
      if (els && els.wrap && els.wrap.parentNode) els.wrap.parentNode.removeChild(els.wrap);
    });
    this._iconEls = {};
    this.neutralGroups = null;
    if (this.panel) this.panel.hidden = true;
  }

  // Map-corner key for the segmented progress rings — same visual language
  // the rings use, so a dashed ring etc. is explained without clicking a camp.
  _buildLegend () {
    if (!this.legend) return;
    const G = 'viewBox="0 0 24 24" class="cl-g" aria-hidden="true"';
    const ring = (extra) => `<circle cx="12" cy="12" r="8" fill="none" stroke-width="3.4" ${extra}/>`;
    // clearing — two team-coloured segments over a faint track (colour = team)
    const gClearing = `<svg ${G}>${ring('stroke="#2f3a4a"')}` +
      `<circle cx="12" cy="12" r="8" fill="none" stroke-width="3.4" stroke="#5b8cff" ` +
      `stroke-dasharray="22 100" transform="rotate(-90 12 12)"/>` +
      `<circle cx="12" cy="12" r="8" fill="none" stroke-width="3.4" stroke="#e0697a" ` +
      `stroke-dasharray="11 100" stroke-dashoffset="-22" transform="rotate(-90 12 12)"/></svg>`;
    const gCleared = `<svg ${G}>${ring('stroke="#cfd6e0"')}` +
      `<circle cx="12" cy="12" r="3.1" fill="#cfd6e0"/></svg>`;
    const gSolid = `<svg ${G}>${ring('stroke="#cfd6e0"')}</svg>`;
    const gDashed = `<svg ${G}>${ring('stroke="#cfd6e0" stroke-dasharray="5 4"')}</svg>`;

    // Plain list: BottomPanel's "Camp Key" tab IS the disclosure now, so
    // the legacy <details>/<summary> wrapper would duplicate that chrome
    // inside the tab body. Drop it entirely.
    const row = (glyph, text) => `<li class="cl-row">${glyph}<span>${text}</span></li>`;
    this.legend.innerHTML =
      `<ul class="cl-rows">` +
        row(gClearing, 'fills as the camp is cleared <i>(each colour = a team share)</i>') +
        row(gCleared, 'centre dot, camp fully cleared') +
        row(gSolid, 'solid ring, confident verdict') +
        row(gDashed, 'dashed ring, uncertain verdict') +
      `</ul>`;
  }

  setData (neutralGroups) {
    this.neutralGroups = neutralGroups || null;
    this.replayId = (this.viewer && this.viewer.replayId) || 'default';

    // Drive our own rAF loop so icon sync never depends on the main render
    // loop's lifecycle. The main loop guards syncIcons behind
    // `!this.guideMode` and exits entirely when the camera is settled +
    // game paused, both of which leave icons stale. We re-sync any frame
    // the d3 transform actually changed.
    this._startOwnLoop();
    // Stamp persisted overrides onto the group objects so the map markers
    // honour them too (the renderer reads g._creditOverride). Shadow data —
    // never serialized back into the parsed replay.
    if (this.neutralGroups) {
      Object.values(this.neutralGroups).forEach(g => {
        if (g && g.uuid) g._creditOverride = this.getOverride(g.uuid);
      });
    }
    // The ring key is 1v1-only (segments / dashed verdicts are 1v1 features)
    // and pointless on creep-less maps. Visibility is now controlled by
    // showing/hiding the entire "Camp Key" TAB in BottomPanel; do NOT touch
    // the legend's own `hidden` attribute — when the legend is inside a tab,
    // its hidden state is owned by the tab activation system, and bypassing
    // it makes the legend leak through under whichever tab is currently
    // active.
    const hasCamps = !!(this.neutralGroups && Object.keys(this.neutralGroups).length);
    const showLegendTab = hasCamps && !this._isNonOneVsOne();
    if (this.viewer && this.viewer.bottomPanel && typeof this.viewer.bottomPanel.setTabVisible === 'function') {
      this.viewer.bottomPanel.setTabVisible('camps', showLegendTab);
    } else if (this.legend) {
      // Legacy fallback when BottomPanel isn't present.
      this.legend.hidden = !showLegendTab;
    }
  }

  _isNonOneVsOne () {
    return !!(window.wc3v && typeof window.wc3v.isNonOneVsOne === 'function'
      && window.wc3v.isNonOneVsOne());
  }

  // Independent rAF loop — runs every frame, but only invokes syncIcons
  // when the viewer's d3 transform has actually changed since last tick
  // (so no work in the steady state). This decouples icon updates from
  // the main render loop, which has multiple early-exit paths (guideMode,
  // paused+settled, layoutMode) that left icons stale.
  _startOwnLoop () {
    if (this._ownLoopRunning) return;
    this._ownLoopRunning = true;
    const tick = () => {
      if (!this._ownLoopRunning) return;
      try {
        const v = this.viewer;
        const t = v && v.transform;
        if (t && this.neutralGroups) {
          const sig = `${t.k}|${t.x}|${t.y}`;
          if (sig !== this._lastTickSig) {
            this._lastTickSig = sig;
            // Split-screen path drives its own sideFilter calls per half —
            // skip the wholesale sync so we don't fight it.
            const bc = v && v.broadcastCamera;
            if (!bc || !bc.isSplitActive) {
              this.syncIcons(null);
            }
          }
        }
      } catch (e) {
        if (window.console) console.warn('[CampPanel] own-loop tick failed', e);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
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
    // keep the group's shadow copy in sync so the map markers update at once
    const g = this._group(uuid);
    if (g) g._creditOverride = value || null;
  }

  // ---- on-screen icons -------------------------------------------------

  // Position one HTML icon per touched camp via gameScaler.projectToCssPixels
  // — the same 3D-camera projection the ring uses (so icon and ring move
  // together under any camera mode: AUTO, SPLIT, P1, P2, FREE).
  //
  // sideFilter is null for the normal render path, or
  //   { side: 'left'|'right', diagTopX, diagBotX, canvasH }
  // for the split-screen path, in which case the panel hides any camp whose
  // projected centre lies on the wrong half of the diagonal clip.
  //
  // Off-screen camps are hidden entirely — no edge-pinning, no clamping. The
  // old clamp produced phantom icons stuck to the canvas edge whenever the
  // 3D projection (frustum-aware now, see ThreeMapRenderer.projectToCanvas)
  // returned a near-edge pixel for a camp that wasn't really visible.
  syncIcons (sideFilter) {
    if (!this.iconLayer) return;
    if (!this.neutralGroups) return;
    const canvas = document.getElementById('main-canvas');
    if (!canvas || !canvas.width) return;
    const gs = this.viewer && this.viewer.gameScaler;
    if (!gs) return;
    const cssW = canvas.clientWidth || canvas.width;
    const cssH = canvas.clientHeight || canvas.height;

    const ICON_W = 24, ICON_H = 24;
    const ICON_GAP = 6;
    const RING_PAD = 4;
    const seen = sideFilter ? (this._sideSeen || (this._sideSeen = {})) : {};
    if (!sideFilter) this._sideSeen = null;

    Object.values(this.neutralGroups).forEach(g => {
      if (!g || !g.uuid) return;
      const hasEvents = g.perPlayerEvents && g.perPlayerEvents.length;
      const touched = (g.claimState && g.claimState !== 0) || hasEvents;
      if (!touched) return;
      // In split mode the same panel is called twice per frame (once per
      // half). Skip groups already placed by the other half's call.
      if (sideFilter && seen[g.uuid]) return;

      const b = g.unitBounds || g.bounds;
      if (!b) return;

      const wCenterX = (b.minX + b.maxX) / 2;
      const wCenterY = (b.minY + b.maxY) / 2;

      // Require every bbox corner to project inside the frustum — same rule
      // MapRenderer.renderNeutralGroups uses to draw the ring. Without this
      // check, a distant camp whose centre lands at the horizon (NDC≈[0,
      // 0.95]) is "on-canvas" but visually a meaningless dot — the old bug
      // where icons appeared everywhere in P1/P2 focus.
      const ex = this._iconEls[g.uuid];
      const k1 = gs.projectToCssPixels(b.minX, b.minY, canvas);
      const k2 = gs.projectToCssPixels(b.maxX, b.minY, canvas);
      const k3 = gs.projectToCssPixels(b.minX, b.maxY, canvas);
      const k4 = gs.projectToCssPixels(b.maxX, b.maxY, canvas);
      if (!k1.valid || !k2.valid || !k3.valid || !k4.valid) {
        if (ex) ex.wrap.style.display = 'none';
        return;
      }

      const c = gs.projectToCssPixels(wCenterX, wCenterY, canvas);
      if (!c.valid || !c.onScreen) {
        if (ex) ex.wrap.style.display = 'none';
        return;
      }

      if (sideFilter) {
        const bx = sideFilter.diagTopX +
          (sideFilter.diagBotX - sideFilter.diagTopX) *
          (sideFilter.canvasH ? (c.cssY / sideFilter.canvasH) : 0);
        const isLeft = c.cssX <= bx;
        if ((sideFilter.side === 'left' && !isLeft) ||
            (sideFilter.side === 'right' && isLeft)) {
          if (ex) ex.wrap.style.display = 'none';
          return;
        }
      }

      // Ring radius in CSS pixels — use the SAME screen-space AABB of the 4
      // projected corners that MapRenderer.renderNeutralGroups uses, so the
      // icon always hugs the ring exactly regardless of perspective distortion.
      const minPX = Math.min(k1.cssX, k2.cssX, k3.cssX, k4.cssX);
      const maxPX = Math.max(k1.cssX, k2.cssX, k3.cssX, k4.cssX);
      const minPY = Math.min(k1.cssY, k2.cssY, k3.cssY, k4.cssY);
      const maxPY = Math.max(k1.cssY, k2.cssY, k3.cssY, k4.cssY);
      const ringR = Math.max(maxPX - minPX, maxPY - minPY) / 2 + RING_PAD;
      // Skip degenerate camps — too small to be visually meaningful and the
      // icon would land in a misleading spot.
      if (ringR < 8) {
        if (ex) ex.wrap.style.display = 'none';
        return;
      }

      let x = c.cssX + ringR + ICON_GAP;
      const y = c.cssY - ringR;
      if (x + ICON_W > cssW - 2) {
        x = c.cssX - ringR - ICON_GAP - ICON_W;
      }
      if (x < 2 || x + ICON_W > cssW - 2 || y < 2 || y + ICON_H > cssH - 2) {
        if (ex) ex.wrap.style.display = 'none';
        return;
      }

      seen[g.uuid] = true;
      let els = ex;
      if (!els) {
        els = this._makeIconPair(g.uuid);
        this._iconEls[g.uuid] = els;
      }
      els.wrap.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      els.wrap.style.display = '';
    });

    if (!sideFilter) {
      Object.keys(this._iconEls).forEach(uuid => {
        if (!seen[uuid]) this._iconEls[uuid].wrap.style.display = 'none';
      });
    }
  }

  // Split-screen caller invokes syncIcons twice (once per half). After the
  // second call, hide any icons that neither half claimed.
  syncIconsSplitFinish () {
    const seen = this._sideSeen || {};
    Object.keys(this._iconEls).forEach(uuid => {
      if (!seen[uuid]) this._iconEls[uuid].wrap.style.display = 'none';
    });
    this._sideSeen = null;
  }

  _makeIconPair (uuid) {
    const wrap = document.createElement('div');
    wrap.className = 'camp-icon-wrap';

    const timeline = document.createElement('button');
    timeline.type = 'button';
    timeline.className = 'camp-icon-btn camp-icon-timeline';
    timeline.title = 'Creep camp details';
    timeline.setAttribute('aria-label', 'Show creep-camp credit and info');
    timeline.textContent = '⚔';
    timeline.addEventListener('click', (e) => { e.stopPropagation(); this.open(uuid, 'credit'); });

    wrap.appendChild(timeline);
    this.iconLayer.appendChild(wrap);
    return { wrap, timeline };
  }

  _group (uuid) {
    if (!this.neutralGroups) return null;
    return this.neutralGroups[uuid] ||
      Object.values(this.neutralGroups).find(g => g.uuid === uuid) || null;
  }

  // ---- helpers ---------------------------------------------------------

  _fmt (gt) {
    return (typeof formatGameTime === 'function') ? formatGameTime(gt)
      : `${Math.floor(gt / 60000)}:${String(Math.floor((gt % 60000) / 1000)).padStart(2, '0')}`;
  }

  // HTML-escape — replay-derived strings (player names especially) are
  // attacker-controlled and the panel is built via innerHTML.
  _esc (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Returns the player's display name, already HTML-escaped (it is only ever
  // interpolated into innerHTML in this panel).
  _playerName (pid) {
    let nm = null;
    const p = this.viewer && this.viewer.players &&
      this.viewer.players.find(pl => String(pl.playerId) === String(pid));
    if (p) nm = p.displayName || p.name || p.playerName;
    if (!nm) {
      const rp = this.viewer && this.viewer.mapData && this.viewer.mapData.replay &&
        this.viewer.mapData.replay.players && this.viewer.mapData.replay.players[pid];
      if (rp) nm = rp.name;
    }
    if (nm && typeof PlayerNames !== 'undefined' && PlayerNames.canonical) {
      nm = PlayerNames.canonical(nm);
    }
    return this._esc(nm || `Player ${pid}`);
  }

  static _titleCase (s) { return String(s).replace(/\b\w/g, c => c.toUpperCase()); }
  static _levelClass (lvl) { return lvl <= 5 ? 'easy' : (lvl <= 8 ? 'medium' : 'hard'); }
  static _levelColor (lvl) { return lvl <= 5 ? '#00c850' : (lvl <= 8 ? '#ff8c00' : '#e02020'); }
  static _difficultyClass (total) { return total <= 9 ? 'green' : (total <= 19 ? 'yellow' : 'red'); }

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

  // WC3 hero XP to advance from level L to L+1 = 100·(L+1). Heroes cap at 10.
  _xpToNext (level) {
    return (level >= 10) ? 0 : 100 * (level + 1);
  }

  //
  // Hero progression for one player at this camp — XP-calculation evidence.
  // Uses the parser's authoritative HeroLevel events (exact level transitions
  // + the skill learned) and links heroes to the camp via focusUnitUuid. The
  // level numbers and skill-learns are EXACT; the XP figure is the labelled
  // estimate. If a hero leveled during/just after the camp, that level-up is
  // shown as concrete evidence the camp's XP mattered.
  //
  _heroProgressHtml (g, pid, m) {
    const md = this.viewer && this.viewer.mapData;
    const pdata = md && md.players && md.players[pid];
    if (!pdata || !pdata.eventStream) return '';

    const levelEvents = pdata.eventStream
      .filter(e => e.key === 'HeroLevel' && e.unit && e.unit.isHero && e.unit.uuid)
      .sort((a, b) => a.gameTime - b.gameTime);
    if (!levelEvents.length) return '';

    const cleared = g.clearedTime;
    const winStart = (m.windowStart != null) ? m.windowStart : (cleared != null ? cleared : 0);
    const winEnd = (cleared != null ? cleared : winStart) + 15000;  // "during or just after"

    // Heroes that were ACTUALLY at the camp during the CREDITING period:
    // a pre-clear event (gameTime <= clearedTime), genuinely engaged
    // (zone in-camp / creep-pull, not just passing). Post-clear walk-throughs
    // do NOT link a hero to this camp — that was the bug where a hero
    // spawned long after still showed up here.
    const campHero = {};
    (g.perPlayerEvents || []).forEach(e => {
      if (String(e.playerId) !== String(pid)) return;
      if (!e.focusUnitUuid) return;
      if (cleared != null && e.gameTime > cleared) return;          // pre-clear only
      if (e.zone !== 'in-camp' && e.zone !== 'creep-pull') return;  // actually at the camp
      campHero[e.focusUnitUuid] = true;
    });

    const byHero = {};
    levelEvents.forEach(e => {
      const u = e.unit.uuid;
      (byHero[u] = byHero[u] || { uuid: u, itemId: e.unit.itemId, name: e.unit.displayName, evs: [] })
        .evs.push(e);
    });

    // only heroes that were verifiably at the camp during the clear.
    const heroes = Object.values(byHero).filter(h => campHero[h.uuid]);
    if (!heroes.length) return '';

    const campXp = m.estimatedXp || 0;

    // which heroes used this camp's fountain (in its heal aura at any point)
    const fountainHero = {};
    (g.perPlayerEvents || []).forEach(e => {
      if (String(e.playerId) === String(pid) && e.nearFountain && e.focusUnitUuid) {
        fountainHero[e.focusUnitUuid] = true;
      }
    });

    const rows = heroes.map(h => {
      const before = h.evs.filter(e => e.gameTime <= winStart).pop();
      const lvlBefore = before ? before.newLevel : 1;
      const afterEv = h.evs.filter(e => e.gameTime <= winEnd).pop();
      const lvlAfter = afterEv ? afterEv.newLevel : lvlBefore;
      const inCamp = h.evs.filter(e => e.gameTime > winStart && e.gameTime <= winEnd);
      const usedFountain = !!fountainHero[h.uuid];

      const levels = (lvlAfter > lvlBefore)
        ? `<span class="cdp-hp-from">Lv ${lvlBefore}</span>` +
          `<span class="cdp-hp-arrow">▶</span>` +
          `<span class="cdp-hp-to">Lv ${lvlAfter}</span>`
        : `<span class="cdp-hp-flat">Lv ${lvlBefore}</span>`;

      const need = this._xpToNext(lvlBefore);
      let xpLine;
      if (need > 0) {
        const pct = Math.min(100, Math.round((campXp / need) * 100));
        xpLine = `<div class="cdp-hp-bar"><div class="cdp-hp-fill" style="width:${pct}%"></div></div>
          <div class="cdp-hp-xptext">this camp ≈ <b>${campXp}</b> XP of the ~${need} for Lv ${lvlBefore + 1}</div>`;
      } else {
        xpLine = `<div class="cdp-hp-xptext">this camp ≈ <b>${campXp}</b> XP · hero at max level</div>`;
      }

      const skills = inCamp.map(e =>
        `<div class="cdp-hp-skill">⬆ reached <b>Lv ${e.newLevel}</b> — learned ` +
        `<b>${this._esc((e.spell && e.spell.displayName) || 'a skill')}</b> at ${this._fmt(e.gameTime)}</div>`
      ).join('');

      const fountain = usedFountain
        ? `<span class="cdp-hp-fountain" title="This hero healed at the camp's Fountain of Health/Mana">⛲ used fountain</span>`
        : '';

      return `<div class="cdp-hp-hero">
        <div class="cdp-hp-head">
          <img class="cdp-hp-icon${usedFountain ? ' cdp-hp-icon-fountain' : ''}" src="/assets/wc3icons/${encodeURIComponent(h.itemId || '')}.jpg" onerror="this.style.display='none'" alt="" />
          <span class="cdp-hp-name">${this._esc(h.name)}</span>
          ${fountain}
          <span class="cdp-hp-levels">${levels}</span>
        </div>
        ${xpLine}
        ${skills}
      </div>`;
    }).join('');

    return `<div class="cdp-section-label">Hero XP from this camp</div>
      <div class="cdp-hp">${rows}</div>`;
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
        Per-player creep credit is available for 1v1 replays only.
        See the <b>Camp Info</b> tab for this camp's creeps and drops.
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

  // ---- Camp Info tab (ported from the old hover popup) -----------------

  _campHeader (g) {
    const diff = CampPanel._difficultyClass(g.totalLevel);
    return `<div class="camp-popup-header">
      <h3>Creep Camp</h3>
      <div class="camp-level-badge ${diff}">${g.totalLevel}</div>
    </div>`;
  }

  _creepListHtml (units) {
    const sorted = (units || []).slice().sort((a, b) =>
      ((b.balanceInfo && b.balanceInfo.level) || 0) - ((a.balanceInfo && a.balanceInfo.level) || 0));
    const visible = sorted.slice(0, 6);
    const hidden = sorted.length - visible.length;

    const rows = visible.map(u => {
      const level = (u.balanceInfo && u.balanceInfo.level) || '?';
      const name = this._esc(CampPanel._titleCase(u.displayName || u.itemId || 'Unknown'));
      const lc = CampPanel._levelClass(+level || 0);
      const col = CampPanel._levelColor(+level || 0);
      const itemId = encodeURIComponent(u.itemId || '');
      const hasDrops = u.droppedItemSets && u.droppedItemSets.length > 0;
      const dropDot = hasDrops ? '<span class="camp-drop-indicator" title="Drops an item">&#9679;</span>' : '';
      return `<li class="camp-creep-row${hasDrops ? ' camp-creep-has-drops' : ''}">
        <span class="camp-creep-name-wrap">
          <img class="camp-creep-icon" src="/assets/wc3icons/${itemId}.jpg" onerror="this.style.display='none'" alt="" />
          <span class="camp-creep-name">${name}</span>
        </span>
        <span class="camp-creep-level ${lc}" style="border-left:3px solid ${col}">Lv ${level}${dropDot}</span>
      </li>`;
    }).join('');
    const more = hidden > 0 ? `<li class="camp-creep-more">+${hidden} more</li>` : '';
    return `<ul class="camp-creep-list">${rows}${more}</ul>`;
  }

  _dropTableHtml (units) {
    const dropMap = {};
    (units || []).forEach(u => (u.droppedItemSets || []).forEach(d => {
      if (!d.itemId) return;
      if (!dropMap[d.itemId] || d.chance > dropMap[d.itemId].chance) dropMap[d.itemId] = d;
    }));
    const drops = Object.values(dropMap);
    if (!drops.length) return '';

    const icons = drops.slice(0, 8).map(d => {
      const chanceNum = Number(d.chance) || 0;
      const chance = chanceNum < 100 ? `<span class="camp-drop-chance">${chanceNum}%</span>` : '';
      const title = this._esc(`${d.displayName}${chanceNum < 100 ? ` (${chanceNum}%)` : ''}`);
      if (d.isRandom) {
        const ic = CAMP_RANDOM_ITEM_ICONS[d.itemId];
        return `<div class="camp-drop-icon-wrap camp-drop-random-wrap" title="${title}">
          ${ic ? `<img class="camp-drop-icon camp-drop-random-icon" src="/assets/wc3icons/${encodeURIComponent(ic)}.jpg" onerror="this.style.display='none'" alt="" />` : ''}
          <div class="camp-drop-random-label">${this._esc(String(d.displayName).replace('Random ', ''))}</div>
          ${chance}
        </div>`;
      }
      return `<div class="camp-drop-icon-wrap" title="${title}">
        <img class="camp-drop-icon" src="/assets/wc3icons/${encodeURIComponent(d.itemId)}.jpg" onerror="this.parentElement.style.display='none'" alt="" />
        ${chance}
      </div>`;
    }).join('');
    const more = drops.length > 8 ? `<span class="camp-drop-more">+${drops.length - 8}</span>` : '';
    return `<div class="camp-drop-table">
      <span class="camp-drop-label">Potential Drops</span>
      <div class="camp-drop-list">${icons}${more}</div>
    </div>`;
  }

  _infoHtml (g) {
    return this._campHeader(g) +
      this._creepListHtml(g.units) +
      this._dropTableHtml(g.units);
  }

  // ---- Credit tab ------------------------------------------------------

  _creditHtml (g) {
    const pc = g.playerCredit || {};
    const pids = Object.keys(pc);
    const ov = this.getOverride(g.uuid);
    const diff = CampPanel._difficultyClass(g.totalLevel);
    const clearedStr = (g.clearedTime != null) ? this._fmt(g.clearedTime) : null;

    let head = `<div class="cdp-head">
      <div class="camp-level-badge ${diff}">${g.totalLevel}</div>
      <div class="cdp-head-text">
        <h3>Creep Camp Credit</h3>
        <div class="cdp-sub">${clearedStr
          ? `Cleared at <b>${clearedStr}</b> — only work done before then earns credit.`
          : `This camp was never fully cleared.`}</div>
      </div>
    </div>`;

    if (ov) {
      head += `<div class="cdp-override-badge">Manually set: <b>${this._ovLabel(ov)}</b>
        <button type="button" class="cdp-ov-clear">reset</button></div>`;
    }

    // camp-level uncertainty banner — echoes the dashed ring on the map. A
    // manual override resolves the doubt, so it is suppressed when one is set.
    const campUncertain = !ov && pids.some(pid => pc[pid] && pc[pid].uncertain);
    if (campUncertain) {
      const reasons = [];
      pids.forEach(pid => (pc[pid].confidenceReasons || []).forEach(r => {
        if (reasons.indexOf(r) === -1) reasons.push(r);
      }));
      const why = reasons.length ? this._esc(reasons[0])
        : 'the events here are sparse or contested';
      head += `<details class="cdp-uncertain-banner"${this._uncertainOpen ? ' open' : ''}>
        <summary class="cdp-uncertain-sum">
          <span class="cdp-uncertain-ico" aria-hidden="true">!</span>
          <span class="cdp-uncertain-h">Uncertain verdict</span>
        </summary>
        <div class="cdp-uncertain-w">The engine isn’t fully confident here — ${why}. ` +
        `This camp shows a <b>dashed ring</b> on the map.</div>
      </details>`;
    }

    if (!pids.length) {
      return head + `<div class="cdp-empty">No player interacted with this camp.</div>`;
    }

    // the sequence — chronological event log, the context for the verdicts
    const log = this._eventLogHtml(g);

    // Only show players who actually did clearing work (credited or partial).
    // Pure non-contributors (walked past, never engaged) are not listed.
    const ranked = pids.filter(pid => ((pc[pid].measured || {}).contributionMs || 0) > 0)
      .sort((a, b) => {
        const A = pc[a], B = pc[b];
        if (!!A.credited !== !!B.credited) return A.credited ? -1 : 1;
        return ((B.measured || {}).contributionShare || 0) -
               ((A.measured || {}).contributionShare || 0);
      });

    // Effective winner — a manual override takes precedence over the engine.
    // An 'none'/'unclear' override crowns nobody.
    const ovPid = (ov && ov.creditedPlayerId != null &&
      ov.creditedPlayerId !== 'none' && ov.creditedPlayerId !== 'unclear')
      ? String(ov.creditedPlayerId) : null;
    const winnerPid = ovPid
      ? ovPid
      : (ov ? null : (ranked.find(pid => pc[pid].credited) || null));
    // an override can credit someone who did no measured work — still card them
    if (winnerPid && ranked.indexOf(winnerPid) === -1 && pc[winnerPid]) {
      ranked.unshift(winnerPid);
    }

    if (!ranked.length) {
      return head + log + `<div class="cdp-empty">No player did any clearing work at this camp.</div>`;
    }

    const rows = ranked.map(pid => {
      const p = pc[pid];
      const m = p.measured || {};
      const teamColor = this.teamColorMap[p.teamId] || '#888';
      const isWinner = (pid === winnerPid);
      const conf = Math.round((p.confidence || 0) * 100);
      const confBadge = p.uncertain
        ? `<span class="cdp-conf cdp-conf-low" title="${this._esc((p.confidenceReasons || []).join('; '))}">uncertain · ${conf}%</span>`
        : `<span class="cdp-conf" title="engine confidence">${conf}%</span>`;

      const share = Math.round((m.contributionShare || 0) * 100);
      const win = (m.windowStart != null && m.windowEnd != null)
        ? `${this._fmt(m.windowStart)}–${this._fmt(m.windowEnd)}` : '—';

      // structured stat grid — clear HEADER label on top, big value below
      const stats = `<div class="cdp-stats">
        <div class="cdp-stat" title="How much of this camp's clearing this player did">
          <div class="cdp-stat-cap">Cleared</div>
          <div class="cdp-stat-val">${share}%</div>
        </div>
        <div class="cdp-stat" title="Estimated hero XP earned from this camp">
          <div class="cdp-stat-cap">Hero XP</div>
          <div class="cdp-stat-val cdp-stat-xp">≈${m.estimatedXp || 0}</div>
        </div>
        <div class="cdp-stat" title="When this player was fighting the camp">
          <div class="cdp-stat-cap">Engaged</div>
          <div class="cdp-stat-val cdp-stat-time">${win}</div>
        </div>
      </div>`;

      const crit = (p.criteria || []).map(c => {
        return `<li class="cdp-crit ${c.pass ? 'cdp-crit-pass' : 'cdp-crit-fail'}">
          <span class="cdp-box">${c.pass ? '✓' : '✗'}</span>
          <span class="cdp-crit-label">${c.label}</span>
          <span class="cdp-crit-val">${c.measured}${c.unit || ''}<span class="cdp-crit-req"> / ${c.required}${c.unit || ''}</span></span>
        </li>`;
      }).join('');

      // engine "why not" — hidden once a manual override is in force (the
      // override IS the verdict; the engine's reasoning would only confuse).
      const why = (!ov && !p.credited && p.whyNot)
        ? `<div class="cdp-why">${this._esc(p.whyNot)}</div>` : '';
      const crown = isWinner
        ? `<div class="cdp-crown" title="${ov ? 'Verdict set manually' : 'Did the most clearing work at this camp'}">♛ ${
            ov ? 'Credited — set manually'
               : (clearedStr ? 'Cleared this camp' : 'Top contributor')}</div>`
        : '';

      return `<div class="cdp-player${isWinner ? ' cdp-player-winner' : ''}" data-pid="${pid}">
        ${crown}
        <div class="cdp-prow">
          <span class="cdp-swatch" style="background:${teamColor}"></span>
          <span class="cdp-pname">${this._playerName(pid)}</span>
          <span class="cdp-verdict" data-live-status></span>
          ${confBadge}
        </div>
        ${stats}
        ${this._heroProgressHtml(g, pid, m)}
        <ul class="cdp-crits">${crit}</ul>
        ${why}
      </div>`;
    }).join('');

    // ---- Advanced Settings (manual override) ----------------------------
    // current override pre-selected; open state kept across re-renders
    const ovSel = ov ? String(ov.creditedPlayerId) : '';
    const opt = (val, label) =>
      `<option value="${val}"${ovSel === val ? ' selected' : ''}>${label}</option>`;
    const ovOpts = [opt('', '— choose —')]
      .concat(pids.map(pid => opt(pid, `Credit ${this._playerName(pid)}`)))
      .concat([opt('none', 'No credit (no one cleared it)'),
               opt('unclear', 'Unclear / disputed')]).join('');

    const advanced = `<details class="cdp-adv"${this._advOpen ? ' open' : ''}>
      <summary>⚙ Advanced Settings</summary>
      <div class="cdp-adv-body">
        <p class="cdp-adv-explain">
          The engine decides camp credit from the event sequence above. If you
          think it got this camp wrong, you can <b>override the verdict</b>.
          Your choice is saved in this browser for this replay only — it never
          changes the parsed replay data, and you can reset it anytime.
        </p>
        <label class="cdp-ov-label">Manual verdict
          <select class="cdp-ov-select">${ovOpts}</select>
        </label>
      </div>
    </details>`;

    return head + log +
      `<div class="cdp-section-label">Per-player credit</div>` + rows +
      advanced;
  }

  // Chronological event log — the story of how the camp got CLEARED. Only
  // pre-clear events count (post-clear wandering earns no credit). The story
  // is the FIGHTING: a phase where someone actually hit creeps is a row of its
  // own. Long runs of "moved through / pulled / contested" poking are not the
  // story — each such run collapses into one summary "skirmish" blob so the
  // log stays short and readable instead of a 25-row wall of near-noise.
  _eventLogHtml (g) {
    const cleared = g.clearedTime;
    const evs = (g.perPlayerEvents || []).slice()
      .filter(e => cleared == null || e.gameTime <= cleared)   // pre-clear only
      .sort((a, b) => a.gameTime - b.gameTime);
    const PHASE_GAP = 15000;   // a >15s gap = a separate visit

    // group consecutive same-player events into visit phases
    const pre = [];
    let cur = null;
    evs.forEach(e => {
      if (cur && cur.playerId === e.playerId && (e.gameTime - cur.end) <= PHASE_GAP) {
        cur.end = e.gameTime;
      } else {
        cur = { playerId: e.playerId, teamId: e.teamId, start: e.gameTime, end: e.gameTime,
          hits: 0, items: 0, inCamp: false, pulled: false, contested: false };
        pre.push(cur);
      }
      if (e.stage === 'interact-creep') cur.hits++;
      if (e.stage === 'interact-item') cur.items++;
      if (e.zone === 'in-camp') cur.inCamp = true;
      if (e.zone === 'creep-pull') cur.pulled = true;
      if (e.labels && e.labels.indexOf('contested') >= 0) cur.contested = true;
    });

    if (!pre.length && cleared == null) return '';

    // a fighting phase (hits > 0) is its own row; runs of non-fighting phases
    // merge into one skirmish blob.
    const items = [];
    let blob = null;
    const flushBlob = () => { if (blob) { items.push(blob); blob = null; } };
    pre.forEach(ph => {
      if (ph.hits > 0) {
        flushBlob();
        items.push({ kind: 'fight', ph });
      } else {
        if (!blob) blob = { kind: 'blob', start: ph.start, end: ph.end,
          players: {}, moves: 0, pulls: 0, contests: 0, items: 0 };
        blob.end = ph.end;
        blob.players[ph.playerId] = ph.teamId;
        blob.moves++;
        if (ph.pulled) blob.pulls++;
        if (ph.contested) blob.contests++;
        blob.items += ph.items;
      }
    });
    flushBlob();

    const span = (a, b) => a === b ? this._fmt(a) : `${this._fmt(a)}–${this._fmt(b)}`;

    const rows = items.map(it => {
      if (it.kind === 'fight') {
        const ph = it.ph;
        const color = this.teamColorMap[ph.teamId] || '#888';
        const zone = ph.inCamp ? '<span class="cdp-log-zone in-camp">in camp</span>'
          : ph.pulled ? '<span class="cdp-log-zone creep-pull">pulled</span>' : '';
        let what = `fought creeps${ph.hits > 1 ? ` · ${ph.hits} hits` : ''}`;
        if (ph.items > 0) what += ' · grabbed item';
        return `<div class="cdp-log-row" data-t="${ph.start}">
          <span class="cdp-log-time">${span(ph.start, ph.end)}</span>
          <span class="cdp-log-dot" style="background:${color}"></span>
          <span class="cdp-log-main"><b class="cdp-log-who">${this._playerName(ph.playerId)}</b> <span class="cdp-log-what">${what}</span></span>
          ${zone}
        </div>`;
      }
      // skirmish blob
      const pids = Object.keys(it.players);
      const who = pids.length === 1 ? this._playerName(pids[0])
        : (pids.length === 2 ? 'Both players' : `${pids.length} players`);
      const bits = [];
      if (it.pulls > 0) bits.push(`${it.pulls} pull${it.pulls > 1 ? 's' : ''}`);
      if (it.contests > 0) bits.push(`${it.contests} contested`);
      if (it.items > 0) bits.push('item grabbed');
      const skirmish = (it.pulls > 0 || it.contests > 0);
      const detail = bits.length ? bits.join(' · ')
        : `moved through ${it.moves}×`;
      return `<div class="cdp-log-row cdp-log-blob" data-t="${it.start}">
        <span class="cdp-log-time">${span(it.start, it.end)}</span>
        <span class="cdp-log-dot cdp-log-dot-multi"></span>
        <span class="cdp-log-main"><b class="cdp-log-who">${who}</b> <span class="cdp-log-what">${skirmish ? 'skirmishing' : 'positioning'} — ${detail}</span></span>
      </div>`;
    });

    rows.push(cleared != null
      ? `<div class="cdp-log-cleared"><span>⚑ camp cleared</span><span>${this._fmt(cleared)}</span></div>`
      : `<div class="cdp-log-cleared cdp-log-notcleared"><span>camp never fully cleared</span></div>`);

    return `<div class="cdp-section-label">How the camp was cleared</div>
      <div class="cdp-log">${rows.join('')}</div>`;
  }

  _ovLabel (ov) {
    if (!ov) return '';
    if (ov.creditedPlayerId === 'none') return 'no credit';
    if (ov.creditedPlayerId === 'unclear') return 'unclear / disputed';
    return this._playerName(ov.creditedPlayerId);
  }

  _wireOverrideControls (g) {
    const det = this.panel.querySelector('.cdp-adv');
    if (det) det.addEventListener('toggle', () => { this._advOpen = det.open; });
    const unc = this.panel.querySelector('.cdp-uncertain-banner');
    if (unc) unc.addEventListener('toggle', () => { this._uncertainOpen = unc.open; });
    const sel = this.panel.querySelector('.cdp-ov-select');
    if (sel) {
      sel.addEventListener('change', () => {
        if (!sel.value) return;
        this._advOpen = true;   // keep the panel open through the re-render
        this.setOverride(g.uuid, { creditedPlayerId: sel.value, ts: Date.now() });
        this.render();
      });
    }
    const clr = this.panel.querySelector('.cdp-ov-clear');
    if (clr) {
      clr.addEventListener('click', () => { this.setOverride(g.uuid, null); this.render(); });
    }
  }

  // ---- live sync — verdict pill flips as the replay plays --------------

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
    const pc = g.playerCredit || {};

    this.panel.querySelectorAll('.cdp-player').forEach(row => {
      const pid = row.getAttribute('data-pid');
      const sp = snap && snap.players ? snap.players[pid] : null;
      const liveCredited = sp ? sp.credited : false;
      const finalCredited = !!(pc[pid] && pc[pid].credited);

      const overridden = ov && String(ov.creditedPlayerId) === String(pid);
      const unclearOv = ov && ov.creditedPlayerId === 'unclear';
      const deniedByOv = ov && ov.creditedPlayerId != null &&
        ov.creditedPlayerId !== 'unclear' && String(ov.creditedPlayerId) !== String(pid);

      const el = row.querySelector('[data-live-status]');
      if (el) {
        let txt, cls;
        // shown players all did clearing work — non-credited here = 'partial'
        if (overridden)        { txt = 'credited'; cls = 'cdp-v-manual'; }
        else if (unclearOv)    { txt = 'unclear'; cls = 'cdp-v-manual-no'; }
        else if (deniedByOv)   { txt = 'no credit'; cls = 'cdp-v-manual-no'; }
        else if (!finalCredited) { txt = 'partial'; cls = 'cdp-v-partial'; }
        else if (liveCredited) { txt = 'credited'; cls = 'cdp-v-yes'; }
        else                   { txt = 'clearing…'; cls = 'cdp-v-pending'; }
        el.textContent = txt;
        el.className = 'cdp-verdict ' + cls;
      }
      row.classList.toggle('cdp-live-credited', !!liveCredited);
    });

    // progressive event-log highlight — rows up to the playhead are 'reached'
    this.panel.querySelectorAll('.cdp-log-row').forEach(r => {
      const t = +r.getAttribute('data-t');
      r.classList.toggle('cdp-log-reached', t <= gameTime);
    });
  }
};

window.CampPanel = CampPanel;
