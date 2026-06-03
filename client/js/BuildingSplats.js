/**
 * BuildingSplats — ground texture quads under buildings in the 3D scene.
 *
 * Renders a flat, semi-transparent textured plane at terrain height below
 * each building using real WC3 UberSplat textures extracted from CASC.
 * Textures live in /assets/textures/splats/{name}.png, converted from the
 * original DDS files in ReplaceableTextures\Splats.
 */
const BuildingSplats = class {
  constructor (threeRenderer) {
    this.threeRenderer = threeRenderer;
    this._splats = [];
    this._textures = {};
    this._ready = false;
  }

  // Map building itemId → splat texture name and size category.
  // From ubersplatdata.slk: HSMA/HMED/HLAR, OSMA/OMED/OLAR, etc.
  // NE ancients use a different texture than NE non-ancients.
  static BUILDING_SPLAT_MAP = {
    // Human — town halls get their own unique splats
    'htow': { tex: 'humantownhallubersplat', size: 'large' },
    'hkee': { tex: 'humantownhallubersplat', size: 'large' },
    'hcas': { tex: 'humancastleubersplat', size: 'large' },
    // Human — 3x3 buildings
    'halt': { tex: 'humanubersplat', size: 'medium' },
    'hbar': { tex: 'humanubersplat', size: 'medium' },
    'hbla': { tex: 'humanubersplat', size: 'medium' },
    'harm': { tex: 'humanubersplat', size: 'medium' },
    'hars': { tex: 'humanubersplat', size: 'medium' },
    'hlum': { tex: 'humanubersplat', size: 'medium' },
    'hgra': { tex: 'humanubersplat', size: 'medium' },
    // Human — 2x2 buildings
    'hhou': { tex: 'humanubersplat', size: 'small' },
    'hatw': { tex: 'humanubersplat', size: 'small' },
    'hwtw': { tex: 'humanubersplat', size: 'small' },
    'hgtw': { tex: 'humanubersplat', size: 'small' },
    'hctw': { tex: 'humanubersplat', size: 'small' },
    'hvlt': { tex: 'humanubersplat', size: 'small' },

    // Orc
    'ogre': { tex: 'orcubersplat', size: 'large' },
    'ostr': { tex: 'orcubersplat', size: 'large' },
    'ofrt': { tex: 'orcubersplat', size: 'large' },
    'oalt': { tex: 'orcubersplat', size: 'medium' },
    'obar': { tex: 'orcubersplat', size: 'medium' },
    'obea': { tex: 'orcubersplat', size: 'medium' },
    'ofor': { tex: 'orcubersplat', size: 'medium' },
    'oshy': { tex: 'orcubersplat', size: 'medium' },
    'otto': { tex: 'orcubersplat', size: 'medium' },
    'osld': { tex: 'orcubersplat', size: 'medium' },
    'otrb': { tex: 'orcubersplat', size: 'small' },
    'owtw': { tex: 'orcubersplat', size: 'small' },
    'ovln': { tex: 'orcubersplat', size: 'small' },

    // Night Elf — ancients use AncientUberSplat, non-ancients use NightElfUberSplat
    'etol': { tex: 'ancientubersplat', size: 'large' },
    'etoa': { tex: 'ancientubersplat', size: 'large' },
    'etoe': { tex: 'ancientubersplat', size: 'large' },
    'eaow': { tex: 'ancientubersplat', size: 'medium' },
    'eaom': { tex: 'ancientubersplat', size: 'medium' },
    'eaoe': { tex: 'ancientubersplat', size: 'medium' },
    'etrp': { tex: 'ancientubersplat', size: 'small' },
    'eate': { tex: 'nightelfubersplat', size: 'medium' },
    'edob': { tex: 'nightelfubersplat', size: 'medium' },
    'eden': { tex: 'nightelfubersplat', size: 'medium' },
    'emow': { tex: 'nightelfubersplat', size: 'small' },

    // Undead
    'unpl': { tex: 'undeadubersplat', size: 'large' },
    'unp1': { tex: 'undeadubersplat', size: 'large' },
    'unp2': { tex: 'undeadubersplat', size: 'large' },
    'uaod': { tex: 'undeadubersplat', size: 'medium' },
    'usep': { tex: 'undeadubersplat', size: 'medium' },
    'ugrv': { tex: 'undeadubersplat', size: 'medium' },
    'utod': { tex: 'undeadubersplat', size: 'medium' },
    'uslh': { tex: 'undeadubersplat', size: 'medium' },
    'ubon': { tex: 'undeadubersplat', size: 'medium' },
    'uzig': { tex: 'undeadubersplat', size: 'small' },
    'uzg1': { tex: 'undeadubersplat', size: 'small' },
    'uzg2': { tex: 'undeadubersplat', size: 'small' },
    'utom': { tex: 'undeadubersplat', size: 'small' },
    'ugol': { tex: 'undeadubersplat', size: 'medium' },

    // Neutral
    'ngol': { tex: 'goldmineubersplat', size: 'medium' },
  };

  // Splat size in world units — thin ring barely past building edge.
  // Building footprints: 2-tile=256, 3-tile=384, 4-tile=512 world units.
  static SIZE_SCALE = {
    'small': 200,
    'medium': 300,
    'large': 400
  };

  // Fallback: derive race from itemId prefix
  static fallbackSplat (itemId) {
    if (!itemId) return { tex: 'dirtubersplat', size: 'small' };
    const c = itemId.charAt(0).toLowerCase();
    const raceMap = {
      'h': 'humanubersplat',
      'o': 'orcubersplat',
      'e': 'nightelfubersplat',
      'u': 'undeadubersplat'
    };
    return { tex: raceMap[c] || 'dirtubersplat', size: 'small' };
  }


  /**
   * Load all splat textures, then create ground quads.
   * @param {Array} playerBuildings — threeRenderer._playerBuildings entries
   * @param {Array} neutralBuildings — [{type, x, y}] from neutralBuildings.json
   */
  setup (playerBuildings, neutralBuildings) {
    this.dispose();

    if (!this.threeRenderer.ready) return;

    // Collect unique texture names needed
    const neededTextures = new Set();
    if (playerBuildings) {
      for (const b of playerBuildings) {
        const info = BuildingSplats.BUILDING_SPLAT_MAP[b.itemId] || BuildingSplats.fallbackSplat(b.itemId);
        neededTextures.add(info.tex);
      }
    }
    if (neutralBuildings) {
      for (const nb of neutralBuildings) {
        const info = BuildingSplats.BUILDING_SPLAT_MAP[nb.type] || BuildingSplats.fallbackSplat(nb.type);
        neededTextures.add(info.tex);
      }
    }

    // Load textures
    const loader = new THREE.TextureLoader();
    const loadPromises = [];
    for (const texName of neededTextures) {
      loadPromises.push(new Promise(resolve => {
        loader.load(
          `/assets/textures/splats/${texName}.png`,
          (tex) => {
            tex.wrapS = THREE.ClampToEdgeWrapping;
            tex.wrapT = THREE.ClampToEdgeWrapping;
            this._textures[texName] = tex;
            resolve();
          },
          undefined,
          () => { resolve(); } // skip on error
        );
      }));
    }

    Promise.all(loadPromises).then(() => {
      this._createAllSplats(playerBuildings, neutralBuildings);
    });
  }

  _createAllSplats (playerBuildings, neutralBuildings) {
    const ext = this.threeRenderer.mapInfo.bounds.map;
    const mapCenterX = (ext[0][0] + ext[0][1]) / 2;
    const mapCenterY = (ext[1][0] + ext[1][1]) / 2;

    // Player buildings
    if (playerBuildings) {
      for (const b of playerBuildings) {
        const info = BuildingSplats.BUILDING_SPLAT_MAP[b.itemId] || BuildingSplats.fallbackSplat(b.itemId);
        const worldSize = BuildingSplats.SIZE_SCALE[info.size] || 280;
        this._createSplat(b.wx, b.wy, worldSize, info.tex, mapCenterX, mapCenterY, b.readyTime, b.destroyedAt);
      }
    }

    // Neutral buildings (always visible)
    if (neutralBuildings) {
      for (const nb of neutralBuildings) {
        const info = BuildingSplats.BUILDING_SPLAT_MAP[nb.type] || BuildingSplats.fallbackSplat(nb.type);
        const worldSize = BuildingSplats.SIZE_SCALE[info.size] || 280;
        this._createSplat(nb.x, nb.y, worldSize, info.tex, mapCenterX, mapCenterY, 0, null);
      }
    }

    this._ready = true;
    this.threeRenderer.requestRender();
  }

  _createSplat (wx, wy, worldSize, texName, mapCenterX, mapCenterY, readyTime, destroyedAt) {
    const tex = this._textures[texName];
    if (!tex) return; // texture failed to load

    const geo = new THREE.PlaneGeometry(worldSize, worldSize);

    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geo, mat);
    const groundY = this.threeRenderer.sampleHeight(wx, wy);
    mesh.position.set(
      wx - mapCenterX,
      groundY + 16,
      -(wy - mapCenterY)
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = -1;

    // Neutral buildings always visible; player buildings start hidden
    mesh.visible = (readyTime === 0);
    this.threeRenderer.scene.add(mesh);

    this._splats.push({
      mesh,
      wx,
      wy,
      readyTime,
      destroyedAt,
      isNeutral: (readyTime === 0)
    });
  }

  /**
   * Capture current splat visibility so a base snapshot render can be undone.
   * @returns {boolean[]} per-splat visibility, index-aligned to this._splats
   */
  captureVisibility () {
    return this._splats.map(s => s.mesh.visible);
  }

  /**
   * Restore splat visibility captured by captureVisibility().
   * @param {boolean[]} saved
   */
  restoreVisibility (saved) {
    if (!saved) return;
    for (let i = 0; i < this._splats.length; i++) {
      if (this._splats[i]) this._splats[i].mesh.visible = !!saved[i];
    }
  }

  /**
   * Show only the splats under a snapshot's buildings. Player splats are
   * hidden unless they match a snapshot building by position; neutral splats
   * (readyTime === 0, e.g. gold mine) stay visible as in the live scene.
   * @param {Array} snapshotBuildings — [{itemId, x, y}]
   */
  showOnlyForSnapshot (snapshotBuildings) {
    for (const s of this._splats) {
      if (s.isNeutral) continue; // neutral — leave visible
      let match = false;
      for (const sb of snapshotBuildings) {
        if (Math.abs(s.wx - sb.x) < 10 && Math.abs(s.wy - sb.y) < 10) {
          match = true;
          break;
        }
      }
      s.mesh.visible = match;
    }
  }

  /**
   * Mirror building visibility: show splat when building is visible.
   * @param {number} gameTime — current replay time in ms
   */
  updateVisibility (gameTime) {
    if (!this._ready) return;

    let changed = false;
    for (const s of this._splats) {
      // Neutral buildings (readyTime === 0) are always visible
      if (s.readyTime === 0) continue;

      const visible = gameTime >= s.readyTime && (!s.destroyedAt || gameTime < s.destroyedAt);
      if (s.mesh.visible !== visible) {
        s.mesh.visible = visible;
        changed = true;
      }
    }
    if (changed) this.threeRenderer.requestRender();
  }

  dispose () {
    for (const s of this._splats) {
      this.threeRenderer.scene.remove(s.mesh);
      s.mesh.geometry.dispose();
      s.mesh.material.dispose();
    }
    this._splats = [];

    for (const key of Object.keys(this._textures)) {
      this._textures[key].dispose();
    }
    this._textures = {};
    this._ready = false;
  }
};

window.BuildingSplats = BuildingSplats;
