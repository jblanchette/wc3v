////
// BuildingPlacementViewer — modal overlay showing a zoomed 3D view of a
// player's base layout. Captures a 3D render from ThreeMapRenderer focused
// on the base area, overlays building labels + footprint outlines in 2D.
// Supports discrete snapshots (tier transitions + final) with nav controls.
////

// All possible snapshot slots in display order
const SNAPSHOT_SLOTS = [
  { tier: 1, label: 'Tier 1' },
  { tier: 2, label: 'Tier 2' },
  { label: 'Final' }
];

// WC3 building footprints in WPM cells (grid squares).
const BUILDING_FOOTPRINT = {
  // Human
  htow: 6, hkee: 6, hcas: 6,
  hbar: 5, hbla: 5, hlum: 5,
  halt: 5, harm: 5, hars: 5,
  hgra: 4,
  hhou: 3, hwtw: 3, hgtw: 3,
  hatw: 3, hctw: 3,
  hvlt: 4, hshy: 4,
  haro: 6,
  // Orc
  ogre: 6, ostr: 6, ofrt: 6,
  obar: 5, obea: 5, ofor: 5,
  osld: 5, otto: 5, oalt: 5,
  otrb: 3, owtw: 3,
  ovln: 4, oshy: 4,
  // Night Elf
  etol: 5, etoa: 5, etoe: 5,
  eaom: 5, eaow: 5, eaoe: 5,
  eate: 5, edob: 5, eden: 5,
  edos: 5, etrp: 5,
  emow: 3,
  egol: 4, eshy: 4,
  // Undead
  unpl: 7, unp1: 7, unp2: 7,
  usep: 5, ugrv: 5, uaod: 5,
  uslh: 5, ubon: 5, utod: 5, usap: 5,
  uzig: 4, uzg1: 4, uzg2: 4,
  utom: 4, ugol: 4, ushp: 4
};

function getFootprintCells (itemId) {
  return BUILDING_FOOTPRINT[itemId] || 4;
}

