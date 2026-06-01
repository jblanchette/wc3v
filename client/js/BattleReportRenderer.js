/**
 * BattleReportRenderer — renders per-battle loss summaries in two places:
 *
 *   1. Transient banner: drawn on #action-canvas near each battle's bbox
 *      when gameTime enters the window [battle.endTime + 600ms, +4600ms].
 *      Player-coloured columns showing losses split into definite/estimated.
 *
 *   2. Persistent panel: a collapsible list in the DOM (#battle-report-panel)
 *      that accumulates every battle with losses, click-to-seek.
 *
 * Source data: world.battles[*].summary.perPlayer (see lib/BattleSummary.js).
 */

(function () {
  // Engagement-type chip labels.
  const TYPE_LABELS = {
    campClear: 'Camp',
    creepJack: 'Creep Jack',
    baseRaid:  'Base Raid',
    defense:   'Defense',
    heroSnipe: 'Hero Snipe',
    wipe:      'Wipe',
    harass:    'Harass',
    skirmish:  'Skirmish'
  };

  // Trip indicator descriptors. icon uses inline SVG so we don't need yet
  // more asset files; emoji fallback for terseness in cramped layouts.
  const TRIP_DESCRIPTORS = [
    { key: 'fountain', title: 'Fountain heal/mana', icon: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 3l3 5h-2v4h-2V8H9l3-5zm-5 13h10l-2 5H9l-2-5z" fill="#5ECCFF"/></svg>' },
    { key: 'shop',     title: 'Shop visit',          icon: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M4 8h16l-1 12H5L4 8zm3-3a3 3 0 0 1 6 0v3h-2V5a1 1 0 0 0-2 0v3H7V5zm6 0a3 3 0 0 1 6 0v3h-2V5a1 1 0 0 0-2 0v3h-2V5z" fill="#FFD43B"/></svg>' },
    { key: 'moonwell', title: 'Moonwell',            icon: '<svg viewBox="0 0 24 24" width="14" height="14"><circle cx="12" cy="12" r="8" fill="none" stroke="#A0E0FF" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="#A0E0FF"/></svg>' },
    { key: 'base',     title: 'Returned to base',    icon: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M3 11l9-7 9 7v9H3v-9z" fill="#8AE890"/></svg>' },
    { key: 'expansion',title: 'To/from expansion',   icon: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 2l3 6 6 1-4 5 1 6-6-3-6 3 1-6-4-5 6-1 3-6z" fill="#FFB347"/></svg>' },
    { key: 'disengage',title: 'Disengaged / fled',   icon: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M14 5l-7 7 7 7v-4h5v-6h-5V5z" fill="#B0B0B0"/></svg>' },
    { key: 'reengage', title: 'Re-engaged',          icon: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 4a8 8 0 1 1-7.5 5.2l2 .8A6 6 0 1 0 12 6V3l5 4-5 4V4z" fill="#FF8AAB"/></svg>' }
  ];

  const BANNER_DELAY_MS = 600;   // brief beat after battle end before banner shows
  const BANNER_DURATION_MS = 4000;
  const BANNER_FADE_MS = 600;    // fade in/out tail of the window
  const BANNER_WIDTH = 230;
  const BANNER_LINE_HEIGHT = 16;
  const BANNER_PADDING = 10;

  function formatTime (ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const r = s - m * 60;
    return m + ':' + (r < 10 ? '0' + r : r);
  }

  class BattleReportRenderer {
    constructor (viewer) {
      this.viewer = viewer;
      this._battles = [];
      this._listEl = null;
      this._panelBuilt = false;
      this._lastPanelGameTime = -1;
    }

    // Container the panel will render its battle list inside. Provided by
    // BottomPanel as a tab content element.
    setContainer (containerEl) {
      this._listEl = containerEl;
      this._listEl.classList.add('brp-list');
      this._panelBuilt = false;
    }

    // Called by app.js once world data is loaded.
    setBattles (battles) {
      this._battles = (battles || []).filter(b => b && b.summary && b.summary.hasLosses);
      this._panelBuilt = false;
    }

    // --------------------------------------------------------------
    // Transient banner (called per frame from app.js render loop)
    // --------------------------------------------------------------

    render (ctx, gameTime, gameScaler) {
      if (!this._battles.length) return;

      for (const battle of this._battles) {
        const t0 = battle.endTime + BANNER_DELAY_MS;
        const t1 = t0 + BANNER_DURATION_MS;
        if (gameTime < t0 || gameTime > t1) continue;
        this._drawBanner(ctx, battle, gameTime - t0, gameScaler);
      }
    }

    _drawBanner (ctx, battle, ageMs, gameScaler) {
      const summary = battle.summary;
      const players = Object.values(summary.perPlayer);
      if (!players.length) return;

      // Position banner above the battle bbox centre in canvas pixels.
      const c = summary.center;
      const proj = gameScaler.projectXY(c.x, c.y);
      if (!proj) return;  // battle centre is off-screen
      const cx = proj.x + gameScaler.middleX;
      const cy = proj.y + gameScaler.middleY;

      // Layout: stack player columns vertically.
      const lines = [];
      for (const p of players) {
        const def = p.definite, est = p.estimated;
        if (def.count === 0 && est.count === 0) continue;
        lines.push({ kind: 'header', text: 'Player ' + p.playerId, color: p.playerColor });
        for (const u of def.units) {
          lines.push({
            kind: 'unit',
            text: u.count + '× ' + u.displayName,
            hero: u.isHero,
            confidence: 'definite'
          });
        }
        for (const u of est.units) {
          lines.push({
            kind: 'unit',
            text: u.count + '× ' + u.displayName + ' (likely)',
            hero: u.isHero,
            confidence: 'estimated'
          });
        }
        const tot = {
          food: def.food + est.food,
          gold: def.gold + est.gold,
          lumber: def.lumber + est.lumber
        };
        lines.push({
          kind: 'totals',
          text: tot.food + ' food • ' + tot.gold + 'g • ' + tot.lumber + 'l'
        });
      }
      if (!lines.length) return;

      const totalHeight = BANNER_PADDING * 2 + lines.length * BANNER_LINE_HEIGHT;
      const x = Math.round(cx - BANNER_WIDTH / 2);
      const y = Math.round(cy - totalHeight - 40);  // float above battle

      // Alpha — fade in/out at the edges of the window.
      let alpha = 1;
      if (ageMs < BANNER_FADE_MS) {
        alpha = ageMs / BANNER_FADE_MS;
      } else if (ageMs > BANNER_DURATION_MS - BANNER_FADE_MS) {
        alpha = (BANNER_DURATION_MS - ageMs) / BANNER_FADE_MS;
      }
      alpha = Math.max(0, Math.min(1, alpha));
      if (alpha < 0.02) return;

      ctx.save();
      ctx.globalAlpha = alpha;

      // Background.
      ctx.fillStyle = 'rgba(12, 12, 18, 0.88)';
      this._roundedRect(ctx, x, y, BANNER_WIDTH, totalHeight, 6);
      ctx.fill();
      // Hero-death thick top border.
      if (summary.hasHeroDeath) {
        ctx.fillStyle = '#FFD43B';
        this._roundedRect(ctx, x, y, BANNER_WIDTH, 3, 6);
        ctx.fill();
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1;
        this._roundedRect(ctx, x + 0.5, y + 0.5, BANNER_WIDTH - 1, totalHeight - 1, 6);
        ctx.stroke();
      }

      // Lines.
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      let ly = y + BANNER_PADDING + BANNER_LINE_HEIGHT / 2;
      for (const line of lines) {
        if (line.kind === 'header') {
          ctx.font = 'bold 12px sans-serif';
          ctx.fillStyle = line.color || '#FFF';
          ctx.fillText('LOST: ' + line.text, x + BANNER_PADDING, ly);
        } else if (line.kind === 'unit') {
          ctx.font = line.hero ? 'bold 12px sans-serif' : '11px sans-serif';
          if (line.hero) {
            // Hero callout — bright + dot indicator
            ctx.fillStyle = '#FFD43B';
            ctx.fillText('★ ' + line.text, x + BANNER_PADDING, ly);
          } else if (line.confidence === 'estimated') {
            ctx.fillStyle = 'rgba(255,255,255,0.55)';
            ctx.fillText(line.text, x + BANNER_PADDING + 6, ly);
          } else {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText(line.text, x + BANNER_PADDING + 6, ly);
          }
        } else if (line.kind === 'totals') {
          ctx.font = '11px sans-serif';
          ctx.fillStyle = '#8AE890';
          ctx.fillText(line.text, x + BANNER_PADDING + 6, ly);
        }
        ly += BANNER_LINE_HEIGHT;
      }
      ctx.restore();
    }

    _roundedRect (ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }

    // --------------------------------------------------------------
    // Persistent panel
    // --------------------------------------------------------------

    buildPanel () {
      if (!this._listEl || this._panelBuilt) return;
      this._listEl.innerHTML = '';
      for (const battle of this._battles) {
        const row = this._buildPanelRow(battle);
        this._listEl.appendChild(row);
      }
      this._panelBuilt = true;
    }

    _buildPanelRow (battle) {
      const summary = battle.summary;
      const type = summary.engagementType || 'skirmish';
      const row = document.createElement('div');
      row.className = 'brp-row brp-row-v2 brp-type-' + type;
      if (summary.hasHeroDeath) row.classList.add('brp-hero-death');
      row.dataset.battleId = battle.id;

      // Header line: chip · time · duration. No single-edge stripe; the
      // chip background carries the type colour.
      const header = document.createElement('div');
      header.className = 'brp-rh';
      const chip = document.createElement('div');
      chip.className = 'brp-chip brp-chip-' + type;
      chip.textContent = TYPE_LABELS[type] || type;
      header.appendChild(chip);
      const time = document.createElement('span');
      time.className = 'brp-rh-time';
      time.textContent = formatTime(battle.endTime);
      header.appendChild(time);
      const dur = document.createElement('span');
      dur.className = 'brp-rh-dur';
      dur.textContent = Math.round((summary.durationMs || 0) / 1000) + 's';
      header.appendChild(dur);
      row.appendChild(header);

      // Two-column player compare. Both players show side by side so
      // viewers see the trade at a glance without scrolling per row.
      const playerEntries = Object.values(summary.perPlayer);
      // Pad to exactly two columns even if only one player has activity,
      // so the visual is consistent.
      const cols = playerEntries.slice(0, 2);
      while (cols.length < 2) cols.push(null);

      const grid = document.createElement('div');
      grid.className = 'brp-grid';
      for (const p of cols) {
        grid.appendChild(this._buildPlayerCell(p, summary.trips || {}));
      }
      row.appendChild(grid);

      row.addEventListener('click', () => {
        if (this.viewer && typeof this.viewer.seekToGameTime === 'function') {
          this.viewer.seekToGameTime(battle.startTime);
        } else if (this.viewer && typeof this.viewer.seek === 'function') {
          this.viewer.seek(battle.startTime);
        }
      });
      return row;
    }

    _buildPlayerCell (p, trips) {
      const cell = document.createElement('div');
      cell.className = 'brp-cell';
      if (!p) {
        cell.classList.add('brp-cell-empty');
        return cell;
      }
      // Player swatch dot in the cell header carries colour without using
      // a single-edge border.
      const swatch = document.createElement('span');
      swatch.className = 'brp-cell-swatch';
      swatch.style.background = p.playerColor || '#666';
      cell.appendChild(swatch);

      const playerTrips = trips[p.playerId];
      const def = p.definite, est = p.estimated;
      const hasLosses = (def.count + est.count) > 0;
      const hasTrips = playerTrips && Object.values(playerTrips).some(n => n > 0);

      if (!hasLosses && !hasTrips) {
        const empty = document.createElement('span');
        empty.className = 'brp-cell-empty-label';
        empty.textContent = '·';
        cell.appendChild(empty);
        return cell;
      }

      if (hasLosses) {
        const iconRow = document.createElement('div');
        iconRow.className = 'brp-cell-icons';
        for (const u of def.units) {
          iconRow.appendChild(this._unitIconChip(u, false));
        }
        for (const u of est.units) {
          iconRow.appendChild(this._unitIconChip(u, true));
        }
        cell.appendChild(iconRow);

        const food = def.food + est.food;
        const gold = def.gold + est.gold;
        const lumber = def.lumber + est.lumber;
        const tot = document.createElement('div');
        tot.className = 'brp-cell-totals';
        tot.innerHTML =
          '<span class="brp-tot-food">' + food + 'f</span> ' +
          '<span class="brp-tot-gold">' + gold + 'g</span> ' +
          '<span class="brp-tot-lumber">' + lumber + 'l</span>';
        cell.appendChild(tot);
      }

      if (hasTrips) {
        const trow = document.createElement('div');
        trow.className = 'brp-cell-trips';
        for (const tipd of TRIP_DESCRIPTORS) {
          const n = playerTrips[tipd.key];
          if (!n) continue;
          const t = document.createElement('span');
          t.className = 'brp-trip';
          t.title = tipd.title + ' x ' + n;
          t.innerHTML = tipd.icon + (n > 1 ? '<i>' + n + '</i>' : '');
          trow.appendChild(t);
        }
        cell.appendChild(trow);
      }
      return cell;
    }

    _unitIconChip (unit, estimated) {
      const w = document.createElement('span');
      w.className = 'brp-uic';
      if (estimated) w.classList.add('brp-uic-est');
      if (unit.isHero) w.classList.add('brp-uic-hero');
      const img = document.createElement('img');
      img.src = '/assets/wc3icons/' + unit.itemId + '.jpg';
      img.alt = unit.displayName;
      img.title = (unit.isHero ? '★ ' : '') + unit.count + '× ' + unit.displayName +
                  (estimated ? ' (likely)' : '');
      img.onerror = function () { this.style.display = 'none'; };
      w.appendChild(img);
      if (unit.count > 1) {
        const c = document.createElement('i');
        c.className = 'brp-uic-n';
        c.textContent = unit.count;
        w.appendChild(c);
      }
      return w;
    }

    // Highlight the row whose battle is currently active.
    syncPanel (gameTime) {
      if (!this._listEl) return;
      if (Math.abs(gameTime - this._lastPanelGameTime) < 250) return;
      this._lastPanelGameTime = gameTime;
      let activeId = null;
      for (const b of this._battles) {
        if (gameTime >= b.startTime - 1000 && gameTime <= b.endTime + 6000) {
          activeId = b.id;
          break;
        }
      }
      const rows = this._listEl.querySelectorAll('.brp-row');
      rows.forEach(r => {
        if (r.dataset.battleId === activeId) {
          r.classList.add('brp-active');
        } else {
          r.classList.remove('brp-active');
        }
      });
    }
  }

  window.BattleReportRenderer = BattleReportRenderer;
})();
