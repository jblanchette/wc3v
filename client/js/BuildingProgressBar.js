/**
 * BuildingProgressBar — 3D floating progress bars above buildings during construction.
 *
 * Uses a canvas texture for the fill bar with diagonal stripes for visibility.
 * White-on-black dual border makes it pop against any terrain.
 */
const BuildingProgressBar = class {
  constructor (threeRenderer) {
    this.threeRenderer = threeRenderer;
    this._bars = [];
    this._stripeTex = null;
  }

  /**
   * Generate a diagonal-striped canvas texture for the fill bar.
   * Bright yellow-green stripes on a darker green background.
   */
  static createStripeTexture () {
    const w = 128, h = 32;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    // Base fill — bright green-yellow
    ctx.fillStyle = '#55dd33';
    ctx.fillRect(0, 0, w, h);

    // Diagonal stripes — lighter accent
    ctx.strokeStyle = '#88ff55';
    ctx.lineWidth = 6;
    for (let x = -h; x < w + h; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x + h, 0);
      ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }

  /**
   * Pre-create bar meshes for all buildings that have a construction window.
   */
  setup (playerBuildings, unitBalance) {
    this.dispose();

    if (!playerBuildings || !unitBalance) return;

    const BAR_WIDTH = 250;
    const BAR_HEIGHT = 22;
    const BAR_DEPTH = 4;
    const Y_OFFSET = 260;

    this._stripeTex = BuildingProgressBar.createStripeTexture();

    const ext = this.threeRenderer.mapInfo.bounds.map;
    const mapCenterX = (ext[0][0] + ext[0][1]) / 2;
    const mapCenterY = (ext[1][0] + ext[1][1]) / 2;

    for (const b of playerBuildings) {
      const balance = unitBalance[b.itemId];
      if (!balance || !balance.buildTime) continue;

      const constructionEndTime = b.readyTime + balance.buildTime * 1000;
      if (constructionEndTime - b.readyTime < 500) continue;

      const group = new THREE.Group();
      group.userData.isBuildingProgressBar = true;

      // Outer border — white
      const outerBorder = new THREE.Mesh(
        new THREE.BoxGeometry(BAR_WIDTH + 12, BAR_HEIGHT + 12, BAR_DEPTH - 2),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false })
      );
      outerBorder.renderOrder = 997;
      group.add(outerBorder);

      // Inner border — black
      const innerBorder = new THREE.Mesh(
        new THREE.BoxGeometry(BAR_WIDTH + 6, BAR_HEIGHT + 6, BAR_DEPTH - 1),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.95, depthTest: false })
      );
      innerBorder.renderOrder = 998;
      group.add(innerBorder);

      // Background bar — dark
      const bg = new THREE.Mesh(
        new THREE.BoxGeometry(BAR_WIDTH, BAR_HEIGHT, BAR_DEPTH),
        new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.85, depthTest: false })
      );
      bg.renderOrder = 999;
      group.add(bg);

      // Fill bar — striped texture, anchored at left edge
      const fillGeo = new THREE.BoxGeometry(BAR_WIDTH, BAR_HEIGHT, BAR_DEPTH + 1);
      fillGeo.translate(BAR_WIDTH / 2, 0, 0); // pivot at left edge
      const fillMat = new THREE.MeshBasicMaterial({
        map: this._stripeTex,
        transparent: true,
        opacity: 0.95,
        depthTest: false
      });
      const fill = new THREE.Mesh(fillGeo, fillMat);
      fill.position.x = -BAR_WIDTH / 2;
      fill.renderOrder = 1000;
      fill.scale.x = 0.001;
      group.add(fill);

      // Position above the building
      const groundY = this.threeRenderer.sampleHeight(b.wx, b.wy);
      group.position.set(
        b.wx - mapCenterX,
        groundY + Y_OFFSET,
        -(b.wy - mapCenterY)
      );

      group.visible = false;
      this.threeRenderer.scene.add(group);

      this._bars.push({
        group,
        fill,
        readyTime: b.readyTime,
        constructionEndTime,
        barWidth: BAR_WIDTH
      });
    }
  }

  /**
   * Update bar visibility and fill progress each frame.
   */
  update (gameTime) {
    if (!this._bars.length) return;

    const camera = this.threeRenderer.camera;
    let changed = false;

    for (const bar of this._bars) {
      const inConstruction = gameTime >= bar.readyTime && gameTime < bar.constructionEndTime;

      if (bar.group.visible !== inConstruction) {
        bar.group.visible = inConstruction;
        changed = true;
      }

      if (inConstruction) {
        const progress = Math.min(1, Math.max(0,
          (gameTime - bar.readyTime) / (bar.constructionEndTime - bar.readyTime)
        ));
        bar.fill.scale.x = Math.max(0.001, progress);

        // Animate stripe scroll
        if (this._stripeTex) {
          this._stripeTex.offset.x = (gameTime * 0.0005) % 1;
        }

        // Billboard: face the camera
        if (camera) {
          bar.group.quaternion.copy(camera.quaternion);
        }
      }
    }

    if (changed) this.threeRenderer.requestRender();
  }

  dispose () {
    for (const bar of this._bars) {
      this.threeRenderer.scene.remove(bar.group);
      bar.group.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }
    this._bars = [];
    if (this._stripeTex) {
      this._stripeTex.dispose();
      this._stripeTex = null;
    }
  }
};

window.BuildingProgressBar = BuildingProgressBar;
