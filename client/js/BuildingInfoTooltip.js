/**
 * BuildingInfoTooltip — rich tooltip panel shown when hovering buildings.
 *
 * Shows building name, and for production buildings a grid of unit/upgrade
 * icons that the building can produce. Uses the same icon path pattern as
 * ClientUnit: /assets/wc3icons/{itemId}.jpg
 */
const BuildingInfoTooltip = class {
  constructor () {
    this.el = document.getElementById('building-info-tooltip');
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.id = 'building-info-tooltip';
      document.body.appendChild(this.el);
    }
    this._visible = false;
  }

  /**
   * Show tooltip for a building hit.
   * @param {Object} hit — {displayName, itemId, playerColor, playerId}
   * @param {number} mouseX — offsetX from mouse event
   * @param {number} mouseY — offsetY from mouse event
   * @param {HTMLElement} target — the canvas element
   */
  show (hit, mouseX, mouseY, target) {
    const production = BUILDING_PRODUCTION[hit.itemId];
    const buildingName = (production && production.label) || hit.displayName || hit.itemId;
    const playerColor = hit.playerColor || '#cccccc';
    // Helpers: replay-derived strings (hit.itemId, hit.displayName) and
    // CSS color tokens flow into innerHTML below.
    const _esc = (s) => Security.escapeHtml(Security.sanitizeUserText(s));
    const _icon = (id) => /^[A-Za-z0-9_\-]{1,32}$/.test(String(id == null ? '' : id)) ? id : '';
    const _color = (s) => /^#[0-9A-Fa-f]{3,8}$|^rgb[a]?\([0-9.,\s%]+\)$|^[a-zA-Z]{1,20}$/.test(String(s)) ? s : '#cccccc';

    let html = '';

    // Header: building icon + name
    html += '<div class="bit-header">';
    html += `<img class="bit-icon" src="/assets/wc3icons/${_icon(hit.itemId)}.jpg" onerror="this.style.display='none'" />`;
    html += `<span class="bit-name" style="border-bottom: 2px solid ${_color(playerColor)}">${_esc(buildingName)}</span>`;
    html += '</div>';

    if (production) {
      // Type badge
      const typeLabels = {
        production: 'Trains',
        altar: 'Heroes',
        research: 'Upgrades',
        shop: 'Items',
        goldmine: 'Gold Mine',
        fountain: 'Restoration',
        supply: 'Supply',
        tower: 'Defense'
      };
      const typeLabel = typeLabels[production.type] || '';

      if (production.units && production.units.length) {
        html += `<div class="bit-section-label">${typeLabel}</div>`;
        html += '<div class="bit-icon-grid">';
        for (const unitId of production.units) {
          const safe = _icon(unitId);
          html += `<img class="bit-grid-icon" src="/assets/wc3icons/${safe}.jpg" title="${safe}" onerror="this.style.display='none'" />`;
        }
        html += '</div>';
      }

      if (production.upgrades && production.upgrades.length) {
        html += '<div class="bit-section-label">Upgrades</div>';
        html += '<div class="bit-icon-grid">';
        for (const upId of production.upgrades) {
          const safe = _icon(upId);
          html += `<img class="bit-grid-icon" src="/assets/wc3icons/${safe}.jpg" title="${safe}" onerror="this.style.display='none'" />`;
        }
        html += '</div>';
      }

      if (production.items && production.items.length) {
        html += `<div class="bit-section-label">${typeLabel}</div>`;
        html += '<div class="bit-icon-grid">';
        for (const itemId of production.items) {
          const safe = _icon(itemId);
          html += `<img class="bit-grid-icon" src="/assets/wc3icons/${safe}.jpg" title="${safe}" onerror="this.style.display='none'" />`;
        }
        html += '</div>';
      }

      if (production.type === 'supply') {
        html += '<div class="bit-type-badge">+Food</div>';
      } else if (production.type === 'tower') {
        html += '<div class="bit-type-badge">Defense</div>';
      } else if (production.type === 'goldmine') {
        html += '<div class="bit-type-badge">12500 Gold</div>';
      } else if (production.type === 'fountain') {
        html += '<div class="bit-type-badge">Regeneration</div>';
      }
    }

    this.el.innerHTML = html;
    this._position(mouseX, mouseY, target);
    this.el.classList.add('visible');
    this._visible = true;
  }

  reposition (mouseX, mouseY, target) {
    if (this._visible) {
      this._position(mouseX, mouseY, target);
    }
  }

  _position (mouseX, mouseY, target) {
    const drawBounds = target.getBoundingClientRect();
    const canvasW = drawBounds ? drawBounds.width : target.clientWidth;
    const canvasH = drawBounds ? drawBounds.height : target.clientHeight;
    const gap = 14;

    // Measure the tooltip to position correctly
    const popW = this.el.offsetWidth || 200;
    const popH = this.el.offsetHeight || 100;

    let popX = mouseX + gap + drawBounds.left;
    let popY = mouseY + gap + drawBounds.top;

    // Flip horizontally if overflows right
    if (popX + popW > drawBounds.left + canvasW) {
      popX = mouseX - popW - gap + drawBounds.left;
    }
    if (popX < drawBounds.left) popX = drawBounds.left + gap;

    // Flip vertically if overflows bottom
    if (popY + popH > drawBounds.top + canvasH) {
      popY = mouseY - popH - gap + drawBounds.top;
    }
    if (popY < drawBounds.top) popY = drawBounds.top + gap;

    this.el.style.left = `${popX}px`;
    this.el.style.top = `${popY}px`;
  }

  hide () {
    this.el.classList.remove('visible');
    this._visible = false;
  }
};

window.BuildingInfoTooltip = BuildingInfoTooltip;
