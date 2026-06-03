const ChapterMarkers = class {
  constructor (viewer) {
    this.viewer = viewer;
    this.chapters = [];
    this.markerEls = [];
    this.heatmapCanvas = null;
    this.resizeObserver = null;
    this.tooltipEl = null;
  }

  seekAndPlay (gameTime) {
    this.viewer.seekToGameTime(gameTime);
    if (this.viewer.state !== ScrubStates.playing) {
      this.viewer.play();
    }
  }

  // --- Chapter Detection ---

  detectChapters (players, matchEndTime) {
    const HERO_BUILD_TIME = 55000; // 55 seconds in ms
    const chapters = [];
    const nonNeutral = players.filter(p => !p.isNeutralPlayer);

    // Collect ALL hero events across players first, to find the global first completion
    const allHeroEvents = [];

    // Track "firsts" across all players
    const EARLY_GAME_CUTOFF = 300000; // 5 minutes — only track scouts in early game
    const firstScoutByPlayer = {};
    let firstExpansionTime = Infinity;
    let firstExpansionData = null;
    let firstTier2Time = Infinity;
    let firstTier2Data = null;
    let firstTier3Time = Infinity;
    let firstTier3Data = null;

    nonNeutral.forEach((player, pIdx) => {
      const pc = player.playerColor || TeamColorList[pIdx] || '#fff';
      let hasFirstUpgrade = false;

      // Scan eventStream
      (player.eventStream || []).forEach(ev => {
        // Hero trainings — collect all
        if (ev.key === 'makeTavernHero' || (ev.key === 'addUnit' && ev.unit && ev.unit.isHero)) {
          const unit = ev.unit || ev;
          const itemId = unit.itemId || '';
          const isTraining = !!(unit.isTraining);
          // All heroes take ~55s to train (altar or tavern)
          const completeTime = ev.gameTime + HERO_BUILD_TIME;

          allHeroEvents.push({
            gameTime: ev.gameTime,
            completeTime,
            itemId,
            displayName: unit.displayName || 'Hero',
            playerIndex: pIdx,
            playerColor: pc,
            isTavern: ev.key === 'makeTavernHero'
          });
        }

        // Expansions
        if (ev.key === 'addBuilding' && ev.isExpansion) {
          if (ev.gameTime < firstExpansionTime) {
            firstExpansionTime = ev.gameTime;
            firstExpansionData = { playerIndex: pIdx, playerColor: pc, race: player.race };
          }
        }

        // Hero revives
        if (ev.key === 'heroRevive') {
          const unit = ev.unit || ev;
          const itemId = unit.itemId || '';
          const name = getShortName(itemId, unit.displayName || 'Hero');
          chapters.push({
            gameTime: ev.gameTime,
            label: `${name} Revived`,
            shortLabel: 'Revive',
            type: 'heroRevive',
            severity: 'minor',
            playerIndex: pIdx,
            playerColor: pc,
            icon: itemId
          });
        }

        // Zeppelin / transport usage
        if (ev.key === 'transportLoad') {
          chapters.push({
            gameTime: ev.gameTime,
            label: 'Zeppelin',
            shortLabel: 'Zep',
            type: 'transportLoad',
            severity: 'minor',
            playerIndex: pIdx,
            playerColor: pc,
            icon: null
          });
        }

        // First attack/defense upgrade per player
        if (ev.key === 'research' && !hasFirstUpgrade) {
          const cat = ev.category || '';
          if (cat === 'attack' || cat === 'defense') {
            hasFirstUpgrade = true;
            const label = cat === 'attack' ? 'Atk +1' : 'Def +1';
            chapters.push({
              gameTime: ev.gameTime,
              label,
              shortLabel: label,
              type: 'firstUpgrade',
              severity: 'minor',
              playerIndex: pIdx,
              playerColor: pc,
              icon: ev.icon || null
            });
          }
        }

        // First scout per player (early game only)
        if (ev.key === 'scout' && !firstScoutByPlayer[pIdx] && ev.gameTime < EARLY_GAME_CUTOFF) {
          firstScoutByPlayer[pIdx] = true;
          const label = ev.isLumberScout ? 'Wisp Scout' : 'First Scout';
          chapters.push({
            gameTime: ev.gameTime,
            label,
            shortLabel: 'Scout',
            type: 'firstScout',
            severity: 'minor',
            playerIndex: pIdx,
            playerColor: pc,
            icon: ev.unit ? ev.unit.itemId : null
          });
        }

        // Mercenary hires
        if (ev.key === 'hireMercenary') {
          const name = getShortName(
            (ev.unit && ev.unit.itemId) || '',
            (ev.unit && ev.unit.displayName) || 'Mercenary'
          );
          chapters.push({
            gameTime: ev.gameTime,
            label: `Merc: ${name}`,
            shortLabel: 'Merc',
            type: 'hireMercenary',
            severity: 'minor',
            playerIndex: pIdx,
            playerColor: pc,
            icon: (ev.unit && ev.unit.itemId) || null
          });
        }
      });

      // Scan tierStream
      (player.tierStream || []).forEach(t => {
        if (t.tier === 2 && t.gameTime < firstTier2Time) {
          firstTier2Time = t.gameTime;
          firstTier2Data = { playerIndex: pIdx, playerColor: pc, race: player.race };
        }
        if (t.tier === 3 && t.gameTime < firstTier3Time) {
          firstTier3Time = t.gameTime;
          firstTier3Data = { playerIndex: pIdx, playerColor: pc, race: player.race };
        }
      });
    });

    // --- Process hero events ---

    // Sort by completion time to find the earliest hero spawn = end of build phase
    allHeroEvents.sort((a, b) => a.completeTime - b.completeTime);
    const buildPhaseEnd = allHeroEvents.length > 0 ? allHeroEvents[0].completeTime : null;

    // Every hero gets a minor chapter (2nd/3rd per player)
    // First hero per player gets labeled differently but still shows
    const heroCountByPlayer = {};

    allHeroEvents.forEach(h => {
      heroCountByPlayer[h.playerIndex] = (heroCountByPlayer[h.playerIndex] || 0) + 1;
      const count = heroCountByPlayer[h.playerIndex];
      const name = getShortName(h.itemId, h.displayName);

      chapters.push({
        gameTime: h.completeTime,
        label: count === 1 ? `${name} Spawned` : `${name} Trained`,
        shortLabel: name,
        type: 'heroTraining',
        severity: 'minor',
        playerIndex: h.playerIndex,
        playerColor: h.playerColor,
        icon: h.itemId
      });
    });

    // --- Major chapters ---

    // Game Start
    chapters.push({
      gameTime: 0,
      label: 'Game Start',
      shortLabel: 'Start',
      type: 'gameStart',
      severity: 'major',
      playerIndex: -1,
      playerColor: '#aaa',
      icon: null
    });

    // Build Phase Over — when the first hero actually spawns across either player
    if (buildPhaseEnd !== null) {
      chapters.push({
        gameTime: buildPhaseEnd,
        label: 'Build Phase Over',
        shortLabel: 'Action',
        type: 'buildPhaseOver',
        severity: 'major',
        playerIndex: -1,
        playerColor: '#FFD700',
        icon: null
      });
    }

    // Tier 2
    if (firstTier2Data && firstTier2Time < Infinity) {
      chapters.push({
        gameTime: firstTier2Time,
        label: 'Tier 2',
        shortLabel: 'T2',
        type: 'tier2',
        severity: 'major',
        playerIndex: firstTier2Data.playerIndex,
        playerColor: firstTier2Data.playerColor,
        icon: ChapterMarkers.tierBuildingIcon(firstTier2Data.race, 2)
      });
    }

    // Tier 3
    if (firstTier3Data && firstTier3Time < Infinity) {
      chapters.push({
        gameTime: firstTier3Time,
        label: 'Tier 3',
        shortLabel: 'T3',
        type: 'tier3',
        severity: 'major',
        playerIndex: firstTier3Data.playerIndex,
        playerColor: firstTier3Data.playerColor,
        icon: ChapterMarkers.tierBuildingIcon(firstTier3Data.race, 3)
      });
    }

    // First Expansion
    if (firstExpansionData && firstExpansionTime < Infinity) {
      chapters.push({
        gameTime: firstExpansionTime,
        label: 'Expansion',
        shortLabel: 'Expo',
        type: 'firstExpansion',
        severity: 'major',
        playerIndex: firstExpansionData.playerIndex,
        playerColor: firstExpansionData.playerColor,
        icon: ChapterMarkers.EXPANSION_BUILDINGS[firstExpansionData.race] || null
      });
    }

    // Sort by gameTime
    chapters.sort((a, b) => a.gameTime - b.gameTime);

    // Cluster nearby events into combined markers
    this.chapters = this._clusterChapters(chapters);
    return this.chapters;
  }

  _clusterChapters (sorted) {
    const CLUSTER_WINDOW = 8000; // 8 seconds
    const clusters = [];

    for (let i = 0; i < sorted.length; i++) {
      const ch = sorted[i];
      const prev = clusters[clusters.length - 1];

      if (prev && Math.abs(ch.gameTime - prev.gameTime) < CLUSTER_WINDOW) {
        prev.events.push(ch);
        // Promote severity if any event is major
        if (ch.severity === 'major') prev.severity = 'major';
      } else {
        clusters.push({
          gameTime: ch.gameTime,
          severity: ch.severity,
          events: [ch]
        });
      }
    }

    // Flatten clusters into chapter objects with events array
    return clusters.map(c => {
      const primary = c.events.find(e => e.severity === 'major') || c.events[0];
      return {
        gameTime: c.gameTime,
        label: primary.label,
        shortLabel: primary.shortLabel,
        type: primary.type,
        severity: c.severity,
        playerIndex: primary.playerIndex,
        playerColor: c.events.length > 1 ? '#FFD700' : primary.playerColor,
        icon: primary.icon,
        events: c.events
      };
    });
  }

  // --- Scrubber Markers ---

  renderScrubberMarkers (trackEl, matchEndTime) {
    if (!trackEl || !matchEndTime || !this.chapters.length) return;

    this.chapters.forEach(ch => {
      const pct = (ch.gameTime / matchEndTime) * 100;
      const isCluster = ch.events.length > 1;
      const marker = document.createElement('div');
      marker.className = `cm-scrubber-marker cm-${ch.severity}`;
      if (isCluster) marker.classList.add('cm-cluster');
      marker.style.left = `${pct}%`;

      // Clusters get gold tint; single events use player color
      if (isCluster) {
        // Show split colors via gradient for 2-player clusters
        const colors = [...new Set(ch.events.map(e => e.playerColor))];
        if (colors.length > 1) {
          marker.style.background = `linear-gradient(135deg, ${colors[0]} 50%, ${colors[1]} 50%)`;
        } else {
          marker.style.backgroundColor = colors[0];
        }
      } else {
        marker.style.backgroundColor = ch.playerColor;
      }

      if (isCluster) {
        const badge = document.createElement('span');
        badge.className = 'cm-cluster-count';
        badge.textContent = ch.events.length;
        marker.appendChild(badge);
      }

      marker.addEventListener('mouseenter', () => this._showTooltip(marker, ch));
      marker.addEventListener('mouseleave', () => this._hideTooltip());
      marker.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        this.seekAndPlay(ch.gameTime);
      });

      marker.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.stopImmediatePropagation();
      });

      trackEl.appendChild(marker);
      this.markerEls.push(marker);
    });
  }

  _showTooltip (markerEl, chapter) {
    this._hideTooltip();

    const tip = document.createElement('div');
    tip.className = 'cm-tooltip';

    const events = chapter.events || [chapter];
    events.forEach((ev, i) => {
      const row = document.createElement('div');
      row.className = 'cm-tooltip-row';

      // Color pip showing which player
      const pip = document.createElement('span');
      pip.className = 'cm-tooltip-pip';
      pip.style.backgroundColor = ev.playerColor || '#aaa';
      row.appendChild(pip);

      if (ev.icon) {
        const img = document.createElement('img');
        img.className = 'cm-tooltip-icon';
        img.src = `/assets/wc3icons/${ev.icon}.jpg`;
        img.alt = '';
        row.appendChild(img);
      }
      const span = document.createElement('span');
      span.textContent = `${ev.label} \u2014 ${formatGameTime(ev.gameTime)}`;
      row.appendChild(span);
      tip.appendChild(row);
    });

    document.body.appendChild(tip);

    // Position using viewport coords so it escapes all stacking contexts
    const rect = markerEl.getBoundingClientRect();
    tip.style.left = `${rect.left + rect.width / 2}px`;
    tip.style.top = `${rect.top - tip.offsetHeight - 6}px`;

    this.tooltipEl = tip;
  }

  _hideTooltip () {
    if (this.tooltipEl) {
      this.tooltipEl.remove();
      this.tooltipEl = null;
    }
  }

  // --- Activity Heatmap ---

  renderHeatmap (trackEl, players, matchEndTime) {
    if (!trackEl || !matchEndTime) return;

    const canvas = document.createElement('canvas');
    canvas.className = 'cm-heatmap';
    trackEl.insertBefore(canvas, trackEl.firstChild);
    this.heatmapCanvas = canvas;

    this._drawHeatmap(players, matchEndTime);

    this.resizeObserver = new ResizeObserver(() => {
      this._drawHeatmap(players, matchEndTime);
    });
    this.resizeObserver.observe(trackEl);
  }

  _drawHeatmap (players, matchEndTime) {
    const canvas = this.heatmapCanvas;
    if (!canvas) return;

    const trackEl = canvas.parentElement;
    if (!trackEl) return;

    const width = trackEl.offsetWidth;
    const height = trackEl.offsetHeight;
    if (width <= 0 || height <= 0) return;

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);

    const nonNeutral = players.filter(p => !p.isNeutralPlayer);
    const bins = width;
    const binDuration = matchEndTime / bins;

    // Count events per bin per player
    const playerBins = nonNeutral.map(player => {
      const counts = new Float32Array(bins);
      (player.eventStream || []).forEach(ev => {
        const bin = Math.min(bins - 1, Math.floor(ev.gameTime / binDuration));
        if (bin >= 0) counts[bin]++;
      });
      return counts;
    });

    // Find global max for normalization
    let maxCount = 0;
    playerBins.forEach(counts => {
      for (let i = 0; i < bins; i++) {
        if (counts[i] > maxCount) maxCount = counts[i];
      }
    });

    if (maxCount === 0) return;

    // Draw bars per player, stacked
    nonNeutral.forEach((player, pIdx) => {
      const counts = playerBins[pIdx];
      const pc = player.playerColor || TeamColorList[pIdx] || '#fff';

      // Parse color for alpha blending
      ctx.fillStyle = pc;
      ctx.globalAlpha = 0.5;

      for (let i = 0; i < bins; i++) {
        if (counts[i] === 0) continue;
        const norm = counts[i] / maxCount;
        const barH = Math.max(1, norm * height);
        const y = pIdx === 0 ? (height - barH) : 0;
        ctx.fillRect(i, y, 1, barH);
      }
    });

    ctx.globalAlpha = 1.0;
  }

  // --- Build Order Quick-Jump ---

  // Types that are redundant as standalone BO buttons (covered by nearby events)
  static SKIP_BO_TYPES = { gameStart: true, buildPhaseOver: true };

  // Quick-jump grouping: event type -> group key. Unmapped types fall to 'game'.
  static BO_JUMP_GROUPS = [
    { key: 'tech',   label: 'TECH',   types: ['tier2', 'tier3', 'firstExpansion', 'firstUpgrade'] },
    { key: 'heroes', label: 'HEROES', types: ['heroTraining', 'heroRevive'] },
    { key: 'game',   label: 'GAME',   types: ['firstScout', 'transportLoad', 'hireMercenary'] }
  ];

  // Tier building per race — subject icon for tier2/tier3 jump cells.
  // [tier2, tier3] itemIds (mirrors helpers/mappings.js tierBuildings).
  static TIER_BUILDINGS = {
    U: ['unp1', 'unp2'], O: ['ostr', 'ofrt'],
    E: ['etoa', 'etoe'], H: ['hkee', 'hcas']
  };
  // Town hall per race — subject icon for the expansion jump cell.
  static EXPANSION_BUILDINGS = { O: 'ogre', H: 'htow', E: 'etol', U: 'unpl' };

  static tierBuildingIcon (race, tier) {
    const pair = ChapterMarkers.TIER_BUILDINGS[race];
    return pair ? pair[tier - 2] || null : null;
  }

  // Type glyph: a small symbol marking the *kind* of event, shown alongside
  // the subject icon (e.g. ⬆ + Keep for a tier-up, ✦ + hero for a spawn).
  // cls drives the accent color (tech / hero / game).
  static TYPE_GLYPH = {
    tier2:          { glyph: '⬆', cls: 'tech' }, // ⬆
    tier3:          { glyph: '⬆', cls: 'tech' },
    firstExpansion: { glyph: '⌂', cls: 'tech' }, // ⌂
    firstUpgrade:   { glyph: '⚔', cls: 'tech' }, // ⚔ (defense overridden below)
    heroTraining:   { glyph: '✦', cls: 'hero' }, // ✦
    heroRevive:     { glyph: '↺', cls: 'hero' }, // ↺
    firstScout:     { glyph: '◉', cls: 'game' }, // ◉
    hireMercenary:  { glyph: '⚑', cls: 'game' }, // ⚑
    transportLoad:  { glyph: '✈', cls: 'game' }  // ✈
  };

  _typeGlyph (ev) {
    const g = ChapterMarkers.TYPE_GLYPH[ev.type];
    if (!g) return null;
    // Attack vs defense share the firstUpgrade type — pick by label.
    if (ev.type === 'firstUpgrade' && /def/i.test(ev.shortLabel || '')) {
      return { glyph: '◈', cls: 'tech' }; // ◈ shield-ish for defense
    }
    return g;
  }

  // Max jump cells shown inline before overflow rolls into the "+N" modal.
  static MAX_VISIBLE_JUMPS = 6;

  // Build a compact tabular jump cell: icon (or player-color pip) + label + time.
  _makeJumpBtn (ev, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `bo-chapter-btn bo-chapter-${ev.severity}`;
    btn.dataset.time = ev.gameTime;
    btn.title = `${ev.label} — ${formatGameTime(ev.gameTime)}`;

    // Type glyph — marks the kind of event (spawn / tier-up / scout / ...)
    const g = this._typeGlyph(ev);
    if (g) {
      const gl = document.createElement('span');
      gl.className = `bo-chapter-glyph bo-glyph-${g.cls}`;
      gl.textContent = g.glyph;
      gl.setAttribute('aria-hidden', 'true');
      btn.appendChild(gl);
    }

    // Subject icon — the specific hero / building / unit involved
    if (ev.icon) {
      const img = document.createElement('img');
      img.className = 'bo-chapter-icon';
      img.src = `/assets/wc3icons/${ev.icon}.jpg`;
      img.alt = '';
      btn.appendChild(img);
    } else if (!g) {
      const pip = document.createElement('span');
      pip.className = 'bo-chapter-pip';
      pip.style.backgroundColor = ev.playerColor || '#aaa';
      btn.appendChild(pip);
    }

    const label = document.createElement('span');
    label.className = 'bo-chapter-label';
    label.textContent = ev.shortLabel;
    btn.appendChild(label);

    const time = document.createElement('span');
    time.className = 'bo-chapter-time';
    time.textContent = formatGameTime(ev.gameTime);
    btn.appendChild(time);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.seekAndPlay(ev.gameTime);
      if (onClick) onClick();
    });
    return btn;
  }

  renderBoQuickJump (playerIndex) {
    // Flatten clusters into individual events, keep majors + this player's minors
    // Skip types that aren't useful as standalone jump targets
    const allEvents = [];
    this.chapters.forEach(ch => {
      (ch.events || [ch]).forEach(ev => {
        if (ChapterMarkers.SKIP_BO_TYPES[ev.type]) return;
        if (ev.severity === 'major' || ev.playerIndex === playerIndex) {
          allEvents.push(ev);
        }
      });
    });

    if (allEvents.length === 0) return null;

    // Chronological order for display and the overflow modal.
    allEvents.sort((a, b) => a.gameTime - b.gameTime);

    // Pick the inline set: majors are most valuable, fill remaining slots with
    // the earliest minors, then re-sort the chosen set chronologically.
    const MAX = ChapterMarkers.MAX_VISIBLE_JUMPS;
    let visible;
    if (allEvents.length <= MAX) {
      visible = allEvents;
    } else {
      const majors = allEvents.filter(ev => ev.severity === 'major');
      const minors = allEvents.filter(ev => ev.severity !== 'major');
      visible = majors.concat(minors).slice(0, MAX)
        .sort((a, b) => a.gameTime - b.gameTime);
    }
    const overflow = allEvents.length - visible.length;

    const nav = document.createElement('div');
    nav.className = 'bo-chapter-nav';

    // Header: heading + (optional) "+N" overflow button
    const head = document.createElement('div');
    head.className = 'bo-chapter-head';
    const heading = document.createElement('span');
    heading.className = 'bo-chapter-heading';
    heading.textContent = 'QUICK JUMP';
    head.appendChild(heading);

    if (overflow > 0) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'bo-chapter-more';
      more.textContent = `+${overflow}`;
      more.title = `Show all ${allEvents.length} quick-jump events`;
      more.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showQuickJumpModal(allEvents);
      });
      head.appendChild(more);
    }
    nav.appendChild(head);

    // Tabular grid of jump cells
    const grid = document.createElement('div');
    grid.className = 'bo-chapter-grid';
    visible.forEach(ev => grid.appendChild(this._makeJumpBtn(ev)));
    nav.appendChild(grid);

    return nav;
  }

  // --- Quick-Jump overflow modal ---

  _showQuickJumpModal (allEvents) {
    this._hideQuickJumpModal();

    const typeToGroup = {};
    ChapterMarkers.BO_JUMP_GROUPS.forEach(g => {
      g.types.forEach(t => { typeToGroup[t] = g.key; });
    });

    const overlay = document.createElement('div');
    overlay.className = 'bo-qj-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'bo-qj-modal';
    overlay.appendChild(modal);

    const head = document.createElement('div');
    head.className = 'bo-qj-modal-head';
    head.innerHTML = '<span class="bo-qj-modal-title">QUICK JUMP</span>';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'bo-qj-modal-close';
    close.innerHTML = '×';
    close.title = 'Close';
    close.addEventListener('click', () => this._hideQuickJumpModal());
    head.appendChild(close);
    modal.appendChild(head);

    const body = document.createElement('div');
    body.className = 'bo-qj-modal-body';

    ChapterMarkers.BO_JUMP_GROUPS.forEach(g => {
      const events = allEvents.filter(ev => (typeToGroup[ev.type] || 'game') === g.key);
      if (events.length === 0) return;

      const group = document.createElement('div');
      group.className = 'bo-qj-group';
      const gl = document.createElement('div');
      gl.className = 'bo-qj-group-label';
      gl.textContent = g.label;
      group.appendChild(gl);

      const ggrid = document.createElement('div');
      ggrid.className = 'bo-chapter-grid';
      events.forEach(ev =>
        ggrid.appendChild(this._makeJumpBtn(ev, () => this._hideQuickJumpModal())));
      group.appendChild(ggrid);
      body.appendChild(group);
    });

    modal.appendChild(body);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this._hideQuickJumpModal();
    });
    this._qjEscHandler = (e) => {
      if (e.key === 'Escape') this._hideQuickJumpModal();
    };
    document.addEventListener('keydown', this._qjEscHandler);

    document.body.appendChild(overlay);
    this._qjModalEl = overlay;
  }

  _hideQuickJumpModal () {
    if (this._qjModalEl) {
      this._qjModalEl.remove();
      this._qjModalEl = null;
    }
    if (this._qjEscHandler) {
      document.removeEventListener('keydown', this._qjEscHandler);
      this._qjEscHandler = null;
    }
  }

  getChaptersForPlayer (playerIndex) {
    return this.chapters.filter(ch =>
      ch.playerIndex === -1 || ch.playerIndex === playerIndex
    );
  }

  // --- Cleanup ---

  destroy () {
    this.markerEls.forEach(el => el.remove());
    this.markerEls = [];

    if (this.heatmapCanvas) {
      this.heatmapCanvas.remove();
      this.heatmapCanvas = null;
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    this._hideTooltip();
    this._hideQuickJumpModal();
    this.chapters = [];
  }
};

window.ChapterMarkers = ChapterMarkers;
