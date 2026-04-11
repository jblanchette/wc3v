////
// BuildingPlacementViewer — modal overlay showing a zoomed view of a
// player's base layout rendered entirely from data (terrain cells, trees,
// buildings). Supports discrete snapshots (tier transitions + final) with
// nav controls. Trees that overlap buildings are automatically removed.
////

const PLACEMENT_MIN_CELL = 4;
const TREE_CLEAR_BUFFER = 3; // extra WPM cells beyond building footprint for tree clearing

// seeded pseudo-random for deterministic per-tree variation
function tileHash (a, b) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) & 0xFF) / 255.0;
}

function hexToRgb (hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ];
}

// WC3 building footprints in WPM cells (grid squares).
// UnitBalance.json collisionSize is unreliable for many buildings
// (shops/shipyards have cs=50 but are 3x3 in-game). This table
// uses actual WC3 footprints.
const BUILDING_FOOTPRINT = {
  // Human
  htow: 6, hkee: 6, hcas: 6,        // town halls
  hbar: 5, hbla: 5, hlum: 5,         // standard 3x3
  halt: 5, harm: 5, hars: 5,
  hgra: 4,                            // gryphon aviary
  hhou: 3, hwtw: 3, hgtw: 3,         // small 2x2
  hatw: 3, hctw: 3,
  hvlt: 4, hshy: 4,                   // shops/shipyard
  haro: 6,                            // observatory
  // Orc
  ogre: 6, ostr: 6, ofrt: 6,         // town halls
  obar: 5, obea: 5, ofor: 5,         // standard
  osld: 5, otto: 5, oalt: 5,
  otrb: 3, owtw: 3,                  // small
  ovln: 4, oshy: 4,                   // shops/shipyard
  // Night Elf
  etol: 5, etoa: 5, etoe: 5,         // trees of life (actually 4x4 with roots)
  eaom: 5, eaow: 5, eaoe: 5,         // ancients
  eate: 5, edob: 5, eden: 5,
  edos: 5, etrp: 5,
  emow: 3,                            // moon well
  egol: 4, eshy: 4,                   // entangled mine/shipyard
  // Undead
  unpl: 7, unp1: 7, unp2: 7,         // necropolis (actually bigger)
  usep: 5, ugrv: 5, uaod: 5,         // standard
  uslh: 5, ubon: 5, utod: 5, usap: 5,
  uzig: 4, uzg1: 4, uzg2: 4,         // ziggurats
  utom: 4, ugol: 4, ushp: 4,         // tomb of relics/haunted mine/shipyard
};

// All possible snapshot slots in display order
const SNAPSHOT_SLOTS = [
  { tier: 1, label: 'Tier 1' },
  { tier: 2, label: 'Tier 2' },
  { label: 'Final' }
];

// Building footprint in WPM cells. Uses lookup table, falls back to collisionSize formula.
function getViewerWpmCells (itemId, collisionSize) {
  if (BUILDING_FOOTPRINT[itemId]) return BUILDING_FOOTPRINT[itemId];
  if (!collisionSize || collisionSize <= 50) return 4;
  return Math.max(3, Math.round(collisionSize / 28));
}

