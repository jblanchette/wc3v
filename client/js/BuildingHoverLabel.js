/**
 * BuildingHoverLabel — hover detection over buildings on the map canvas.
 *
 * Builds an RBush spatial index from frameData.buildingPositions each render
 * frame, hit-tests on mousemove, and delegates to BuildingInfoTooltip for
 * rich tooltip display.
 */
const BuildingHoverLabel = class {
  constructor (tooltip, canvasEl) {
    this.tooltip = tooltip; // BuildingInfoTooltip instance
    this.canvas = canvasEl; // the actual canvas element for coordinate transforms
    this._tree = null;
    this._hoveredItemId = null;
  }

  /**
   * Rebuild spatial index from current frame's building positions.
   * Called once per render frame. Cheap for < 50 buildings.
   * @param {Array} buildingPositions — from frameData.buildingPositions
   */
  buildIndex (buildingPositions) {
    if (!buildingPositions || !buildingPositions.length) {
      if (this._tree) this._tree.clear();
      return;
    }

    if (!this._tree) this._tree = rbush();
    else this._tree.clear();

    if (!this._entryPool) this._entryPool = [];
    const pool = this._entryPool;
    const needed = buildingPositions.length;

    // Grow pool if needed, reuse existing objects
    while (pool.length < needed) {
      pool.push({ minX: 0, maxX: 0, minY: 0, maxY: 0, displayName: '', itemId: '', playerColor: '', playerId: '' });
    }

    for (let i = 0; i < needed; i++) {
      const bp = buildingPositions[i];
      const entry = pool[i];
      entry.minX = bp.x - bp.halfSize;
      entry.maxX = bp.x + bp.halfSize;
      entry.minY = bp.y - bp.halfSize;
      entry.maxY = bp.y + bp.halfSize;
      entry.displayName = bp.displayName;
      entry.itemId = bp.itemId;
      entry.playerColor = bp.playerColor;
      entry.playerId = bp.playerId;
    }

    this._tree.load(pool.slice(0, needed));
  }

  /**
   * Handle mousemove events. Same coordinate transform pattern as GameDisplayBox.
   * @param {Event} e — the raw mouse event
   * @param {Object} transform — d3 zoom transform {x, y, k}
   * @returns {boolean} true if a building is hovered (so caller can skip camp hover)
   */
  handleMouse (e, transform) {
    if (!this._tree || !e || !transform) {
      this._clear();
      return false;
    }

    // Use the stored canvas element for coordinate mapping (e.target may be
    // a parent div like #canvas-group where .width is undefined)
    const canvas = this.canvas;
    if (!canvas) return false;

    const { offsetX, offsetY } = e;
    if (offsetX === undefined || offsetY === undefined) return false;

    // Convert CSS pixels to canvas pixels, then to canvas-space
    const scaleX = canvas.width / (canvas.clientWidth || canvas.width);
    const scaleY = canvas.height / (canvas.clientHeight || canvas.height);
    const screenX = offsetX * scaleX;
    const screenY = offsetY * scaleY;
    const canvasX = (screenX - transform.x) / transform.k;
    const canvasY = (screenY - transform.y) / transform.k;

    const hits = this._tree.search({
      minX: canvasX, maxX: canvasX,
      minY: canvasY, maxY: canvasY
    });

    if (hits.length) {
      const hit = hits[0];

      // Same building already shown
      if (this._hoveredItemId === hit.itemId + '_' + hit.playerId) {
        // Update tooltip position
        this.tooltip.reposition(offsetX, offsetY, canvas);
        return true;
      }

      this._hoveredItemId = hit.itemId + '_' + hit.playerId;
      this.tooltip.show(hit, offsetX, offsetY, canvas);
      return true;
    }

    this._clear();
    return false;
  }

  _clear () {
    if (this._hoveredItemId) {
      this._hoveredItemId = null;
      this.tooltip.hide();
    }
  }

  hide () {
    this._clear();
  }
};

window.BuildingHoverLabel = BuildingHoverLabel;
