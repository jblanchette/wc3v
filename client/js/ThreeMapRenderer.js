/*
  ThreeMapRenderer — WebGL terrain renderer for wc3v.
  Replaces the old 2D MapRenderer background pass with a real heightmapped
  mesh, lit by a directional light. Units still render via 2D canvas overlays
  on top (see #player-canvas / #utility-canvas).

  Coordinate mapping (M1, orthographic top-down):
    - Three.js world X maps directly to WC3 world X.
    - Three.js world Z maps directly to -WC3 world Y (WC3 y-up-in-image becomes
      z-into-screen so that a top-down ortho camera looking down -Y in Three
      matches the 2D canvas orientation).
    - Three.js world Y is terrain elevation (displaced from W3E groundHeight,
      normalized and rescaled).
    - Ortho camera bounds match the d3 zoom transform (transform.k, transform.x,
      transform.y) so the 3D view lines up 1:1 with the 2D unit overlay.
*/
(function () {
  // Canonical WC3 terrain constants (HiveWE / W3E format spec).
  // Per-corner editor-height formula:
  //   worldY = ((groundHeight - 0x2000) + (layer - 2) * 0x0200) / 4
  // Per-corner water height:
  //   waterWorldY = (waterLevel - 0x2000) / 4 - 89.6
  // Output is already in WC3 world units (same space as unit positions), so
  // there is no separate TERRAIN_Y_SCALE — 1 layer step = 128 world units
  // vertically, which is exactly the map's 128-unit tile width.
  const GROUND_BASELINE = 0x2000;
  const LAYER_ZERO      = 2;
  const LAYER_STEP_RAW  = 0x0200;
  const WATER_BIAS      = -89.6;
  const CAMERA_TILT_DEG = 32;     // closer to WC3's overhead gameplay view
  // Raw W3E heights, no scaling or boost. The formula output is exactly
  // what the map file encodes.
  const FINE_HEIGHT_BOOST = 1.0;
  const LAYER_HEIGHT_SCALE = 1.0;

  // Water color gradient by depth (HiveWE water.vert spec).
  // Depth thresholds in tile-space units (1 tile = 128 world units):
  //   min_depth  = 10/128  — minimum visible water depth
  //   deeplevel  = 64/128  — shallow→deep color transition
  //   maxdepth   = 72/128  — maximum depth before clamp
  // Convert to world units for our renderer:
  const WATER_MIN_DEPTH  = 10;    // 10/128 * 128 = 10 world units
  const WATER_DEEP_LEVEL = 64;    // shallow→deep transition
  const WATER_MAX_DEPTH  = 72;    // clamp depth

  // Per-tileset water colors from water.slk (Smin/Smax/Dmin/Dmax RGBA).
  // HiveWE multiplies animated water texture by these vertex colors.
  // We use only the RGB as surface tint; alpha controls opacity.
  // Format: [R, G, B, A] each 0-255.
  const WATER_COLORS = {
    L: { smin: [255,255,255,10], smax: [117,117,200,219], dmin: [117,117,200,219], dmax: [96,96,192,250] },
    V: { smin: [255,255,255,10], smax: [117,117,200,219], dmin: [117,117,200,219], dmax: [96,96,192,250] },
    F: { smin: [255,255,255,10], smax: [117,117,200,219], dmin: [117,117,200,219], dmax: [96,96,192,250] },
    Q: { smin: [255,255,255,10], smax: [117,117,200,219], dmin: [117,117,200,219], dmax: [96,96,192,250] },
    Z: { smin: [255,255,255,10], smax: [117,117,200,219], dmin: [117,117,200,219], dmax: [96,96,192,250] },
    Y: { smin: [255,255,255,10], smax: [117,117,200,219], dmin: [117,117,200,219], dmax: [96,96,192,250] },
    W: { smin: [255,255,255,10], smax: [117,117,200,219], dmin: [117,117,200,219], dmax: [96,96,192,250] },
    N: { smin: [255,255,255,10], smax: [240,240,240,219], dmin: [117,117,117,219], dmax: [150,180,220,180] },
    I: { smin: [255,255,255,10], smax: [240,240,240,219], dmin: [117,117,117,219], dmax: [150,180,220,180] },
    X: { smin: [230,230,230,10], smax: [240,240,240,219], dmin: [255,255,255,219], dmax: [255,255,255,250] },
    A: { smin: [100,100,100,10], smax: [150,150,255,150], dmin: [200,255,255,219], dmax: [150,150,150,250] },
    C: { smin: [200,255,255,10], smax: [200,255,255,219], dmin: [200,255,255,219], dmax: [255,255,255,250] },
    B: { smin: [255,255,255,10], smax: [200,117,200,255], dmin: [117,117,255,219], dmax: [255,255,255,250] },
    D: { smin: [255,255,255,10], smax: [255,255,255,180], dmin: [255,255,255,219], dmax: [255,255,255,250] },
    K: { smin: [255,255,255,10], smax: [255,255,255,180], dmin: [255,255,255,219], dmax: [255,255,255,250] },
    J: { smin: [255,255,255,10], smax: [255,255,255,180], dmin: [255,255,255,219], dmax: [255,255,255,250] },
    G: { smin: [100,200,150,10], smax: [150,255,250,150], dmin: [200,255,250,219], dmax: [150,250,190,250] },
    O: { smin: [0,0,0,255],     smax: [0,0,0,255],       dmin: [0,0,0,255],       dmax: [0,0,0,255] }
  };

  // Per-tileset tree foliage colors (from helpers/tilesetColors.js TILESET_EXTRAS.trees).
  const TILESET_TREE_COLORS = {
    L: '#1a5820', V: '#1a5820', F: '#28400a', X: '#28400a',
    W: '#1a3830', N: '#1a4030', I: '#143828', A: '#062810',
    C: '#10200a', B: '#385018', D: '#1a2a1a', G: '#142014',
    K: '#1a2a1a', J: '#1a2028', Y: '#062828', Z: '#103018',
    Q: '#284018', O: '#283818'
  };

  function getWaterColors (tilesetChar) {
    const wc = WATER_COLORS[tilesetChar] || WATER_COLORS.L;
    const toLinear = (rgba) => {
      const c = new THREE.Color(rgba[0] / 255, rgba[1] / 255, rgba[2] / 255).convertSRGBToLinear();
      return { r: c.r, g: c.g, b: c.b, a: rgba[3] / 255 };
    };
    return {
      smin: toLinear(wc.smin),
      smax: toLinear(wc.smax),
      dmin: toLinear(wc.dmin),
      dmax: toLinear(wc.dmax)
    };
  }

  function w3eGroundY (rawGround, layer) {
    // Two components computed separately:
    //   fine = per-corner groundHeight variation within a layer (bumps)
    //   step = discrete cliff-layer offset (real hills)
    // FINE_HEIGHT_BOOST = 0 kills bumps entirely so tops are flat.
    // LAYER_HEIGHT_SCALE multiplies the cliff step for dramatic elevation.
    const fine = (rawGround - GROUND_BASELINE) / 4;
    const step = (layer - LAYER_ZERO) * LAYER_STEP_RAW / 4;
    return fine * FINE_HEIGHT_BOOST + step * LAYER_HEIGHT_SCALE;
  }
  function w3eWaterY (rawWater) {
    return (rawWater - GROUND_BASELINE) / 4 + WATER_BIAS;
  }

  // sRGB → linear conversion for vertex color inputs. Three.js r152+ assumes
  // values in BufferAttributes are already linear; palette hex values are
  // sRGB, so without this conversion they render too dark / muddy.
  function srgbToLinear (c) {
    // c in [0,1]
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  // Deterministic value-noise helpers (ported from tools/regen-maps.js) used
  // to jitter per-vertex color so same-palette tile regions don't look like
  // solid blocks. Zero dependencies, seeded on integer coords.
  function tileHash (col, row) {
    let h = (col * 374761393 + row * 668265263) | 0;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) & 0xFF) / 255.0;
  }
  function smoothstep (t) { return t * t * (3 - 2 * t); }
  function valueNoise (x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = smoothstep(x - x0);
    const fy = smoothstep(y - y0);
    const v00 = tileHash(x0, y0);
    const v10 = tileHash(x0 + 1, y0);
    const v01 = tileHash(x0, y0 + 1);
    const v11 = tileHash(x0 + 1, y0 + 1);
    const a = v00 * (1 - fx) + v10 * fx;
    const b = v01 * (1 - fx) + v11 * fx;
    return a * (1 - fy) + b * fy;
  }
  // Returns ~ -1..1 (roughly). 3 octaves is enough to break up flat regions.
  function fbm (x, y) {
    let sum = 0, amp = 1, freq = 1, total = 0;
    for (let o = 0; o < 3; o++) {
      sum += (valueNoise(x * freq, y * freq) - 0.5) * 2 * amp;
      total += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / total;
  }

  class ThreeMapRenderer {
    constructor (canvas, viewer) {
      this.canvas = canvas;
      this.viewer = viewer;
      this.ready = false;

      this.renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: false
      });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setClearColor(0x0b1014, 1);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x0b1014);

      // Perspective camera — tilted for broadcast-style 3/4 view.
      // Initial framing is refined in setupTerrain() once map bounds are known.
      this.camera = new THREE.PerspectiveCamera(35, 1, 1, 50000);
      this.camera.position.set(0, 8000, 0);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(0, 0, 0);

      // Lighting rig — strong directional sun + high ambient fill for a
      // bright, cartoony WC3 feel. Directional intensity pushed high so
      // cliff shading still reads under the saturated ambient.
      const sun = new THREE.DirectionalLight(0xfff1c4, 1.6);
      sun.position.set(-1200, 3000, -1200);
      sun.target.position.set(0, 0, 0);
      this.scene.add(sun);
      this.scene.add(sun.target);
      this.sun = sun;

      // Fill light — opposite angle from sun for softer shadows
      const fill = new THREE.DirectionalLight(0xc4d8ff, 0.3);
      fill.position.set(1200, 2000, 1200);
      fill.target.position.set(0, 0, 0);
      this.scene.add(fill);
      this.scene.add(fill.target);

      const ambient = new THREE.AmbientLight(0xe8ebe3, 1.25);
      this.scene.add(ambient);
      const hemi = new THREE.HemisphereLight(0xbfd8ec, 0x6b5a3a, 0.35);
      this.scene.add(hemi);

      // placeholders
      this.terrainMesh = null;
      this.waterMesh = null;
      this.heightData = null;
      this.mapTexture = null;
    }

    // Load binary heightmap from /maps/{name}/heights.bin.gz.
    // Returns a promise resolving to { cols, rows, minH, maxH, ground: Float32Array, water: Float32Array }.
    loadHeights (mapName) {
      const url = `/maps/${mapName}/heights.bin.gz`;
      return fetch(url).then(res => {
        if (!res.ok) throw new Error(`heights fetch ${res.status}`);
        return res.arrayBuffer();
      }).then(buf => {
        // Browser fetch decompresses .gz automatically when served with
        // Content-Encoding: gzip. Express's `static` middleware doesn't do
        // that by default, so we also handle the raw-gzip case here.
        let bytes = new Uint8Array(buf);
        const isGzip = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
        if (isGzip) {
          // inflate using DecompressionStream (supported in all modern browsers)
          return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')))
            .arrayBuffer()
            .then(ab => this._parseHeights(ab));
        }
        return this._parseHeights(buf);
      });
    }

    _parseHeights (ab) {
      const view = new DataView(ab);
      const magic = view.getUint32(0, true);
      const version = view.getUint32(4, true);
      if (magic !== 0x57334831 || (version !== 4 && version !== 5)) {
        throw new Error(`heights.bin bad magic/version: ${magic.toString(16)}/${version} (want v4 or v5)`);
      }
      const cols = view.getUint32(8, true);
      const rows = view.getUint32(12, true);
      const numPalettes = view.getUint32(16, true);
      const total = cols * rows;

      // Read ground palette codes (4-char ASCII entries starting at byte 20)
      const paletteCodes = [];
      const td = new TextDecoder('ascii');
      let cursor = 20;
      for (let i = 0; i < numPalettes; i++) {
        const bytes = new Uint8Array(ab, cursor, 4);
        paletteCodes.push(td.decode(bytes).trim());
        cursor += 4;
      }

      // v5 adds cliff palette codes after ground palettes
      const cliffPaletteCodes = [];
      if (version >= 5) {
        const numCliffPalettes = view.getUint32(cursor, true);
        cursor += 4;
        for (let i = 0; i < numCliffPalettes; i++) {
          const bytes = new Uint8Array(ab, cursor, 4);
          cliffPaletteCodes.push(td.decode(bytes).trim());
          cursor += 4;
        }
      }

      // Header size, aligned to 2 for the int16 arrays that follow.
      let headerBytes = cursor;
      if (headerBytes % 2 !== 0) headerBytes++;

      const groundOff    = headerBytes;
      const waterOff     = groundOff + total * 2;
      const flagsOff     = waterOff + total * 2;
      const layerOff     = flagsOff + total * 1;
      const rgbOff       = layerOff + total * 1;
      const palIdxOff    = rgbOff + total * 3;

      const ground     = new Int16Array(ab, groundOff, total);
      const water      = new Int16Array(ab, waterOff, total);
      const flags      = new Uint8Array(ab, flagsOff, total);
      const layers     = new Uint8Array(ab, layerOff, total);
      const rgb        = new Uint8Array(ab, rgbOff, total * 3);
      const paletteIdx = new Uint8Array(ab, palIdxOff, total);

      // v5 extra arrays: cliffTexIdx and variation
      let cliffTexIdx = null;
      let variation = null;
      if (version >= 5) {
        const cliffTexOff  = palIdxOff + total * 1;
        const variationOff = cliffTexOff + total * 1;
        cliffTexIdx = new Uint8Array(ab, cliffTexOff, total);
        variation   = new Uint8Array(ab, variationOff, total);
      }

      return {
        cols, rows, ground, water, flags, layers, rgb, paletteIdx, paletteCodes,
        cliffPaletteCodes, cliffTexIdx, variation, version
      };
    }

    // Load one THREE.Texture per palette code, each with repeat wrapping so
    // same-palette regions of the terrain mesh tile naturally. No atlas, no
    // bake — each palette is its own material.
    loadPaletteTextures (tilesetChar, paletteCodes, cliffPaletteCodes) {
      const loader = new THREE.TextureLoader();
      const anis = this.renderer.capabilities.getMaxAnisotropy();
      const configureGroundTex = (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        // ClampToEdge: ground textures are atlases — per-tile UVs address
        // a specific 64×64 sub-region, not tiled across the mesh.
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        tex.anisotropy = anis;
        tex.needsUpdate = true;
      };
      const configureCliffTex = (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        // RepeatWrapping: cliff textures are 256×256 single textures that
        // tile across wall quad faces via world-space UVs.
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        tex.anisotropy = anis;
        tex.needsUpdate = true;
      };
      const loadOne = (code, basePath, configure) => new Promise(resolve => {
        loader.load(`${basePath}/${code}.png`, tex => {
          configure(tex);
          resolve({ code, tex });
        }, undefined, () => {
          console.warn(`[ThreeMapRenderer] missing texture: ${basePath}/${code}.png`);
          resolve({ code, tex: null });
        });
      });
      // Load ground palette textures — each code's first char is its tileset
      // directory (e.g. Zdrt → Z/, Lgrd → L/, cLc1 → c/).
      const groundLoads = paletteCodes.map(code =>
        loadOne(code, `/assets/terrain/${code.charAt(0)}`, configureGroundTex)
      );
      // Load cliff palette textures from /assets/terrain/cliff/
      const cliffCodes = cliffPaletteCodes || [];
      const cliffLoads = cliffCodes.map(code =>
        loadOne(code, '/assets/terrain/cliff', configureCliffTex)
      );
      return Promise.all([...groundLoads, ...cliffLoads]).then(results => {
        this.paletteTextures = new Map();
        for (const { code, tex } of results) {
          this.paletteTextures.set(code, tex);
        }
        const nGround = results.slice(0, paletteCodes.length).filter(r => r.tex).length;
        const nCliff = results.slice(paletteCodes.length).filter(r => r.tex).length;
        console.log(`[ThreeMapRenderer] loaded ${nGround}/${paletteCodes.length} ground + ${nCliff}/${cliffCodes.length} cliff textures for tileset ${tilesetChar}`);
        return this.paletteTextures;
      });
    }

    // Load the baked terrain texture (multi-layer composited in regen-maps).
    loadTerrainTexture (mapName) {
      return new Promise((resolve, reject) => {
        const loader = new THREE.TextureLoader();
        loader.load(`/maps/${mapName}/terrain.jpg`, tex => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.wrapS = THREE.ClampToEdgeWrapping;
          tex.wrapT = THREE.ClampToEdgeWrapping;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.generateMipmaps = true;
          tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
          resolve(tex);
        }, undefined, () => resolve(null));
      });
    }

    // Load the map diffuse texture (same map.jpg the 2D path used).
    loadMapTexture (mapName) {
      return new Promise((resolve, reject) => {
        const loader = new THREE.TextureLoader();
        loader.load(`/maps/${mapName}/map.jpg`, tex => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;
          resolve(tex);
        }, undefined, reject);
      });
    }

    // Given a loaded heightmap and map texture, build the terrain + water mesh
    // and scale the orthographic camera to fit the map.
    setupTerrain (heights, mapTexture, mapInfo, gameScaler) {
      this.heightData = heights;
      this.mapTexture = mapTexture;
      this.mapInfo = mapInfo;
      this.gameScaler = gameScaler;

      const { cols, rows, ground, water, flags, layers,
              cliffPaletteCodes, cliffTexIdx } = heights;

      // Map world bounds → terrain mesh spans full map extent.
      const mapExtent = mapInfo.bounds.map;
      const worldWidth = Math.abs(mapExtent[0][1] - mapExtent[0][0]);
      const worldHeight = Math.abs(mapExtent[1][1] - mapExtent[1][0]);
      this.worldWidth = worldWidth;
      this.worldHeight = worldHeight;
      this.worldOriginX = (mapExtent[0][0] + mapExtent[0][1]) / 2;
      this.worldOriginZ = -((mapExtent[1][0] + mapExtent[1][1]) / 2);

      // --- Build terrain as per-tile NON-SHARED vertices + wall quads ---
      //
      // The old shared-vertex PlaneGeometry approach interpolated triangle
      // faces linearly between adjacent corners, so a 1-layer cliff jump
      // rendered as a smooth slope instead of a hard step. WC3's engine uses
      // discrete per-tile heights with vertical cliff models, so we replicate
      // that: each tile owns its own 4 corner vertices (not shared with
      // neighbors), flat at the tile's layer height. Adjacent tiles at
      // different layer heights get an explicit vertical wall quad between
      // their edges.
      const nTilesX = cols - 1;
      const nTilesY = rows - 1;
      const nTiles = nTilesX * nTilesY;

      // Per-tile storage: max-layer (for wall emission), corner Ys (for top
      // faces), and palette index (for atlas UV lookup).
      const tileBaseLayer = new Uint8Array(nTiles);
      const tileCornerY = new Float32Array(nTiles * 4);  // [BL, BR, TR, TL]
      const tileCliffIdx = new Uint8Array(nTiles);         // cliff palette index (from SW corner)
      const tileIsRamp = new Uint8Array(nTiles);           // 1 if any corner has ramp flag

      // HiveWE corner_cliff: true when a corner's layer differs from any of
      // its 3 adjacent corners (BR, TL, TR). This is per-corner, not per-tile.
      const cornerCliff = new Uint8Array(cols * rows);
      for (let j = 0; j < nTilesY; j++) {
        for (let i = 0; i < nTilesX; i++) {
          const bl = j * cols + i;
          const br = j * cols + (i + 1);
          const tl = (j + 1) * cols + i;
          const tr = (j + 1) * cols + (i + 1);
          if (layers[bl] !== layers[br] || layers[bl] !== layers[tl] || layers[bl] !== layers[tr]) {
            cornerCliff[bl] = 1;
          }
        }
      }

      let minY = Infinity, maxY = -Infinity;
      for (let w3eRow = 0; w3eRow < nTilesY; w3eRow++) {
        for (let col = 0; col < nTilesX; col++) {
          const tileIdx = w3eRow * nTilesX + col;
          const idxBL = w3eRow * cols + col;
          const idxBR = w3eRow * cols + (col + 1);
          const idxTL = (w3eRow + 1) * cols + col;
          const idxTR = (w3eRow + 1) * cols + (col + 1);
          const baseLayer = Math.max(
            layers[idxBL], layers[idxBR], layers[idxTL], layers[idxTR]
          );
          tileBaseLayer[tileIdx] = baseLayer;
          // Ramp flag: if any corner is flagged as ramp (0x10), the tile
          // slopes between cliff layers instead of having a vertical wall.
          tileIsRamp[tileIdx] = (
            (flags[idxBL] & 0x10) | (flags[idxBR] & 0x10) |
            (flags[idxTL] & 0x10) | (flags[idxTR] & 0x10)
          ) ? 1 : 0;
          const yBL = w3eGroundY(ground[idxBL], layers[idxBL]);
          const yBR = w3eGroundY(ground[idxBR], layers[idxBR]);
          const yTR = w3eGroundY(ground[idxTR], layers[idxTR]);
          const yTL = w3eGroundY(ground[idxTL], layers[idxTL]);
          tileCornerY[tileIdx * 4 + 0] = yBL;
          tileCornerY[tileIdx * 4 + 1] = yBR;
          tileCornerY[tileIdx * 4 + 2] = yTR;
          tileCornerY[tileIdx * 4 + 3] = yTL;
          const minC = Math.min(yBL, yBR, yTR, yTL);
          const maxC = Math.max(yBL, yBR, yTR, yTL);
          if (minC < minY) minY = minC;
          if (maxC > maxY) maxY = maxC;
          // Cliff texture = SW corner's cliff palette index.
          tileCliffIdx[tileIdx] = cliffTexIdx ? cliffTexIdx[idxBL] : 0;
        }
      }

      // HiveWE ground_exists: ground is suppressed at cliff/romp tiles
      // unless the tile is a ramp entrance (all 4 corners have ramp flag
      // AND diagonal layer heights differ). Simplified: suppress when BL
      // corner has cliff flag AND tile is not a ramp.
      const tileGroundExists = new Uint8Array(nTiles);
      for (let w3eRow = 0; w3eRow < nTilesY; w3eRow++) {
        for (let col = 0; col < nTilesX; col++) {
          const tileIdx = w3eRow * nTilesX + col;
          const idxBL = w3eRow * cols + col;
          const hasCliff = cornerCliff[idxBL] === 1;
          const isRamp = tileIsRamp[tileIdx] === 1;
          // HiveWE: ground_exists = !((corner_cliff || corner_romp) && !is_ramp_entrance)
          tileGroundExists[tileIdx] = (hasCliff && !isRamp) ? 0 : 1;
        }
      }

      // Build cliff placement list (HiveWE ABCD encoding).
      // Each cliff tile gets an ABCD code from corner layer offsets relative
      // to the minimum layer, selecting the right cliff mesh model.
      const cliffPlacements = [];
      const cliffVarData = heights.cliffTexIdx; // cliff variation per corner
      for (let w3eRow = 0; w3eRow < nTilesY; w3eRow++) {
        for (let col = 0; col < nTilesX; col++) {
          const idxBL = w3eRow * cols + col;
          if (!cornerCliff[idxBL]) continue;
          if (tileIsRamp[w3eRow * nTilesX + col]) continue;

          const idxBR = w3eRow * cols + (col + 1);
          const idxTL = (w3eRow + 1) * cols + col;
          const idxTR = (w3eRow + 1) * cols + (col + 1);
          const lBL = layers[idxBL], lBR = layers[idxBR];
          const lTL = layers[idxTL], lTR = layers[idxTR];
          const base = Math.min(lBL, lBR, lTL, lTR);

          // ABCD = TL, TR, BR, BL corner offsets from base
          const cTL = String.fromCharCode(65 + lTL - base);
          const cTR = String.fromCharCode(65 + lTR - base);
          const cBR = String.fromCharCode(65 + lBR - base);
          const cBL = String.fromCharCode(65 + lBL - base);
          const cliffId = cTL + cTR + cBR + cBL;

          // Skip AAAA (all corners same layer — not actually a cliff)
          if (cliffId === 'AAAA') continue;

          const variation = cliffVarData ? (cliffVarData[idxBL] || 0) : 0;
          cliffPlacements.push({
            col, row: w3eRow, cliffId, variation,
            baseLayer: base,
            cliffTexIdx: cliffTexIdx ? cliffTexIdx[idxBL] : 0
          });
        }
      }

      // Store for sampleHeight (tree placement etc) and camera fit.
      this.tileBaseLayer = tileBaseLayer;
      this.tileCornerY = tileCornerY;
      this.nTilesX = nTilesX;
      this.nTilesY = nTilesY;
      this.terrainMinY = minY;
      this.terrainMaxY = maxY;
      this.cliffPlacements = cliffPlacements;
      this.cliffPaletteCodes = cliffPaletteCodes || [];

      // Wall quads use world-space UVs for cliff texture tiling.
      const TEX_WORLD_REPEAT = 256;

      const positions = [];
      const uvsArr = [];
      // Material slots: 0 = baked terrain texture (all ground top faces),
      // 1+ = cliff palette textures (wall quads only).
      const nCliffPalettes = (cliffPaletteCodes && cliffPaletteCodes.length) || 0;
      const GROUND_SLOT = 0;
      const nMaterialSlots = 1 + nCliffPalettes;  // 1 ground + N cliff
      const indicesBySlot = [];
      for (let i = 0; i < nMaterialSlots; i++) indicesBySlot.push([]);

      const tileW = worldWidth / nTilesX;
      const tileH = worldHeight / nTilesY;
      const halfW = worldWidth / 2;
      const halfH = worldHeight / 2;

      function pushVertex (x, y, z, u, v) {
        positions.push(x, y, z);
        uvsArr.push(u, v);
        return (positions.length / 3) - 1;
      }
      function pushTri (slot, a, b, c) {
        const bucket = indicesBySlot[slot] || indicesBySlot[0];
        bucket.push(a, b, c);
      }

      // Pass 1: top face per tile. UVs map into the pre-baked terrain.jpg
      // which already has multi-layer compositing. Each tile's UV rect is
      // simply its (col, row) position in the tile grid.
      // HiveWE: ground is NOT rendered at cliff tiles (where corner_cliff
      // is set and the tile is not a ramp entrance). Cliff models replace
      // those tiles. We skip the ground face to avoid z-fighting.
      for (let w3eRow = 0; w3eRow < nTilesY; w3eRow++) {
        const geoRow = (nTilesY - 1) - w3eRow;
        const zTop    = -halfH + geoRow * tileH;
        const zBottom = zTop + tileH;
        for (let col = 0; col < nTilesX; col++) {
          const tileIdx = w3eRow * nTilesX + col;

          // Always render ground face — cliff models overlay on top when
          // loaded. This prevents black holes when models fail to load.

          const xLeft  = -halfW + col * tileW;
          const xRight = xLeft + tileW;
          const yBL = tileCornerY[tileIdx * 4 + 0];
          const yBR = tileCornerY[tileIdx * 4 + 1];
          const yTR = tileCornerY[tileIdx * 4 + 2];
          const yTL = tileCornerY[tileIdx * 4 + 3];

          // Tile-position UVs into the baked terrain texture.
          // The bake writes row 0 at the bottom (Y-flipped), matching geoRow.
          const uLeft  = col / nTilesX;
          const uRight = (col + 1) / nTilesX;
          const vTop   = geoRow / nTilesY;
          const vBot   = (geoRow + 1) / nTilesY;

          const vtxBL = pushVertex(xLeft,  yBL, zBottom, uLeft,  vBot);
          const vtxBR = pushVertex(xRight, yBR, zBottom, uRight, vBot);
          const vtxTR = pushVertex(xRight, yTR, zTop,    uRight, vTop);
          const vtxTL = pushVertex(xLeft,  yTL, zTop,    uLeft,  vTop);
          pushTri(GROUND_SLOT, vtxBL, vtxBR, vtxTR);
          pushTri(GROUND_SLOT, vtxBL, vtxTR, vtxTL);
        }
      }

      // Pass 2: wall quads where this tile's base layer exceeds a neighbor.
      // Walls get UVs into the ROCK palette cell so they read as cliff rock.
      // U repeats across the wall width (0..1), V goes top→bottom (0..1).
      for (let w3eRow = 0; w3eRow < nTilesY; w3eRow++) {
        const geoRow = (nTilesY - 1) - w3eRow;
        const zTop    = -halfH + geoRow * tileH;
        const zBottom = zTop + tileH;
        for (let col = 0; col < nTilesX; col++) {
          const tileIdx = w3eRow * nTilesX + col;
          const myLayer = tileBaseLayer[tileIdx];
          const xLeft  = -halfW + col * tileW;
          const xRight = xLeft + tileW;
          const yBL = tileCornerY[tileIdx * 4 + 0];
          const yBR = tileCornerY[tileIdx * 4 + 1];
          const yTR = tileCornerY[tileIdx * 4 + 2];
          const yTL = tileCornerY[tileIdx * 4 + 3];

          // Wall emission. Each wall's 4 points get world-space UVs (the
          // u coordinate along the wall's horizontal run, v from the
          // vertical Y extent). The wall goes into the lower neighbor's
          // palette bucket so it textures with that palette's material.
          const emitWall = (p1, p2, p3, p4, palBucket) => {
            // p1..p4 are [x, y, z] arrays. Use X/Z for u (horizontal along
            // the wall) and world Y for v (scaled by TEX_WORLD_REPEAT too
            // so the wall height-repeat matches the ground tiling scale).
            const uv = (p) => {
              // For a wall on x=const, use z for u. For a wall on z=const,
              // use x for u.
              const uCoord = (p[0] === p1[0] && p[0] === p2[0]) ? p[2] : p[0];
              return [uCoord / TEX_WORLD_REPEAT, p[1] / TEX_WORLD_REPEAT];
            };
            const [u1u, v1u] = uv(p1);
            const [u2u, v2u] = uv(p2);
            const [u3u, v3u] = uv(p3);
            const [u4u, v4u] = uv(p4);
            const a = pushVertex(p1[0], p1[1], p1[2], u1u, v1u);
            const b = pushVertex(p2[0], p2[1], p2[2], u2u, v2u);
            const c = pushVertex(p3[0], p3[1], p3[2], u3u, v3u);
            const d = pushVertex(p4[0], p4[1], p4[2], u4u, v4u);
            pushTri(palBucket, a, b, c);
            pushTri(palBucket, a, c, d);
          };

          // Skip wall emission entirely for ramp tiles — their top faces
          // already slope between layers, so no vertical cliff is needed.
          if (tileIsRamp[tileIdx]) continue;

          // Wall quads use cliff texture material slots (1+).
          // Slot 0 = baked ground, slots 1..N = cliff palettes.
          const wallSlot = nCliffPalettes > 0
            ? Math.min(1 + tileCliffIdx[tileIdx], nMaterialSlots - 1)
            : GROUND_SLOT;

          // Right neighbor
          if (col + 1 < nTilesX) {
            const nIdx = w3eRow * nTilesX + (col + 1);
            if (tileBaseLayer[nIdx] < myLayer && !tileIsRamp[nIdx]) {
              const nYBL = tileCornerY[nIdx * 4 + 0];
              const nYTL = tileCornerY[nIdx * 4 + 3];
              emitWall(
                [xRight, yTR,  zTop],
                [xRight, yBR,  zBottom],
                [xRight, nYBL, zBottom],
                [xRight, nYTL, zTop],
                wallSlot
              );
            }
          }
          // Left neighbor
          if (col > 0) {
            const nIdx = w3eRow * nTilesX + (col - 1);
            if (tileBaseLayer[nIdx] < myLayer && !tileIsRamp[nIdx]) {
              const nYBR = tileCornerY[nIdx * 4 + 1];
              const nYTR = tileCornerY[nIdx * 4 + 2];
              emitWall(
                [xLeft, yBL,  zBottom],
                [xLeft, yTL,  zTop],
                [xLeft, nYTR, zTop],
                [xLeft, nYBR, zBottom],
                wallSlot
              );
            }
          }
          // North neighbor (plane zTop side)
          if (w3eRow + 1 < nTilesY) {
            const nIdx = (w3eRow + 1) * nTilesX + col;
            if (tileBaseLayer[nIdx] < myLayer && !tileIsRamp[nIdx]) {
              const nYBL = tileCornerY[nIdx * 4 + 0];
              const nYBR = tileCornerY[nIdx * 4 + 1];
              emitWall(
                [xRight, yTR,  zTop],
                [xLeft,  yTL,  zTop],
                [xLeft,  nYBL, zTop],
                [xRight, nYBR, zTop],
                wallSlot
              );
            }
          }
          // South neighbor (plane zBottom side)
          if (w3eRow > 0) {
            const nIdx = (w3eRow - 1) * nTilesX + col;
            if (tileBaseLayer[nIdx] < myLayer && !tileIsRamp[nIdx]) {
              const nYTL = tileCornerY[nIdx * 4 + 3];
              const nYTR = tileCornerY[nIdx * 4 + 2];
              emitWall(
                [xLeft,  yBL,  zBottom],
                [xRight, yBR,  zBottom],
                [xRight, nYTR, zBottom],
                [xLeft,  nYTL, zBottom],
                wallSlot
              );
            }
          }
        }
      }

      // Concatenate per-slot index buckets into a single index buffer,
      // recording each slot's range as a geometry group.
      const mergedIndices = [];
      const groupRanges = [];
      for (let s = 0; s < nMaterialSlots; s++) {
        const bucket = indicesBySlot[s];
        if (!bucket.length) continue;
        groupRanges.push({ start: mergedIndices.length, count: bucket.length, slot: s });
        for (let i = 0; i < bucket.length; i++) mergedIndices.push(bucket[i]);
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvsArr, 2));
      const IndexArray = positions.length / 3 > 65535 ? Uint32Array : Uint16Array;
      geo.setIndex(new THREE.BufferAttribute(new IndexArray(mergedIndices), 1));
      geo.computeVertexNormals();

      // Materials: slot 0 = baked terrain texture, slots 1+ = cliff textures.
      const mats = [];
      for (let i = 0; i < groupRanges.length; i++) {
        const { start, count, slot } = groupRanges[i];
        let mat;
        if (slot === 0) {
          // Baked terrain ground texture
          mat = new THREE.MeshLambertMaterial({
            map: mapTexture || null,
            color: mapTexture ? 0xffffff : 0x888888,
            flatShading: true
          });
        } else {
          // Cliff texture
          const cliffIdx = slot - 1;
          const code = cliffPaletteCodes[cliffIdx];
          const tex = this.paletteTextures ? this.paletteTextures.get(code) : null;
          mat = new THREE.MeshLambertMaterial({
            map: tex || null,
            color: tex ? 0xffffff : 0x666666,
            flatShading: true
          });
        }
        mats.push(mat);
        geo.addGroup(start, count, i);
      }

      const mesh = new THREE.Mesh(geo, mats.length ? mats : new THREE.MeshLambertMaterial({ color: 0x666666 }));
      mesh.position.set(0, 0, 0);
      this.scene.add(mesh);
      this.terrainMesh = mesh;
      console.log('[ThreeMapRenderer] multi-material terrain:',
        positions.length / 3, 'verts,', mergedIndices.length / 3, 'tris,',
        mats.length, 'palettes,',
        'Y', minY.toFixed(0), '..', maxY.toFixed(0));

      // Per-corner water mesh — this one still uses a shared-corner
      // PlaneGeometry. Water surfaces are smooth (not stepped) so there's no
      // cliff-wall problem here.
      // Water colors come from water.slk per tileset (HiveWE spec).
      const tilesetChar = (mapInfo.tileset || 'L')[0];
      this.tilesetChar = tilesetChar;
      const wColors = getWaterColors(tilesetChar);

      const waterGeo = new THREE.PlaneGeometry(worldWidth, worldHeight, cols - 1, rows - 1);
      waterGeo.rotateX(-Math.PI / 2);
      const wPos = waterGeo.attributes.position;
      const vertCount = wPos.count;
      // RGBA per-vertex: RGB for tint color, A for depth-based opacity.
      // HiveWE water.slk: shallow alpha ≈ 10/255 (nearly invisible),
      // deep alpha ≈ 250/255 (nearly opaque). This makes walkable shallow
      // water transparent and deep water solid blue.
      const waterRGBA = new Float32Array(vertCount * 4);
      // Two-pass water: pass 1 identifies water vertices, pass 2 handles
      // dry boundary vertices so edges fade smoothly instead of hard seams.
      const isWaterVert = new Uint8Array(vertCount);
      const waterYArr = new Float32Array(vertCount);
      const groundYArr = new Float32Array(vertCount);
      let waterVertCount = 0;

      // Pass 1: compute water state for every vertex.
      for (let i = 0; i < vertCount; i++) {
        const c = i % cols;
        const geoRow = Math.floor(i / cols);
        const w3eRow = (rows - 1) - geoRow;
        const idx = w3eRow * cols + c;
        const gY = w3eGroundY(ground[idx], layers[idx]);
        groundYArr[i] = gY;
        const hasWater = (flags[idx] & 0x40) !== 0;
        const wY = water[idx] !== 0 ? w3eWaterY(water[idx]) : gY - 100;
        waterYArr[i] = wY;
        if (hasWater && wY > gY + WATER_MIN_DEPTH) {
          isWaterVert[i] = 1;
          wPos.setY(i, wY);
          const depth = wY - gY;
          let r, g, b, a;
          if (depth <= WATER_DEEP_LEVEL) {
            const t = Math.max(0, depth - WATER_MIN_DEPTH) / (WATER_DEEP_LEVEL - WATER_MIN_DEPTH);
            r = wColors.smin.r * (1 - t) + wColors.smax.r * t;
            g = wColors.smin.g * (1 - t) + wColors.smax.g * t;
            b = wColors.smin.b * (1 - t) + wColors.smax.b * t;
            a = wColors.smin.a * (1 - t) + wColors.smax.a * t;
          } else {
            const t = Math.min(1, (depth - WATER_DEEP_LEVEL) / (WATER_MAX_DEPTH - WATER_DEEP_LEVEL));
            r = wColors.dmin.r * (1 - t) + wColors.dmax.r * t;
            g = wColors.dmin.g * (1 - t) + wColors.dmax.g * t;
            b = wColors.dmin.b * (1 - t) + wColors.dmax.b * t;
            a = wColors.dmin.a * (1 - t) + wColors.dmax.a * t;
          }
          waterRGBA[i * 4]     = r;
          waterRGBA[i * 4 + 1] = g;
          waterRGBA[i * 4 + 2] = b;
          waterRGBA[i * 4 + 3] = a;
          waterVertCount++;
        }
      }

      // Pass 2: dry vertices — check neighbors for smooth boundary fade.
      for (let i = 0; i < vertCount; i++) {
        if (isWaterVert[i]) continue;
        const c = i % cols;
        const r = Math.floor(i / cols);
        // Check 4 grid neighbors for water
        const neighbors = [];
        if (c > 0 && isWaterVert[i - 1])         neighbors.push(i - 1);
        if (c < cols - 1 && isWaterVert[i + 1])   neighbors.push(i + 1);
        if (r > 0 && isWaterVert[i - cols])        neighbors.push(i - cols);
        if (r < rows - 1 && isWaterVert[i + cols]) neighbors.push(i + cols);

        if (neighbors.length > 0) {
          // Boundary vertex: set to average neighbor water height, alpha=0
          // so the water surface fades out smoothly at edges.
          let avgY = 0;
          for (const n of neighbors) avgY += waterYArr[n];
          avgY /= neighbors.length;
          wPos.setY(i, avgY);
          waterRGBA[i * 4]     = wColors.smin.r;
          waterRGBA[i * 4 + 1] = wColors.smin.g;
          waterRGBA[i * 4 + 2] = wColors.smin.b;
          waterRGBA[i * 4 + 3] = 0;
        } else {
          // No water neighbors — sink below terrain to hide.
          wPos.setY(i, groundYArr[i] - 500);
          waterRGBA[i * 4]     = wColors.dmax.r;
          waterRGBA[i * 4 + 1] = wColors.dmax.g;
          waterRGBA[i * 4 + 2] = wColors.dmax.b;
          waterRGBA[i * 4 + 3] = 0;
        }
      }
      wPos.needsUpdate = true;
      waterGeo.setAttribute('aColor', new THREE.BufferAttribute(waterRGBA, 4));
      waterGeo.computeVertexNormals();

      // Custom ShaderMaterial for per-vertex RGBA water.
      // HiveWE's water shader multiplies animated water texture × vertex color.
      // We approximate with per-vertex RGBA + simple directional lighting.
      const waterMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          lightDir: { value: new THREE.Vector3(-0.3, -1.0, -0.5).normalize() },
          uTime: { value: 0.0 }
        },
        vertexShader: [
          'attribute vec4 aColor;',
          'varying vec4 vColor;',
          'varying vec3 vNormal;',
          'varying vec3 vWorldPos;',
          'void main() {',
          '  vColor = aColor;',
          '  vNormal = normalize(normalMatrix * normal);',
          '  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;',
          '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
          '}'
        ].join('\n'),
        fragmentShader: [
          'uniform vec3 lightDir;',
          'uniform float uTime;',
          'varying vec4 vColor;',
          'varying vec3 vNormal;',
          'varying vec3 vWorldPos;',
          'void main() {',
          '  float diff = (dot(-lightDir, vNormal) + 1.0) * 0.5;',
          '  float wave = sin(vWorldPos.x * 0.015 + uTime * 1.5) * cos(vWorldPos.z * 0.012 + uTime * 1.1) * 0.04;',
          '  float alpha = vColor.a * 0.55 + wave;',
          '  gl_FragColor = vec4(vColor.rgb * diff, clamp(alpha, 0.0, 0.7));',
          '}'
        ].join('\n')
      });
      const waterMesh = new THREE.Mesh(waterGeo, waterMat);
      waterMesh.position.set(0, 0, 0);
      this.scene.add(waterMesh);
      this.waterMesh = waterMesh;
      console.log('[ThreeMapRenderer] terrain Y range', minY.toFixed(1), '..', maxY.toFixed(1),
                  '| water verts:', waterVertCount, '/', vertCount);

      // Position the perspective camera to frame the full map. We solve for
      // the distance that makes `worldHeight` (larger dimension) fit the
      // vertical FOV exactly, then apply a small padding factor.
      //   frustumHeight = 2 * distance * tan(fov/2)
      //   distance      = frustumHeight / (2 * tan(fov/2))
      // Aspect is set in resize() from the canvas; we assume a reasonable
      // default here. Add 10% padding so edges don't kiss the viewport.
      const tiltRad = CAMERA_TILT_DEG * Math.PI / 180;
      const fovRad = this.camera.fov * Math.PI / 180;
      const mapMajor = Math.max(worldWidth, worldHeight);
      const fitDistance = (mapMajor / 2) / Math.tan(fovRad / 2);
      // The tilt makes the far edge look smaller and the near edge look
      // bigger; push back slightly to keep the full map visible.
      const camDist = fitDistance * 1.12;
      const camHeight = Math.cos(tiltRad) * camDist;
      const camOffset = Math.sin(tiltRad) * camDist;
      this._camFocus = new THREE.Vector3(0, 0, 0);
      this._camDistBase = camDist;
      this.camera.near = 10;
      this.camera.far = camDist * 4;
      this.camera.position.set(0, camHeight, camOffset);
      this.camera.lookAt(this._camFocus);
      this.camera.updateProjectionMatrix();
      console.log('[ThreeMapRenderer] camera fit', { mapMajor, fitDistance, camDist, camHeight, camOffset });

      // Fog of war — darkens non-playable map edges (outside camera bounds)
      if (window.FogOfWar) {
        this.fogOfWar = new FogOfWar(
          this.scene, mapInfo, worldWidth, worldHeight, maxY + 20
        );
      }

      this.resize();
      this.ready = true;
      // Render immediately so terrain is visible before play is pressed
      this.requestRender();
    }

    // Sync the perspective camera to the d3 zoom transform used by the 2D
    // unit overlays so the 3D terrain roughly tracks user zoom/pan. Precise
    // pixel-for-pixel alignment requires projecting unit positions through
    // this camera (see gameScaler.projectXY).
    syncTransform (transform) {
      if (!this.ready) return;

      // Skip if transform hasn't changed since last sync
      const tk = transform.k || 1;
      const ttx = transform.x || 0;
      const tty = transform.y || 0;
      if (tk === this._lastSyncK && ttx === this._lastSyncX && tty === this._lastSyncY) return;
      this._lastSyncK = tk;
      this._lastSyncX = ttx;
      this._lastSyncY = tty;

      const k = tk;
      const tiltRad = CAMERA_TILT_DEG * Math.PI / 180;
      const dist = this._camDistBase / k;
      const camHeight = Math.cos(tiltRad) * dist;
      const camOffset = Math.sin(tiltRad) * dist;

      // Find what world point sits at the screen center given the D3 transform.
      // D3 zoom: screenPos = k * canvasPos + tx
      // Invert: canvasPos = (screenCenter - tx) / k
      // Then convert canvas pixel offset from center → world coords via the scales.
      const gs = this.gameScaler;
      const tx = transform.x || 0;
      const ty = transform.y || 0;
      const middleX = gs ? gs.middleX : (this.canvas.width / 2);
      const middleY = gs ? gs.middleY : (this.canvas.height / 2);

      // Canvas pixel at screen center (in unzoomed space)
      const cxRel = (middleX - tx) / k - middleX; // offset from canvas center
      const cyRel = (middleY - ty) / k - middleY;

      // Convert pixel offset to world coords via the d3 scales, then to Three.js centered coords
      let panX = 0, panZ = 0;
      if (gs && gs.xScale && gs.yScale) {
        const ext = this.mapInfo.bounds.map;
        const mapCenterX = (ext[0][0] + ext[0][1]) / 2;
        const mapCenterY = (ext[1][0] + ext[1][1]) / 2;
        const worldX = gs.xScale.invert(cxRel);
        const worldY = gs.yScale.invert(cyRel);
        panX = worldX - mapCenterX;
        panZ = -(worldY - mapCenterY);
      }
      this._camFocus.set(panX, 0, panZ);

      this.camera.position.set(panX, camHeight, panZ + camOffset);
      this.camera.lookAt(this._camFocus);
      this.camera.updateProjectionMatrix();
      this._viewProjDirty = true;
    }

    // Resize the three canvas to match the 2D overlay canvases so their pixel
    // spaces are identical. We use the gameScaler.sceneImage dimensions (the
    // same values setupDrawing applies to #main-canvas / #player-canvas /
    // #utility-canvas). CSS then scales the whole #canvas-group to fit the
    // viewport uniformly via object-fit: contain.
    resize () {
      if (!this.canvas) return;
      const gs = this.gameScaler;
      let w, h;
      if (gs && gs.sceneImage) {
        w = gs.sceneImage.width;
        h = gs.sceneImage.height;
      } else {
        const rect = this.canvas.getBoundingClientRect();
        w = Math.max(2, rect.width);
        h = Math.max(2, rect.height);
      }
      // Pixel ratio 1 — we want the drawing buffer to be exactly mapWidth ×
      // mapHeight, matching the 2D canvases. CSS does the display scaling.
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(w, h, false);
      // Ensure the canvas element's drawing buffer matches (setSize with
      // updateStyle=false doesn't touch .style.width/.style.height).
      this.canvas.width = w;
      this.canvas.height = h;
      if (this.camera && this.camera.isPerspectiveCamera) {
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
      }
    }

    render (transform) {
      if (!this.ready) return;
      if (transform) this.syncTransform(transform);
      if (this.waterMesh && this.waterMesh.material.uniforms) {
        this.waterMesh.material.uniforms.uTime.value = performance.now() / 1000;
      }
      this.animateLevelPins();

      // Force camera matrix update once before rendering, so subsequent
      // projectToCanvas calls don't redundantly recompute it per-unit
      this.camera.updateMatrixWorld(true);
      // Rebuild the cached viewProjection matrix for projectToCanvas
      if (!this._viewProjMatrix) this._viewProjMatrix = new THREE.Matrix4();
      this._viewProjMatrix.multiplyMatrices(
        this.camera.projectionMatrix,
        this.camera.matrixWorldInverse
      );
      this._projMatrixCached = true;
      this._viewProjDirty = false;

      this.renderer.render(this.scene, this.camera);
    }

    // Build simple 3D tree placeholders from the doodad JSON the viewer
    // already loads. Each doodad becomes a brown trunk cylinder + a dark
    // green foliage cone, all rendered via two InstancedMesh objects so we
    // can afford thousands of them with a single GPU draw call each.
    setupDoodads (doodadData) {
      if (!doodadData || !this.ready) return;
      // app.js stores `this.doodadData = jsonData.grid` — already an array.
      const doodads = Array.isArray(doodadData) ? doodadData : doodadData.grid;
      if (!doodads || !doodads.length) return;

      // Tree-type itemIds. WC3 uses 4-char codes like 'LTlt', 'LTls', 'ATtr',
      // 'BTtw', etc. — a mix of tileset initial + tree shorthand. Filter to
      // things that look like trees (start with a letter tileset code + 'T').
      const isTree = (t) => typeof t === 'string' && t.length === 4 && t[1] === 'T';
      const trees = doodads.filter(d =>
        isTree(d.type) &&
        this.isInsideCameraBounds(parseFloat(d.position.x), parseFloat(d.position.y))
      );
      const count = trees.length;
      if (!count) return;

      // Tree dimensions: WC3 trees are ~2 tiles tall (~256 world units) so
      // they read at full-map zoom. Short stocky trunk + chunky rounded blob
      // foliage that looks like a deciduous canopy, not a Hershey's kiss.
      const TRUNK_H = 70;
      const TRUNK_R = 20;
      const LEAF_R  = 130;

      const trunkGeo = new THREE.CylinderGeometry(TRUNK_R * 0.75, TRUNK_R, TRUNK_H, 8);
      trunkGeo.translate(0, TRUNK_H / 2, 0);
      const trunkMat = new THREE.MeshLambertMaterial({ color: 0x4e3418 });
      const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, count);

      // SphereGeometry is much smoother per-vertex than a subdivided icosa
      // for the same face count. (16,12) → ~384 tris, smooth-shaded = clean
      // rounded deciduous canopy, not a Hershey's kiss or chunky polyhedron.
      const leafGeo = new THREE.SphereGeometry(LEAF_R, 16, 12);
      leafGeo.scale(1.05, 0.88, 1.05);
      leafGeo.translate(0, TRUNK_H + LEAF_R * 0.65, 0);
      const treeHex = TILESET_TREE_COLORS[this.tilesetChar] || '#1a5820';
      const treeColorInt = parseInt(treeHex.slice(1), 16);
      const leafMat = new THREE.MeshLambertMaterial({ color: treeColorInt });
      const leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, count);

      const dummy = new THREE.Object3D();
      const ext = this.mapInfo.bounds.map;
      const mapCenterX = (ext[0][0] + ext[0][1]) / 2;
      const mapCenterY = (ext[1][0] + ext[1][1]) / 2;
      const leafColor = new THREE.Color();
      const leafBase = new THREE.Color(treeColorInt);
      const leafAlt = leafBase.clone().multiplyScalar(1.35);
      for (let i = 0; i < count; i++) {
        const d = trees[i];
        const wx = parseFloat(d.position.x);
        const wy = parseFloat(d.position.y);
        const groundY = this.sampleHeight(wx, wy);
        const s = (d.scale && d.scale[0]) || 1;
        dummy.position.set(wx - mapCenterX, groundY, -(wy - mapCenterY));
        dummy.rotation.set(0, d.angle || 0, 0);
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        trunkMesh.setMatrixAt(i, dummy.matrix);
        leafMesh.setMatrixAt(i, dummy.matrix);
        // slight per-tree color variation from position hash
        const h = (Math.sin(wx * 0.013 + wy * 0.017) + 1) * 0.5;
        leafColor.copy(leafBase).lerp(leafAlt, h);
        leafMesh.setColorAt(i, leafColor);
      }
      trunkMesh.instanceMatrix.needsUpdate = true;
      leafMesh.instanceMatrix.needsUpdate = true;
      if (leafMesh.instanceColor) leafMesh.instanceColor.needsUpdate = true;

      this.scene.add(trunkMesh);
      this.scene.add(leafMesh);
      this.trunkMesh = trunkMesh;
      this.leafMesh = leafMesh;
      console.log('[ThreeMapRenderer] spawned', count, 'trees');
    }

    // True if a WC3 world position is inside the camera-playable bounds.
    // Used to cull doodads/trees so nothing pokes through the FogOfWar plane.
    isInsideCameraBounds (wx, wy) {
      const cam = this.mapInfo && this.mapInfo.bounds && this.mapInfo.bounds.camera;
      if (!cam) return true;
      const xMin = cam[0][0], xMax = cam[0][1];
      const yMin = cam[1][1], yMax = cam[1][0];
      return wx >= xMin && wx <= xMax && wy >= yMin && wy <= yMax;
    }

    // Sample the terrain's exact top Y at WC3 world coords (wx, wy).
    // Finds the containing tile, then bilinearly interpolates across the
    // tile's 4 corner Ys using the fractional (tx, ty) position inside the
    // tile. This means a tree positioned anywhere on a sloped tile sits
    // exactly on the mesh surface at its XZ, not at the tile's center Y.
    sampleHeight (wx, wy) {
      if (!this.heightData || !this.mapInfo || !this.tileCornerY) return 0;
      const ext = this.mapInfo.bounds.map;
      const fracX = (wx - ext[0][0]) / (ext[0][1] - ext[0][0]);
      const fracY = (wy - ext[1][1]) / (ext[1][0] - ext[1][1]);
      if (fracX < 0 || fracX > 1 || fracY < 0 || fracY > 1) return 0;

      // Tile indices (floor) and fractional position within the tile.
      const fTileX = fracX * this.nTilesX;
      const fTileY = fracY * this.nTilesY;
      const tileCol = Math.min(this.nTilesX - 1, Math.max(0, Math.floor(fTileX)));
      const tileRow = Math.min(this.nTilesY - 1, Math.max(0, Math.floor(fTileY)));
      const tx = Math.min(1, Math.max(0, fTileX - tileCol));
      const ty = Math.min(1, Math.max(0, fTileY - tileRow));
      const tileIdx = tileRow * this.nTilesX + tileCol;

      // Corner order stored in tileCornerY: [BL, BR, TR, TL]
      //   BL = W3E (col, w3eRow)   — south-west  (fracY low)
      //   BR = W3E (col+1, w3eRow) — south-east
      //   TR = W3E (col+1, w3eRow+1) — north-east (fracY high)
      //   TL = W3E (col, w3eRow+1) — north-west
      const yBL = this.tileCornerY[tileIdx * 4 + 0];
      const yBR = this.tileCornerY[tileIdx * 4 + 1];
      const yTR = this.tileCornerY[tileIdx * 4 + 2];
      const yTL = this.tileCornerY[tileIdx * 4 + 3];

      // Bilinear: mix along X at bottom and top rows, then mix along Y.
      const yBot = yBL * (1 - tx) + yBR * tx;
      const yTop = yTL * (1 - tx) + yTR * tx;
      return yBot * (1 - ty) + yTop * ty;
    }

    // Project a WC3 world (x, y) through the 3D camera to canvas pixel coords.
    // Returns { x, y } in CSS pixel space of the three canvas (top-left origin),
    // or null if the renderer isn't ready.
    projectToCanvas (wx, wy) {
      if (!this.ready || !this.heightData || !this.mapInfo) return null;

      // Cache map center and canvas dimensions — they don't change per frame
      if (!this._projCache) {
        const ext = this.mapInfo.bounds.map;
        const gs = this.gameScaler;
        this._projCache = {
          mapCenterX: (ext[0][0] + ext[0][1]) / 2,
          mapCenterY: (ext[1][0] + ext[1][1]) / 2,
          cw: (gs && gs.sceneImage) ? gs.sceneImage.width  : this.canvas.width,
          ch: (gs && gs.sceneImage) ? gs.sceneImage.height : this.canvas.height
        };
      }

      const { mapCenterX, mapCenterY, cw, ch } = this._projCache;

      if (!this._projVec) this._projVec = new THREE.Vector3();

      // Cache the combined viewProjection matrix once per frame (set in render())
      if (!this._viewProjMatrix) this._viewProjMatrix = new THREE.Matrix4();
      if (this._projMatrixCached && !this._viewProjDirty) {
        // Already cached from last render() call
      } else {
        this._viewProjMatrix.multiplyMatrices(
          this.camera.projectionMatrix,
          this.camera.matrixWorldInverse
        );
        this._viewProjDirty = false;
      }

      this._projVec.set(
        wx - mapCenterX,
        this.sampleHeight(wx, wy),
        -(wy - mapCenterY)
      );

      // Manual projection using cached matrix — avoids per-call camera.updateMatrixWorld
      this._projVec.applyMatrix4(this._viewProjMatrix);

      return {
        x: (this._projVec.x + 1) * 0.5 * cw,
        y: (1 - this._projVec.y) * 0.5 * ch
      };
    }

    // --- 3D Overlay Systems ---

    /**
     * Create or update a terrain-following ribbon mesh for a unit path.
     * @param {string} id — unique ribbon identifier (e.g., "path-p0-hero0")
     * @param {Array<{x:number, y:number}>} points — WC3 world coords
     * @param {number} color — hex color (e.g., 0xff0000)
     * @param {number} opacity — 0..1
     */
    updatePathRibbon (id, points, color, opacity) {
      if (!this.ready || !this.mapInfo || points.length < 2) {
        this.removePathRibbon(id);
        return;
      }

      const ext = this.mapInfo.bounds.map;
      const cx = (ext[0][0] + ext[0][1]) / 2;
      const cy = (ext[1][0] + ext[1][1]) / 2;
      const RIBBON_WIDTH = 8; // world units
      const Y_OFFSET = 3;    // above terrain to avoid z-fighting

      // Build triangle strip vertices: left and right edges of the ribbon
      const positions = [];
      const indices = [];

      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const wx = p.x - cx;
        const wz = -(p.y - cy);
        const wy = this.sampleHeight(p.x, p.y) + Y_OFFSET;

        // Compute perpendicular direction for ribbon width
        let dx = 0, dz = 1;
        if (i < points.length - 1) {
          dx = (points[i + 1].x - p.x);
          dz = -(points[i + 1].y - p.y);
        } else if (i > 0) {
          dx = (p.x - points[i - 1].x);
          dz = -(p.y - points[i - 1].y);
        }
        const len = Math.sqrt(dx * dx + dz * dz) || 1;
        // Perpendicular: rotate 90°
        const px = -dz / len * RIBBON_WIDTH * 0.5;
        const pz = dx / len * RIBBON_WIDTH * 0.5;

        // Left vertex
        positions.push(wx + px, wy, wz + pz);
        // Right vertex
        positions.push(wx - px, wy, wz - pz);

        // Quad indices (2 triangles per segment)
        if (i > 0) {
          const base = (i - 1) * 2;
          indices.push(base, base + 1, base + 2);
          indices.push(base + 1, base + 3, base + 2);
        }
      }

      if (!this._pathRibbons) this._pathRibbons = {};

      // Reuse or create mesh
      let ribbon = this._pathRibbons[id];
      if (ribbon) {
        // Update existing geometry
        const geo = ribbon.mesh.geometry;
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
        geo.setIndex(indices);
        geo.attributes.position.needsUpdate = true;
        geo.computeVertexNormals();
        ribbon.mesh.material.color.setHex(color);
        ribbon.mesh.material.opacity = opacity || 0.6;
        // Update glow
        if (ribbon.glow) {
          ribbon.glow.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
          ribbon.glow.geometry.setIndex(indices);
          ribbon.glow.geometry.attributes.position.needsUpdate = true;
          ribbon.glow.material.color.setHex(color);
        }
      } else {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
        geo.setIndex(indices);
        geo.computeVertexNormals();

        const mat = new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: opacity || 0.6,
          depthWrite: false, side: THREE.DoubleSide
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.renderOrder = 2;
        this.scene.add(mesh);

        // Wider glow ribbon
        const glowGeo = geo.clone();
        const glowMat = new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.15,
          depthWrite: false, side: THREE.DoubleSide
        });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        glow.scale.set(2.0, 1, 2.0);
        glow.renderOrder = 2;
        this.scene.add(glow);

        this._pathRibbons[id] = { mesh, glow };
      }
    }

    removePathRibbon (id) {
      if (!this._pathRibbons || !this._pathRibbons[id]) return;
      const r = this._pathRibbons[id];
      this.scene.remove(r.mesh);
      this.scene.remove(r.glow);
      r.mesh.geometry.dispose();
      r.mesh.material.dispose();
      if (r.glow) { r.glow.geometry.dispose(); r.glow.material.dispose(); }
      delete this._pathRibbons[id];
    }

    removeAllPathRibbons () {
      if (!this._pathRibbons) return;
      for (const id of Object.keys(this._pathRibbons)) {
        this.removePathRibbon(id);
      }
    }

    /**
     * Create a ground-projected ring at a world position (for camp markers).
     * @param {string} id — unique ring identifier
     * @param {number} wx, wy — WC3 world coords
     * @param {number} innerR, outerR — ring radii in world units
     * @param {number} color — hex color
     * @param {number} progress — 0..1 fill progress (for claim wedge)
     */
    updateCampRing (id, wx, wy, innerR, outerR, color, progress) {
      if (!this.ready || !this.mapInfo) return;

      const ext = this.mapInfo.bounds.map;
      const cx = (ext[0][0] + ext[0][1]) / 2;
      const cy = (ext[1][0] + ext[1][1]) / 2;
      const worldX = wx - cx;
      const worldZ = -(wy - cy);
      const worldY = this.sampleHeight(wx, wy) + 2;

      if (!this._campRings) this._campRings = {};

      let ring = this._campRings[id];
      if (!ring) {
        const geo = new THREE.RingGeometry(innerR, outerR, 48);
        const mat = new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.5,
          depthWrite: false, side: THREE.DoubleSide
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = -Math.PI / 2; // lay flat on XZ plane
        mesh.renderOrder = 2;
        this.scene.add(mesh);
        ring = { mesh };
        this._campRings[id] = ring;
      }

      ring.mesh.position.set(worldX, worldY, worldZ);
      ring.mesh.material.color.setHex(color);

      // Pulse animation for unclaimed camps
      if (progress <= 0) {
        const t = performance.now() / 1000;
        const pulse = 1.0 + Math.sin(t * Math.PI) * 0.05;
        ring.mesh.scale.set(pulse, pulse, 1);
      } else {
        ring.mesh.scale.set(1, 1, 1);
      }
    }

    removeCampRing (id) {
      if (!this._campRings || !this._campRings[id]) return;
      const r = this._campRings[id];
      this.scene.remove(r.mesh);
      r.mesh.geometry.dispose();
      r.mesh.material.dispose();
      delete this._campRings[id];
    }

    /**
     * Create a 3D route line following terrain between camp positions.
     * @param {string} id — unique line identifier
     * @param {Array<{x:number, y:number}>} campCenters — ordered camp positions
     * @param {number} color — hex color
     */
    updateRouteLine (id, campCenters, color) {
      if (!this.ready || !this.mapInfo || campCenters.length < 2) return;

      const ext = this.mapInfo.bounds.map;
      const cx = (ext[0][0] + ext[0][1]) / 2;
      const cy = (ext[1][0] + ext[1][1]) / 2;
      const STRIP_WIDTH = 6;
      const Y_OFFSET = 5;

      // Build a thin triangle strip ribbon for thick lines
      const positions = [];
      const indices = [];

      for (let i = 0; i < campCenters.length; i++) {
        const p = campCenters[i];
        const wx = p.x - cx;
        const wz = -(p.y - cy);
        const wy = this.sampleHeight(p.x, p.y) + Y_OFFSET;

        let dx = 0, dz = 1;
        if (i < campCenters.length - 1) {
          dx = campCenters[i + 1].x - p.x;
          dz = -(campCenters[i + 1].y - p.y);
        } else if (i > 0) {
          dx = p.x - campCenters[i - 1].x;
          dz = -(p.y - campCenters[i - 1].y);
        }
        const len = Math.sqrt(dx * dx + dz * dz) || 1;
        const px = -dz / len * STRIP_WIDTH * 0.5;
        const pz = dx / len * STRIP_WIDTH * 0.5;

        positions.push(wx + px, wy, wz + pz);
        positions.push(wx - px, wy, wz - pz);

        if (i > 0) {
          const base = (i - 1) * 2;
          indices.push(base, base + 1, base + 2);
          indices.push(base + 1, base + 3, base + 2);
        }
      }

      if (!this._routeLines) this._routeLines = {};

      let line = this._routeLines[id];
      if (line) {
        const geo = line.geometry;
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
        geo.setIndex(indices);
        geo.attributes.position.needsUpdate = true;
        line.material.color.setHex(color);
      } else {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
        geo.setIndex(indices);

        const mat = new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.7,
          depthWrite: false, side: THREE.DoubleSide
        });
        line = new THREE.Mesh(geo, mat);
        line.renderOrder = 2;
        this.scene.add(line);
        this._routeLines[id] = line;
      }
    }

    /**
     * Create a 3D level pin marker (floating diamond with glow).
     * @param {string} id — unique pin identifier
     * @param {number} wx, wy — WC3 world coords
     * @param {number} color — hex player color
     */
    addLevelPin (id, wx, wy, color) {
      if (!this.ready || !this.mapInfo) return;

      const ext = this.mapInfo.bounds.map;
      const cx = (ext[0][0] + ext[0][1]) / 2;
      const cy = (ext[1][0] + ext[1][1]) / 2;
      const worldX = wx - cx;
      const worldZ = -(wy - cy);
      const worldY = this.sampleHeight(wx, wy) + 40;

      if (!this._levelPins) this._levelPins = {};
      if (this._levelPins[id]) return; // already exists

      const geo = new THREE.OctahedronGeometry(15, 0);
      const mat = new THREE.MeshPhongMaterial({
        color, emissive: color, emissiveIntensity: 0.3,
        shininess: 30, transparent: true, opacity: 0.85
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(worldX, worldY, worldZ);
      mesh.renderOrder = 3;
      this.scene.add(mesh);
      this._levelPins[id] = mesh;
    }

    /** Animate all level pins (call each frame) */
    animateLevelPins () {
      if (!this._levelPins) return;
      const t = performance.now() / 1000;
      for (const pin of Object.values(this._levelPins)) {
        pin.rotation.y = t * 0.5; // slow spin
        pin.position.y += Math.sin(t * 2) * 0.1; // subtle bob
      }
    }

    // Load and place WC3 cliff mesh models (converted MDX → glTF).
    // Uses the ABCD cliff codes computed in setupTerrain().
    setupCliffModels () {
      if (!this.cliffPlacements || !this.cliffPlacements.length || !this.ready) return;
      if (!window.GLBLoader) {
        console.warn('[ThreeMapRenderer] GLBLoader not available, skipping cliff models');
        return;
      }

      const loader = new window.GLBLoader();
      const placements = this.cliffPlacements;
      const ext = this.mapInfo.bounds.map;
      const mapCenterX = (ext[0][0] + ext[0][1]) / 2;
      const mapCenterY = (ext[1][0] + ext[1][1]) / 2;
      const tileWorldSize = 128; // 1 tile = 128 world units

      // Group placements by cliff model ID+variation to batch load
      const groups = {};
      for (const p of placements) {
        // Clamp variation to known Cliffs.slk max (most have 0-2)
        const v = p.variation % 3;
        const key = 'cliffs' + p.cliffId.toLowerCase() + v;
        if (!groups[key]) groups[key] = [];
        groups[key].push(p);
      }

      let loadedCount = 0;
      const totalGroups = Object.keys(groups).length;

      for (const [modelKey, instances] of Object.entries(groups)) {
        const url = '/assets/models/cliffs/' + modelKey + '.glb';
        loader.load(url, (geo) => {
          if (!geo) return;

          // Look up the correct cliff texture for this group using the
          // first instance's cliffTexIdx → cliffPaletteCodes mapping.
          const cIdx = instances[0].cliffTexIdx || 0;
          const cCode = this.cliffPaletteCodes[cIdx] || null;
          const cliffTex = cCode && this.paletteTextures
            ? (this.paletteTextures.get(cCode) || null)
            : null;
          const mat = new THREE.MeshLambertMaterial({
            map: cliffTex || null,
            color: cliffTex ? 0xffffff : 0x887766,
            flatShading: true
          });

          const mesh = new THREE.InstancedMesh(geo, mat, instances.length);
          const dummy = new THREE.Object3D();

          for (let i = 0; i < instances.length; i++) {
            const p = instances[i];
            // Cliff model position: tile (col, row) at base layer height.
            // The glTF model is already in tile-space (1 unit = 1 tile) due
            // to the 90° rotation + /128 scale in the converter.
            // World position = tile center × tileWorldSize, offset from map center.
            const worldX = ext[0][0] + p.col * tileWorldSize;
            const worldY = ext[1][1] + p.row * tileWorldSize;
            const baseY = (p.baseLayer - LAYER_ZERO) * LAYER_STEP_RAW / 4;

            dummy.position.set(
              worldX - mapCenterX,
              baseY,
              -(worldY - mapCenterY)
            );
            // Cliff models in tile-space need to be scaled to world-space
            dummy.scale.set(tileWorldSize, tileWorldSize, tileWorldSize);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
          }
          mesh.instanceMatrix.needsUpdate = true;
          this.scene.add(mesh);
          this.requestRender();
          loadedCount++;
          if (loadedCount === totalGroups) {
            console.log('[ThreeMapRenderer] loaded', placements.length,
              'cliff instances across', totalGroups, 'model types');
          }
        }, undefined, () => {
          // Model file not found — skip silently (not all ABCD combinations exist)
          loadedCount++;
        });
      }
    }

    // Load the doodad texture manifest and preload textures for the current
    // tileset. Returns a promise that resolves when textures are ready.
    loadDoodadTextures (tilesetChar) {
      this._doodadTextureManifest = null;
      this._doodadTextures = new Map();
      return fetch('/assets/textures/doodad-textures.json')
        .then(res => res.ok ? res.json() : null)
        .then(manifest => {
          if (!manifest) return;
          this._doodadTextureManifest = manifest;
          const loader = new THREE.TextureLoader();
          const loads = [];

          // Preload the tree texture for this tileset from each replaceable ID
          for (const [id, tilesets] of Object.entries(manifest.replaceable)) {
            const pngPath = tilesets[tilesetChar] || tilesets.default;
            if (!pngPath) continue;
            const url = '/assets/textures/' + pngPath;
            loads.push(new Promise(resolve => {
              loader.load(url, tex => {
                tex.colorSpace = THREE.SRGBColorSpace;
                tex.flipY = false; // MDX/glTF UVs use V=0=top; default flipY=true is wrong
                tex.magFilter = THREE.LinearFilter;
                tex.minFilter = THREE.LinearMipmapLinearFilter;
                tex.generateMipmaps = true;
                this._doodadTextures.set('replaceable:' + id, tex);
                resolve();
              }, undefined, () => resolve());
            }));
          }

          // Preload direct textures
          for (const [blpPath, pngPath] of Object.entries(manifest.direct)) {
            const url = '/assets/textures/' + pngPath;
            loads.push(new Promise(resolve => {
              loader.load(url, tex => {
                tex.colorSpace = THREE.SRGBColorSpace;
                tex.flipY = false; // MDX/glTF UVs use V=0=top
                tex.magFilter = THREE.LinearFilter;
                tex.minFilter = THREE.LinearMipmapLinearFilter;
                tex.generateMipmaps = true;
                this._doodadTextures.set('direct:' + blpPath.toLowerCase(), tex);
                resolve();
              }, undefined, () => resolve());
            }));
          }

          return Promise.all(loads);
        })
        .then(() => {
          console.log('[ThreeMapRenderer] doodad textures loaded:', this._doodadTextures.size);
        })
        .catch(() => {
          console.warn('[ThreeMapRenderer] doodad texture manifest not found, using flat colors');
        });
    }

    // Look up the texture for a doodad model type from the manifest.
    _getDoodadTexture (typeCode) {
      if (!this._doodadTextureManifest) return null;
      const info = this._doodadTextureManifest.modelTextures[typeCode];
      if (!info) return null;
      if (info.replaceableId > 0) {
        return {
          tex: this._doodadTextures.get('replaceable:' + info.replaceableId) || null,
          filterMode: info.filterMode
        };
      }
      if (info.image) {
        return {
          tex: this._doodadTextures.get('direct:' + info.image.toLowerCase()) || null,
          filterMode: info.filterMode
        };
      }
      return null;
    }

    // Load and place real WC3 doodad models (converted MDX → glTF).
    // Trees, rocks, plants, bushes — anything with a matching .glb file.
    // Doodads without a model get simple placeholder shapes.
    setupDoodadModels (doodadData) {
      if (!doodadData || !this.ready) return;
      if (!window.GLBLoader) {
        this.setupDoodads(doodadData);
        this.requestRender();
        return;
      }
      const doodads = Array.isArray(doodadData) ? doodadData : doodadData.grid;
      if (!doodads || !doodads.length) return;

      // Spatial index of all tree instances for dynamic clearing
      this._treeInstances = [];

      const loader = new window.GLBLoader();
      const ext = this.mapInfo.bounds.map;
      const mapCenterX = (ext[0][0] + ext[0][1]) / 2;
      const mapCenterY = (ext[1][0] + ext[1][1]) / 2;

      // Group ALL doodads by type+variation to batch load
      const groups = {};
      for (const d of doodads) {
        if (!d.type || d.type.length !== 4) continue;
        const wx = parseFloat(d.position.x);
        const wy = parseFloat(d.position.y);
        if (!this.isInsideCameraBounds(wx, wy)) continue;
        const v = d.variation || 0;
        const key = d.type.toLowerCase() + v;
        if (!groups[key]) groups[key] = { type: d.type, variation: v, instances: [] };
        groups[key].instances.push(d);
      }

      // Fallback colors when no texture is available
      const isTreeType = (t) => t.length === 4 && t[1] === 'T';
      const treeHex = TILESET_TREE_COLORS[this.tilesetChar] || '#1a5820';
      const treeBaseColor = new THREE.Color(parseInt(treeHex.slice(1), 16));

      let loadedCount = 0, modelCount = 0, skipCount = 0;
      const totalGroups = Object.keys(groups).length;
      console.log('[ThreeMapRenderer] loading doodad models:', doodads.length, 'doodads in', totalGroups, 'groups');

      for (const [modelKey, group] of Object.entries(groups)) {
        const url = '/assets/models/trees/' + modelKey + '.glb';
        loader.load(url, (geo) => {
          if (!geo || geo.isGroup) { loadedCount++; return; }

          const isTree = isTreeType(group.type);
          const baseType = group.type.toLowerCase();
          const texInfo = this._getDoodadTexture(baseType);

          let mat;
          if (texInfo && texInfo.tex) {
            mat = new THREE.MeshLambertMaterial({
              map: texInfo.tex,
              alphaTest: texInfo.filterMode === 1 ? 0.5 : 0,
              transparent: texInfo.filterMode > 1,
              side: THREE.DoubleSide,
              color: 0xffffff
            });
          } else {
            mat = new THREE.MeshLambertMaterial({
              color: isTree ? treeBaseColor.getHex() : 0x887766,
              flatShading: !isTree
            });
          }

          const instCount = group.instances.length;
          const mesh = new THREE.InstancedMesh(geo, mat, instCount);
          const dummy = new THREE.Object3D();

          for (let i = 0; i < instCount; i++) {
            const d = group.instances[i];
            const wx = parseFloat(d.position.x);
            const wy = parseFloat(d.position.y);
            const groundY = this.sampleHeight(wx, wy);
            const s = (d.scale && d.scale[0]) || 1;

            dummy.position.set(wx - mapCenterX, groundY, -(wy - mapCenterY));
            dummy.rotation.set(0, d.angle || 0, 0);
            dummy.scale.set(s, s, s);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);

            if (isTree) {
              this._treeInstances.push({
                mesh, index: i, wx, wy,
                originalMatrix: dummy.matrix.clone(),
                hidden: false
              });
            }
          }
          mesh.instanceMatrix.needsUpdate = true;
          this.scene.add(mesh);
          modelCount += instCount;
          loadedCount++;
          this.requestRender();
          if (loadedCount === totalGroups) {
            console.log('[ThreeMapRenderer] doodad models:', modelCount, 'placed,', skipCount, 'skipped (no glb)');
          }
        }, undefined, (err) => {
          skipCount += group.instances.length;
          loadedCount++;
          if (loadedCount <= 3) console.log('[ThreeMapRenderer] doodad glb not found:', modelKey);
        });
      }
    }

    // -----------------------------------------------------------------------
    // Tree clearing — hide trees near player buildings
    // -----------------------------------------------------------------------

    // Building footprint in world units (WPM cells × 32). Buffer adds clearing space
    // beyond the footprint for worker access.
    static BUILDING_CLEAR_RADIUS = {
      htow: 320, hkee: 320, hcas: 320,
      ogre: 320, ostr: 320, ofrt: 320,
      etol: 300, etoa: 300, etoe: 300,
      unpl: 340, unp1: 340, unp2: 340,
      hbar: 270, hbla: 270, hlum: 270, halt: 270, harm: 270, hars: 270,
      obar: 270, obea: 270, ofor: 270, osld: 270, otto: 270, oalt: 270,
      eaom: 270, eaow: 270, eaoe: 270, eate: 270, edob: 270, eden: 270, edos: 270, etrp: 270,
      usep: 270, ugrv: 270, uaod: 270, uslh: 270, ubon: 270, utod: 270, usap: 270,
      hhou: 210, hwtw: 210, hgtw: 210, hatw: 210, hctw: 210,
      otrb: 210, owtw: 210,
      emow: 210,
      uzig: 230, uzg1: 230, uzg2: 230, utom: 230, ugol: 230,
      hvlt: 250, hshy: 250, ovln: 250, oshy: 250, egol: 250, eshy: 250, ushp: 250,
      hgra: 250
    };

    // Clear trees within radius of a world position. Uses scale(0,0,0) on InstancedMesh.
    clearTreesAroundPoint (wx, wy, radius) {
      if (!this._treeInstances) return false;
      const r2 = radius * radius;
      let cleared = false;
      const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
      const meshesChanged = new Set();

      for (const tree of this._treeInstances) {
        if (tree.hidden) continue;
        const dx = tree.wx - wx;
        const dy = tree.wy - wy;
        if (dx * dx + dy * dy < r2) {
          tree.mesh.setMatrixAt(tree.index, zeroMatrix);
          tree.hidden = true;
          meshesChanged.add(tree.mesh);
          cleared = true;
        }
      }

      for (const mesh of meshesChanged) {
        mesh.instanceMatrix.needsUpdate = true;
      }
      return cleared;
    }

    // Restore all hidden trees (for scrubbing backward)
    restoreAllTrees () {
      if (!this._treeInstances) return;
      const meshesChanged = new Set();
      for (const tree of this._treeInstances) {
        if (!tree.hidden) continue;
        tree.mesh.setMatrixAt(tree.index, tree.originalMatrix);
        tree.hidden = false;
        meshesChanged.add(tree.mesh);
      }
      for (const mesh of meshesChanged) {
        mesh.instanceMatrix.needsUpdate = true;
      }
    }

    // -----------------------------------------------------------------------
    // Building model rendering (neutral + player buildings)
    // -----------------------------------------------------------------------

    // Load building manifests (model mapping + texture mapping).
    // Call this once; then loadBuildingTexturesForModels() to fetch only needed textures.
    loadBuildingManifests () {
      this._buildingTextures = new Map();
      this._buildingTextureManifest = null;
      this._buildingModelManifest = null;

      // Cache buster to avoid stale GLB/JSON files
      this._buildingCacheBuster = '?v=' + Date.now();

      return Promise.all([
        fetch('/assets/textures/buildings/building-textures.json' + this._buildingCacheBuster)
          .then(r => r.ok ? r.json() : null)
          .then(manifest => { this._buildingTextureManifest = manifest; })
          .catch(() => {}),
        fetch('/assets/models/buildings/building-models.json' + this._buildingCacheBuster)
          .then(r => r.ok ? r.json() : null)
          .then(manifest => { this._buildingModelManifest = manifest; })
          .catch(() => {})
      ]);
    }

    // Load only the textures needed for a specific set of model names.
    // Much faster than loading all 160 textures when a map only uses ~10.
    loadBuildingTexturesForModels (neededModels) {
      if (!this._buildingTextureManifest || !neededModels.size) return Promise.resolve();
      const loader = new THREE.TextureLoader();
      const loads = [];
      for (const modelName of neededModels) {
        const pngBase = this._buildingTextureManifest[modelName];
        if (!pngBase) continue;
        if (this._buildingTextures.has(modelName)) continue;
        const url = '/assets/textures/buildings/' + pngBase + '.png';
        loads.push(new Promise(resolve => {
          loader.load(url, tex => {
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.flipY = false;
            tex.magFilter = THREE.LinearFilter;
            tex.minFilter = THREE.LinearMipmapLinearFilter;
            tex.generateMipmaps = true;
            this._buildingTextures.set(modelName, tex);
            resolve();
          }, undefined, () => resolve());
        }));
      }
      console.log('[ThreeMapRenderer] loading', loads.length, 'building textures (of',
        Object.keys(this._buildingTextureManifest).length, 'available)');
      return Promise.all(loads);
    }

    // Place static neutral buildings as 3D models (gold mines, shops, fountains, etc.)
    // Returns a Promise that resolves when all building models are loaded and placed.
    setupNeutralBuildingModels (neutralBuildings) {
      if (!neutralBuildings || !neutralBuildings.length || !this.ready) return Promise.resolve();
      if (!this._buildingModelManifest || !window.GLBLoader) return Promise.resolve();

      const loader = new window.GLBLoader();
      const ext = this.mapInfo.bounds.map;
      const mapCenterX = (ext[0][0] + ext[0][1]) / 2;
      const mapCenterY = (ext[1][0] + ext[1][1]) / 2;

      // Group by resolved model name
      const groups = {};
      for (const nb of neutralBuildings) {
        const modelName = this._buildingModelManifest[nb.type];
        if (!modelName) continue;
        if (!groups[modelName]) groups[modelName] = [];
        groups[modelName].push(nb);
      }

      const totalGroups = Object.keys(groups).length;
      console.log('[ThreeMapRenderer] loading neutral buildings:', neutralBuildings.length,
        'in', totalGroups, 'model groups');

      const loadPromises = [];
      const cb = this._buildingCacheBuster || '';
      for (const [modelName, instances] of Object.entries(groups)) {
        const url = '/assets/models/buildings/' + modelName + '.glb' + cb;
        loadPromises.push(new Promise(resolve => {
          loader.load(url, (result) => {
            if (!result) { resolve(); return; }
            console.log('[ThreeMapRenderer] neutral building loaded:', modelName,
              'isGroup:', !!(result && result.isGroup), 'instances:', instances.length);

            // result is either a Group (multi-primitive with textures) or BufferGeometry (legacy)
            for (const nb of instances) {
              const wx = nb.x;
              const wy = nb.y;
              // Lift buildings slightly above terrain to prevent ground clipping
              const groundY = this.sampleHeight(wx, wy) + 18;
              const s = (nb.scale && nb.scale[0]) || 1;

              let obj;
              if (result.isGroup) {
                obj = result.clone();
              } else {
                // Legacy single-geometry fallback
                const mat = new THREE.MeshLambertMaterial({ color: 0x998877, flatShading: true });
                obj = new THREE.Mesh(result, mat);
              }

              obj.position.set(wx - mapCenterX, groundY, -(wy - mapCenterY));
              obj.rotation.set(0, nb.rotation || 0, 0);
              obj.scale.set(s, s, s);
              this.scene.add(obj);
            }
            this.requestRender();
            resolve();
          }, undefined, () => { resolve(); });
        }));
      }
      return Promise.all(loadPromises).then(() => {
        console.log('[ThreeMapRenderer] neutral buildings placed');
      });
    }

    // Set up player buildings for dynamic visibility during replay playback.
    // Pre-creates a mesh for every building and toggles visibility per frame.
    // Returns a Promise that resolves when all models are loaded.
    setupPlayerBuildingModels (players) {
      if (!players || !this.ready) return Promise.resolve();
      if (!this._buildingModelManifest || !window.GLBLoader) return Promise.resolve();

      this._playerBuildings = [];

      const ext = this.mapInfo.bounds.map;
      const mapCenterX = (ext[0][0] + ext[0][1]) / 2;
      const mapCenterY = (ext[1][0] + ext[1][1]) / 2;

      // Collect all buildings from all players
      const buildingEntries = [];
      for (const player of players) {
        if (!player || !player.units) continue;
        for (const unit of player.units) {
          if (!unit.isBuilding) continue;
          const itemId = (unit.itemId || '').toLowerCase();
          const modelName = this._buildingModelManifest[itemId];
          if (!modelName) continue;

          const wx = unit.currentX || (unit.spawnPosition && unit.spawnPosition.x) || 0;
          const wy = unit.currentY || (unit.spawnPosition && unit.spawnPosition.y) || 0;
          if (wx === 0 && wy === 0) continue;

          buildingEntries.push({
            modelName,
            itemId,
            wx, wy,
            readyTime: unit.readyTime || unit.constructionStartTime || unit.spawnTime || 0,
            destroyedAt: unit.destroyedAt || null,
            playerColor: player.playerColor || '#cccccc'
          });
        }
      }

      if (!buildingEntries.length) return Promise.resolve();

      // Group by model to batch-load geometries
      const byModel = {};
      for (const entry of buildingEntries) {
        if (!byModel[entry.modelName]) byModel[entry.modelName] = [];
        byModel[entry.modelName].push(entry);
      }

      const loader = new window.GLBLoader();
      const totalModels = Object.keys(byModel).length;
      console.log('[ThreeMapRenderer] loading player buildings:', buildingEntries.length,
        'buildings,', totalModels, 'unique models');

      const loadPromises = [];
      const pcb = this._buildingCacheBuster || '';
      for (const [modelName, entries] of Object.entries(byModel)) {
        const url = '/assets/models/buildings/' + modelName + '.glb' + pcb;
        loadPromises.push(new Promise(resolve => {
          loader.load(url, (result) => {
            if (!result) { resolve(); return; }

            for (const entry of entries) {
              const groundY = this.sampleHeight(entry.wx, entry.wy) + 18;
              const teamColor = new THREE.Color(entry.playerColor);

              let obj;
              if (result.isGroup) {
                obj = result.clone();
                // Add subtle team color emissive to all child materials
                obj.traverse(child => {
                  if (child.isMesh && child.material) {
                    child.material = child.material.clone();
                    if (child.material.uniforms && child.material.uniforms.emissiveColor) {
                      child.material.uniforms.emissiveColor.value = teamColor;
                      child.material.uniforms.emissiveIntensity.value = 0.15;
                    } else if (child.material.emissive) {
                      child.material.emissive = teamColor;
                      child.material.emissiveIntensity = 0.15;
                    }
                  }
                });
              } else {
                // Legacy single-geometry fallback
                const mat = new THREE.MeshLambertMaterial({
                  color: 0x998877, flatShading: true,
                  emissive: teamColor, emissiveIntensity: 0.3
                });
                obj = new THREE.Mesh(result, mat);
              }

              obj.position.set(
                entry.wx - mapCenterX,
                groundY,
                -(entry.wy - mapCenterY)
              );
              obj.visible = false;
              this.scene.add(obj);

              this._playerBuildings.push({
                mesh: obj,
                readyTime: entry.readyTime,
                destroyedAt: entry.destroyedAt,
                wx: entry.wx,
                wy: entry.wy,
                itemId: entry.itemId,
                _treesCleared: false
              });
            }

            this.requestRender();
            resolve();
          }, undefined, () => { resolve(); });
        }));
      }
      return Promise.all(loadPromises).then(() => {
        console.log('[ThreeMapRenderer] player buildings ready:', this._playerBuildings.length);
      });
    }

    // Update player building visibility based on current game time.
    // Called each frame during replay playback.
    updatePlayerBuildings (gameTime) {
      if (!this._playerBuildings) return;
      let changed = false;

      // Detect if we scrubbed backward — need to restore trees
      if (this._lastBuildingGameTime !== undefined && gameTime < this._lastBuildingGameTime - 1000) {
        this.restoreAllTrees();
        for (const b of this._playerBuildings) b._treesCleared = false;
      }
      this._lastBuildingGameTime = gameTime;

      for (const b of this._playerBuildings) {
        const visible = gameTime >= b.readyTime && (!b.destroyedAt || gameTime < b.destroyedAt);
        if (b.mesh.visible !== visible) {
          b.mesh.visible = visible;
          changed = true;

          // Clear trees when a building first appears
          if (visible && !b._treesCleared) {
            const radius = ThreeMapRenderer.BUILDING_CLEAR_RADIUS[b.itemId] || 200;
            this.clearTreesAroundPoint(b.wx, b.wy, radius);
            b._treesCleared = true;
          }
        }
      }
      if (changed) this.requestRender();
    }

    // Expose player buildings for subsystems (BuildingProgressBar, BuildingSplats)
    get playerBuildings () {
      return this._playerBuildings || [];
    }

    // Render the 3D scene focused on a player's base area into a target canvas.
    // Used by BuildingPlacementViewer to capture a 3D snapshot of the base.
    // snapshotBuildings: [{itemId, x, y}] — buildings to show in this snapshot
    renderBaseSnapshot (baseGrid, snapshotBuildings, targetCanvas) {
      if (!this.ready || !this.renderer) return false;

      const ext = this.mapInfo.bounds.map;
      const mapCenterX = (ext[0][0] + ext[0][1]) / 2;
      const mapCenterY = (ext[1][0] + ext[1][1]) / 2;

      // Base bounds in Three.js world coordinates
      const bx = baseGrid.originX - mapCenterX;
      const by = -(baseGrid.originY - mapCenterY);
      const bw = baseGrid.cols * baseGrid.cellSize;
      const bh = baseGrid.rows * baseGrid.cellSize;
      const cx = bx + bw / 2;
      const cz = by + bh / 2;

      // Save current state
      const savedCamPos = this.camera.position.clone();
      const savedCamFov = this.camera.fov;
      const savedCamNear = this.camera.near;
      const savedCamFar = this.camera.far;
      const savedTarget = this._camFocus ? this._camFocus.clone() : new THREE.Vector3();
      const savedSize = { w: this.renderer.domElement.width, h: this.renderer.domElement.height };

      // Save player building visibility
      const savedBuildingVis = [];
      if (this._playerBuildings) {
        for (const b of this._playerBuildings) {
          savedBuildingVis.push(b.mesh.visible);
        }
      }

      // Save tree hidden state
      const savedTreeState = [];
      if (this._treeInstances) {
        for (const t of this._treeInstances) savedTreeState.push(t.hidden);
      }

      // Show only the snapshot buildings, hide others
      if (this._playerBuildings) {
        for (const b of this._playerBuildings) b.mesh.visible = false;
        // Match snapshot buildings by position
        for (const sb of snapshotBuildings) {
          for (const b of this._playerBuildings) {
            if (Math.abs(b.wx - sb.x) < 10 && Math.abs(b.wy - sb.y) < 10) {
              b.mesh.visible = true;
              break;
            }
          }
        }
      }

      // Clear trees around snapshot buildings
      this.restoreAllTrees();
      for (const sb of snapshotBuildings) {
        const radius = ThreeMapRenderer.BUILDING_CLEAR_RADIUS[sb.itemId] || 200;
        this.clearTreesAroundPoint(sb.x, sb.y, radius);
      }

      // Position camera for top-down-ish view of base
      const tiltRad = CAMERA_TILT_DEG * Math.PI / 180;
      const baseSize = Math.max(bw, bh);
      const fovRad = this.camera.fov * Math.PI / 180;
      const fitDist = (baseSize / 2) / Math.tan(fovRad / 2) * 1.3;
      const camHeight = Math.cos(tiltRad) * fitDist;
      const camOffset = Math.sin(tiltRad) * fitDist;

      this.camera.position.set(cx, camHeight, cz + camOffset);
      this.camera.near = 10;
      this.camera.far = fitDist * 4;
      this.camera.lookAt(cx, 0, cz);
      this.camera.updateProjectionMatrix();

      // Render to the main renderer at target canvas size
      const tw = targetCanvas.width;
      const th = targetCanvas.height;
      this.renderer.setSize(tw, th, false);
      this.camera.aspect = tw / th;
      this.camera.updateProjectionMatrix();
      this.renderer.render(this.scene, this.camera);

      // Copy rendered image to target canvas
      const targetCtx = targetCanvas.getContext('2d');
      targetCtx.drawImage(this.renderer.domElement, 0, 0);

      // Restore renderer size
      this.renderer.setSize(savedSize.w, savedSize.h, false);

      // Restore camera
      this.camera.position.copy(savedCamPos);
      this.camera.fov = savedCamFov;
      this.camera.near = savedCamNear;
      this.camera.far = savedCamFar;
      this.camera.aspect = savedSize.w / savedSize.h;
      this.camera.lookAt(savedTarget);
      this.camera.updateProjectionMatrix();

      // Restore tree state
      if (this._treeInstances) {
        this.restoreAllTrees();
        const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
        const meshesChanged = new Set();
        for (let i = 0; i < this._treeInstances.length; i++) {
          if (savedTreeState[i]) {
            const t = this._treeInstances[i];
            t.mesh.setMatrixAt(t.index, zeroMatrix);
            t.hidden = true;
            meshesChanged.add(t.mesh);
          }
        }
        for (const m of meshesChanged) m.instanceMatrix.needsUpdate = true;
      }

      // Restore building visibility
      if (this._playerBuildings) {
        for (let i = 0; i < this._playerBuildings.length; i++) {
          this._playerBuildings[i].mesh.visible = savedBuildingVis[i];
        }
      }

      // Re-render main view
      this.requestRender();
      return true;
    }

    // Request a single render frame (for use after async model loads when
    // the main render loop isn't running yet).
    requestRender () {
      if (this._pendingRender) return;
      this._pendingRender = true;
      requestAnimationFrame(() => {
        this._pendingRender = false;
        this.render();
      });
    }
  }

  window.ThreeMapRenderer = ThreeMapRenderer;
})();