const BuildingPlacementViewer = class {
  constructor () {
    this.container = null;
    this.canvas = null;
    this.ctx = null;
    this.visible = false;
    this._snapshots = [];
    this._activeIndex = 0;
    this._threeRenderer = null;
  }

  setup () {
    this.container = document.getElementById('placement-viewer-modal');
    if (!this.container) return;

    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';

    this._canvasWrap = this.container.querySelector('.placement-viewer-canvas');
    if (this._canvasWrap) {
      this._canvasWrap.appendChild(this.canvas);
    }

    this.ctx = this.canvas.getContext('2d');

    const closeBtn = this.container.querySelector('.placement-viewer-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.hide());
    }
    this.container.addEventListener('click', (e) => {
      if (e.target === this.container) this.hide();
    });

    // re-render on resize
    if (this._canvasWrap) {
      this._resizeObserver = new ResizeObserver(() => {
        if (this.visible && this._baseParams) this._doRender();
      });
      this._resizeObserver.observe(this._canvasWrap);
    }

    // Escape key to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.visible) this.hide();
    });
  }

  show (baseGrid, baseSnapshots, playerColor, neutralBuildings, mapImage, gameScaler, playerName, playerRace, threeRenderer) {
    if (!baseGrid || !baseGrid.cells || !this.container) return;
    if (!baseSnapshots || !baseSnapshots.length) return;

    this._snapshots = baseSnapshots;
    this._baseParams = { baseGrid, playerColor, neutralBuildings, gameScaler };
    this._threeRenderer = threeRenderer || null;

    // update header with player info \u2014 playerName is replay-derived
    // and playerColor flows into a style attribute. Both must go
    // through Security helpers before reaching innerHTML.
    const titleEl = this.container.querySelector('.placement-viewer-title');
    if (titleEl && playerName) {
      const RACE_ICONS = { 'O': 'ogre', 'H': 'htow', 'E': 'etol', 'U': 'unpl' };
      const iconId = RACE_ICONS[playerRace] || '';
      const safeName = Security.escapeHtml(Security.sanitizeUserText(playerName, { maxLen: 40 }));
      const safeColor = /^#[0-9A-Fa-f]{3,8}$|^rgb[a]?\([0-9.,\s%]+\)$|^[a-zA-Z]{1,20}$/.test(String(playerColor)) ? playerColor : '#fff';
      titleEl.innerHTML = (iconId ? '<img class="pv-race-icon" src="/assets/wc3icons/' + iconId + '.jpg" /> ' : '') +
        '<span class="pv-player-name" style="color:' + safeColor + '">' + safeName + '</span>' +
        ' <span class="pv-title-sep">\u2014</span> Building Placement';
    }

    // default to last snapshot (Final)
    this._activeIndex = baseSnapshots.length - 1;

    this._buildControls();
    this._doRender();
    this.container.style.display = 'flex';
    this.visible = true;
  }

  _buildControls () {
    const wrap = this.container.querySelector('.placement-viewer-controls');
    if (!wrap) return;
    wrap.innerHTML = '';

    const available = {};
    this._snapshots.forEach((snap, i) => { available[snap.label] = i; });

    SNAPSHOT_SLOTS.forEach(slot => {
      const btn = document.createElement('button');
      btn.classList.add('pv-snapshot-btn');
      btn.textContent = slot.label;

      const idx = available[slot.label];
      if (idx == null) {
        btn.disabled = true;
      } else {
        if (idx === this._activeIndex) btn.classList.add('active');
        btn.addEventListener('click', () => this._selectSnapshot(idx));
      }

      wrap.appendChild(btn);
    });
  }

  _selectSnapshot (index) {
    if (index === this._activeIndex) return;
    this._activeIndex = index;

    const buttons = this.container.querySelectorAll('.pv-snapshot-btn');
    const available = {};
    this._snapshots.forEach((snap, i) => { available[snap.label] = i; });

    let btnIdx = 0;
    SNAPSHOT_SLOTS.forEach(slot => {
      const btn = buttons[btnIdx++];
      if (!btn) return;
      const snapIdx = available[slot.label];
      btn.classList.toggle('active', snapIdx === this._activeIndex);
    });

    this._doRender();
  }

  _doRender () {
    const { baseGrid, playerColor, neutralBuildings, gameScaler } = this._baseParams;
    const snapshot = this._snapshots[this._activeIndex];
    if (!snapshot) return;

    // compute available canvas space
    const fixedH = 80;
    const availW = Math.floor(window.innerWidth * 0.90);
    const availH = Math.floor(window.innerHeight * 0.90 - fixedH);

    // Maintain roughly 4:3 aspect for the base view
    const aspect = (baseGrid.cols * baseGrid.cellSize) / (baseGrid.rows * baseGrid.cellSize);
    let canvasW, canvasH;
    if (availW / availH > aspect) {
      canvasH = availH;
      canvasW = Math.floor(canvasH * aspect);
    } else {
      canvasW = availW;
      canvasH = Math.floor(canvasW / aspect);
    }
    canvasW = Math.max(canvasW, 200);
    canvasH = Math.max(canvasH, 200);

    this.canvas.width = canvasW;
    this.canvas.height = canvasH;

    const ctx = this.ctx;

    // --- 3D render pass: capture ThreeMapRenderer scene focused on base ---
    let rendered3D = false;
    if (this._threeRenderer) {
      rendered3D = this._threeRenderer.renderBaseSnapshot(
        baseGrid, snapshot.buildings, this.canvas
      );
    }

    // Fallback: flat colored grid if 3D not available
    if (!rendered3D) {
      this._renderFlatBackground(ctx, baseGrid, canvasW, canvasH);
    }

    // --- 2D overlay: building labels and footprint outlines ---
    const { originX, originY, cellSize, cols, rows } = baseGrid;
    const scaleX = canvasW / (cols * cellSize);
    const scaleY = canvasH / (rows * cellSize);

    // Draw building name labels below each building (3D models handle visuals)
    if (rendered3D) {
      snapshot.buildings.forEach(b => {
        const gridCol = (b.x - originX) / cellSize;
        const gridRow = (originY - b.y) / cellSize;
        const wpmCells = getFootprintCells(b.itemId);
        const halfCells = wpmCells / 2;
        const px = (gridCol - halfCells) * cellSize * scaleX;
        const py = (gridRow + halfCells) * cellSize * scaleY;
        const size = wpmCells * cellSize * scaleX;

        ctx.globalAlpha = 0.95;
        ctx.fillStyle = b.isInferred ? '#777' : '#fff';
        const fontSize = Math.max(10, Math.min(14, size / 5));
        ctx.font = `bold ${fontSize}px 'Segoe UI', Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 3;
        ctx.fillText(b.isInferred ? b.displayName + ' ?' : b.displayName, px + size / 2, py + 4);
        ctx.shadowBlur = 0;
        ctx.textAlign = 'left';
      });
    }

    // Draw neutral building labels
    if (rendered3D && neutralBuildings) {
      neutralBuildings.forEach(nb => {
        const nx = nb.x != null ? nb.x : 0;
        const ny = nb.y != null ? nb.y : 0;
        const gridCol = (nx - originX) / cellSize;
        const gridRow = (originY - ny) / cellSize;
        if (gridCol < -4 || gridCol >= cols + 4 || gridRow < -4 || gridRow >= rows + 4) return;

        const px = gridCol * cellSize * scaleX;
        const py = gridRow * cellSize * scaleY;

        ctx.globalAlpha = 0.85;
        ctx.fillStyle = '#c8a030';
        ctx.font = `bold 11px 'Segoe UI', Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 3;
        ctx.fillText(nb.type === 'ngol' ? 'Gold Mine' : '', px, py + 20);
        ctx.shadowBlur = 0;
        ctx.textAlign = 'left';
      });
    }

    ctx.globalAlpha = 1.0;

    // snapshot label
    const labelEl = this.container.querySelector('.placement-viewer-label');
    if (labelEl) {
      const gt = snapshot.gameTime;
      const mins = Math.floor(gt / 60000);
      const secs = Math.floor((gt % 60000) / 1000);
      labelEl.textContent = `${snapshot.label} \u2014 ${mins}:${String(secs).padStart(2, '0')}`;
    }
  }

  // Flat-colored fallback when 3D renderer isn't available
  _renderFlatBackground (ctx, baseGrid, w, h) {
    const { cols, rows, cells, cellSize } = baseGrid;
    const cs = w / cols;
    const CELL_COLORS = [
      baseGrid.cliffColor || '#383020',
      baseGrid.groundColor || '#48862a',
      baseGrid.groundColor || '#48862a',
      baseGrid.waterColor || '#0a2070',
      baseGrid.shallowWaterColor || '#1838a0'
    ];
    for (let r = 0; r < rows; r++) {
      const rowData = cells[r];
      if (!rowData) continue;
      for (let c = 0; c < cols; c++) {
        ctx.fillStyle = CELL_COLORS[rowData[c]] || CELL_COLORS[0];
        ctx.fillRect(c * cs, r * (h / rows), cs, h / rows);
      }
    }
  }

  hide () {
    if (this.container) {
      this.container.style.display = 'none';
    }
    this.visible = false;
  }
};

window.BuildingPlacementViewer = BuildingPlacementViewer;