const BuildingPlacementViewer = class {
  constructor () {
    this.container = null;
    this.canvas = null;
    this.ctx = null;
    this.visible = false;
    this._icons = {};
    this._snapshots = [];
    this._activeIndex = 0;
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

  show (baseGrid, baseSnapshots, playerColor, neutralBuildings, mapImage, gameScaler, playerName, playerRace) {
    if (!baseGrid || !baseGrid.cells || !this.container) return;
    if (!baseSnapshots || !baseSnapshots.length) return;

    this._snapshots = baseSnapshots;
    this._baseParams = { baseGrid, playerColor, neutralBuildings, mapImage, gameScaler };

    // update header with player info
    const titleEl = this.container.querySelector('.placement-viewer-title');
    if (titleEl && playerName) {
      const RACE_ICONS = { 'O': 'ogre', 'H': 'htow', 'E': 'etol', 'U': 'unpl' };
      const iconId = RACE_ICONS[playerRace] || '';
      titleEl.innerHTML = (iconId ? '<img class="pv-race-icon" src="/assets/wc3icons/' + iconId + '.jpg" /> ' : '') +
        '<span class="pv-player-name" style="color:' + (playerColor || '#fff') + '">' + playerName + '</span>' +
        ' <span class="pv-title-sep">\u2014</span> Building Placement';
    }

    // default to last snapshot (Final)
    this._activeIndex = baseSnapshots.length - 1;

    // preload icons for all snapshots
    const itemIds = new Set();
    baseSnapshots.forEach(snap => {
      snap.buildings.forEach(b => itemIds.add(b.itemId));
    });
    if (neutralBuildings) neutralBuildings.forEach(nb => itemIds.add(nb.type || nb.itemId));

    let pending = 0;
    let loaded = 0;

    itemIds.forEach(id => {
      if (this._icons[id]) return;
      pending++;
      const img = new Image();
      img.onload = () => { this._icons[id] = img; loaded++; if (loaded === pending) this._doRender(); };
      img.onerror = () => { loaded++; if (loaded === pending) this._doRender(); };
      img.src = `/assets/wc3icons/${id}.jpg`;
    });

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
    const { baseGrid, playerColor, neutralBuildings, mapImage, gameScaler } = this._baseParams;
    const snapshot = this._snapshots[this._activeIndex];
    if (!snapshot) return;

    const { originX, originY, cellSize, cols, rows, cells } = baseGrid;

    // compute available canvas space from viewport (panel auto-sizes around canvas)
    const fixedH = 80; // header + controls + label + padding
    const availW = Math.floor(window.innerWidth * 0.90);
    const availH = Math.floor(window.innerHeight * 0.90 - fixedH);
    const cs = Math.max(PLACEMENT_MIN_CELL, Math.floor(Math.min(
      availW / cols,
      availH / rows
    )));

    const canvasW = cols * cs;
    const canvasH = rows * cs;
    this.canvas.width = canvasW;
    this.canvas.height = canvasH;

    const ctx = this.ctx;

    // --- Pass 1: Map background (treeless — trees drawn from data in pass 1.5) ---
    if (mapImage && gameScaler) {
      const ppu = gameScaler.pxPerUnit;
      const mapExtX = gameScaler.mapExtent.x;
      const mapExtY = gameScaler.mapExtent.y;

      const srcX = (originX - mapExtX[0]) * ppu;
      const srcY = (mapExtY[0] - originY) * ppu;
      const srcW = cols * cellSize * ppu;
      const srcH = rows * cellSize * ppu;

      ctx.drawImage(mapImage, srcX, srcY, srcW, srcH, 0, 0, canvasW, canvasH);
    } else {
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
          ctx.fillRect(c * cs, r * cs, cs, cs);
        }
      }
    }

    // --- Pass 1.5: Trees from baseGrid.trees, skipping building overlaps ---
    if (baseGrid.trees && baseGrid.trees.length) {
      const treeRgb = hexToRgb(baseGrid.treeColor || '#064006');

      baseGrid.trees.forEach(tree => {
        const gridCol = (tree.x - originX) / cellSize;
        const gridRow = (originY - tree.y) / cellSize;

        // skip trees outside visible area
        if (gridCol < -1 || gridCol >= cols + 1 || gridRow < -1 || gridRow >= rows + 1) return;

        // skip trees on cliff cells
        const cellR = Math.floor(gridRow);
        const cellC = Math.floor(gridCol);
        if (cellR >= 0 && cellR < rows && cellC >= 0 && cellC < cols && cells[cellR][cellC] === 0) return;

        // skip trees near any building in current snapshot (footprint + worker clearing buffer)
        const overlapsBuilding = snapshot.buildings.some(b => {
          const bCol = (b.x - originX) / cellSize;
          const bRow = (originY - b.y) / cellSize;
          const halfCells = getViewerWpmCells(b.itemId, b.collisionSize) / 2 + TREE_CLEAR_BUFFER;
          return Math.abs(gridCol - bCol) < halfCells && Math.abs(gridRow - bRow) < halfCells;
        });
        if (overlapsBuilding) return;

          const h1 = tileHash(tree.x, tree.y);
        const h2 = tileHash(tree.y, tree.x);

        const sizeVar = 1 + (h2 * 0.4 - 0.2);
        const radius = Math.max(5, (tree.s || 1) * cs * 1.7 * sizeVar);

        const jitterX = (h1 * 0.6 - 0.3) * cs;
        const jitterY = (h2 * 0.6 - 0.3) * cs;

        window.renderTree(ctx, gridCol * cs + jitterX, gridRow * cs + jitterY, radius, treeRgb, h1, h2);
      });

      ctx.globalAlpha = 1.0;
    }

    // --- Pass 2: Tile grid lines (128-unit = 4 WPM cells) ---
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 0.5;
    const tileOffsetCol = Math.ceil(((originX % 128) + 128) % 128 / cellSize);
    const tileOffsetRow = Math.ceil(((originY % 128) + 128) % 128 / cellSize);
    for (let c = tileOffsetCol; c < cols; c += 4) {
      ctx.beginPath();
      ctx.moveTo(c * cs, 0);
      ctx.lineTo(c * cs, canvasH);
      ctx.stroke();
    }
    for (let r = tileOffsetRow; r < rows; r += 4) {
      ctx.beginPath();
      ctx.moveTo(0, r * cs);
      ctx.lineTo(canvasW, r * cs);
      ctx.stroke();
    }

    // --- Pass 3: Neutral buildings (gold mines) ---
    if (neutralBuildings) {
      neutralBuildings.forEach(nb => {
        const nx = nb.x != null ? nb.x : (nb.lastPosition && nb.lastPosition.x);
        const ny = nb.y != null ? nb.y : (nb.lastPosition && nb.lastPosition.y);
        if (nx == null || ny == null) return;

        const gridCol = (nx - originX) / cellSize;
        const gridRow = (originY - ny) / cellSize;
        if (gridCol < -4 || gridCol >= cols + 4 || gridRow < -4 || gridRow >= rows + 4) return;

        const nbCells = 4;
        const half = nbCells / 2;
        const px = (gridCol - half) * cs;
        const py = (gridRow - half) * cs;
        const size = nbCells * cs;

        ctx.globalAlpha = 0.5;
        ctx.fillStyle = '#c8a030';
        ctx.fillRect(px, py, size, size);

        const iconId = nb.type || nb.itemId;
        if (this._icons[iconId]) {
          ctx.globalAlpha = 0.85;
          ctx.drawImage(this._icons[iconId], px + 1, py + 1, size - 2, size - 2);
        }

        ctx.globalAlpha = 1.0;
        ctx.strokeStyle = '#c8a030';
        ctx.lineWidth = 1;
        ctx.strokeRect(px, py, size, size);

        ctx.fillStyle = '#c8a030';
        ctx.font = `bold ${Math.max(8, cs)}px Arial`;
        ctx.textAlign = 'center';
        ctx.fillText('Gold Mine', px + size / 2, py + size + cs + 2);
        ctx.textAlign = 'left';
      });
    }

    // --- Pass 4: Player buildings from snapshot ---
    snapshot.buildings.forEach(b => {
      // snap building center to nearest grid cell
      const rawCol = (b.x - originX) / cellSize;
      const rawRow = (originY - b.y) / cellSize;
      const gridCol = Math.round(rawCol);
      const gridRow = Math.round(rawRow);

      const wpmCells = getViewerWpmCells(b.itemId, b.collisionSize);
      const halfCells = wpmCells / 2;

      const px = (gridCol - halfCells) * cs;
      const py = (gridRow - halfCells) * cs;
      const size = wpmCells * cs;

      const isInferred = b.isInferred;

      // subtle player-colored glow behind building
      if (!isInferred) {
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = playerColor || '#888';
        ctx.fillRect(px - 1, py - 1, size + 2, size + 2);
      }

      if (this._icons[b.itemId]) {
        ctx.globalAlpha = isInferred ? 0.3 : 0.9;
        ctx.drawImage(this._icons[b.itemId], px + 1, py + 1, size - 2, size - 2);
      } else {
        ctx.globalAlpha = isInferred ? 0.2 : 0.5;
        ctx.fillStyle = playerColor || '#888';
        ctx.fillRect(px, py, size, size);
      }

      ctx.globalAlpha = 1.0;
      ctx.lineWidth = 1;

      if (isInferred) {
        ctx.strokeStyle = '#666';
        ctx.setLineDash([3, 2]);
        ctx.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1);
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = playerColor || '#888';
        ctx.globalAlpha = 0.6;
        ctx.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1);
      }

      ctx.globalAlpha = 0.9;
      ctx.fillStyle = isInferred ? '#777' : '#ddd';
      const fontSize = Math.max(10, cs + 3);
      ctx.font = `bold ${fontSize}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const label = isInferred ? b.displayName + ' ?' : b.displayName;
      ctx.fillText(label, px + size / 2, py + size + 1);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    });

    ctx.globalAlpha = 1.0;
    ctx.lineWidth = 1;

    // snapshot label
    const labelEl = this.container.querySelector('.placement-viewer-label');
    if (labelEl) {
      const gt = snapshot.gameTime;
      const mins = Math.floor(gt / 60000);
      const secs = Math.floor((gt % 60000) / 1000);
      labelEl.textContent = `${snapshot.label} \u2014 ${mins}:${String(secs).padStart(2, '0')}`;
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
