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
  // Gated debug logger — routes through WC3V_CONFIG so the ~15 per-load
  // [ThreeMapRenderer] debug lines stay silent in production (logging.three).
  // console.warn paths are intentionally left raw — they report real failures.
  const _tlog = (...args) => {
    if (typeof window !== 'undefined' && window.WC3V_CONFIG) window.WC3V_CONFIG.log('three', ...args);
  };

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
        // Opaque canvas: the clear color is opaque and scene.background is
        // set, so an alpha channel only added compositing cost. The 2D
        // overlay canvases stack ABOVE this one; nothing shows through it.
        alpha: false,
        // r160 still defaults stencil to true — nothing here uses stencil,
        // and dropping the attachment saves bandwidth on every clear.
        stencil: false,
        // Ask for the discrete GPU on dual-GPU laptops. The default lets the
        // browser pick the integrated chip for battery, which is exactly the
        // hardware this scene struggles on.
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false
      });
      // NOTE: no setPixelRatio here — resize() owns the buffer size and pins
      // pixelRatio to 1 (the buffer is sized to the map image, not the CSS
      // box, so DPR must not scale it again).
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

      // Teardown bookkeeping. Loading a second replay constructs a fresh
      // ThreeMapRenderer (app.js setup()), so the old instance MUST release
      // its WebGL context + GPU resources via dispose() or contexts leak
      // (browsers cap live contexts at ~16). See dispose() / requestRender().
      this._disposed = false;
      this._rafId = null;
    }

    // The viewer's LoadingScreen, when present. All progress calls below are
    // no-ops without it (headless construction, tests, missing subsystem).
    _loading () {
      return (this.viewer && this.viewer.loading) || null;
    }

    // Load binary heightmap from /maps/{name}/heights.bin.gz.
    // Returns a promise resolving to { cols, rows, minH, maxH, ground: Float32Array, water: Float32Array }.
    loadHeights (mapName) {
      const url = `/maps/${mapName}/heights.bin.gz`;
      const ls = this._loading();
      if (ls) ls.setDetail('terrain', 'Height data');
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
      // Only CLIFF palette textures are loaded. Ground palette PNGs became
      // dead weight when terrain baking landed — the baked terrain.jpg is the
      // ground, and the only paletteTextures reads left are cliff codes (the
      // slot>0 materials in setupTerrain and setupCliffModels). `paletteCodes`
      // stays in the signature because heights.bin still carries it.
      const cliffCodes = cliffPaletteCodes || [];
      const cliffLoads = cliffCodes.map(code =>
        loadOne(code, '/assets/terrain/cliff', configureCliffTex)
      );
      return Promise.all(cliffLoads).then(results => {
        this.paletteTextures = new Map();
        for (const { code, tex } of results) {
          this.paletteTextures.set(code, tex);
        }
        const nCliff = results.filter(r => r.tex).length;
        _tlog(`[ThreeMapRenderer] loaded ${nCliff}/${cliffCodes.length} cliff textures for tileset ${tilesetChar}`);
        return this.paletteTextures;
      });
    }

    // Load the baked terrain texture (multi-layer composited in regen-maps).
    //
    // This is the single largest download of a viewer session (2–110 MB
    // depending on the map), so it streams via fetch + reader for real byte
    // progress — THREE.TextureLoader goes through an <img> and cannot report
    // progress at all. createImageBitmap also decodes the JPEG off the main
    // thread. Falls back to the old TextureLoader path on any failure.
    loadTerrainTexture (mapName) {
      const url = `/maps/${mapName}/terrain.jpg`;
      const configure = (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        return tex;
      };
      const legacy = () => new Promise((resolve) => {
        const loader = new THREE.TextureLoader();
        loader.load(url, tex => resolve(configure(tex)), undefined, () => resolve(null));
      });
      if (typeof createImageBitmap !== 'function') return legacy();

      const ls = this._loading();
      if (ls) ls.setDetail('terrain', 'Streaming terrain texture');

      const streamToTexture = (texUrl, mime) => fetch(texUrl)
        .then(res => {
          if (!res.ok) throw new Error(`terrain fetch ${res.status}`);
          if (!res.body || !res.body.getReader) return res.blob();
          const total = parseInt(res.headers.get('Content-Length'), 10) || 0;
          const reader = res.body.getReader();
          const chunks = [];
          let loaded = 0;
          const pump = () => reader.read().then(({ done, value }) => {
            if (done) return new Blob(chunks, { type: mime });
            chunks.push(value);
            loaded += value.byteLength;
            if (ls) ls.stepBytes('terrain', loaded, total);
            return pump();
          });
          return pump();
        })
        // TextureLoader textures default to flipY=true (flipped at GPU upload).
        // For ImageBitmap we pre-flip at decode and set flipY=false — same
        // final orientation, verified recipe (see MDX→glTF memory notes).
        .then(blob => createImageBitmap(blob, { imageOrientation: 'flipY' }))
        .then(bitmap => {
          const tex = new THREE.Texture(bitmap);
          tex.flipY = false;
          configure(tex);
          tex.needsUpdate = true;
          return tex;
        });

      // terrain.webp (tools/optimize-terrain.js output: capped edge + WebP,
      // 3-10x smaller than the source jpg) is preferred; maps that haven't
      // been optimized yet fall back to terrain.jpg, then to TextureLoader.
      return streamToTexture(`/maps/${mapName}/terrain.webp`, 'image/webp')
        .catch(() => streamToTexture(url, 'image/jpeg'))
        .catch(() => legacy());
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
      this._freezeMatrix(mesh);
      this.terrainMesh = mesh;
      _tlog('[ThreeMapRenderer] multi-material terrain:',
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
        // forceSinglePass: three r155+ otherwise renders every transparent
        // double-sided material twice per object per frame (back faces then
        // front faces), version-bumping the material before each pass — a
        // full program re-resolve plus a doubled draw, every frame, for a
        // water sheet the camera only ever sees from above.
        forceSinglePass: true,
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
      this._freezeMatrix(waterMesh);
      this.waterMesh = waterMesh;
      _tlog('[ThreeMapRenderer] terrain Y range', minY.toFixed(1), '..', maxY.toFixed(1),
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
      _tlog('[ThreeMapRenderer] camera fit', { mapMajor, fitDistance, camDist, camHeight, camOffset });

      // Fog of war — darkens non-playable map edges. Pass gameScaler so the
      // fog uses the true playable bounds (gridSize.margins) instead of the
      // smaller in-game camera pan box, which would clip fog into playable
      // terrain at the south edge of most maps.
      if (window.FogOfWar) {
        this.fogOfWar = new FogOfWar(
          this.scene, mapInfo, worldWidth, worldHeight, maxY + 20, gameScaler
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
      // w/h are the LOGICAL size (the same map-image dimensions the 2D canvases
      // use as their coordinate space). renderScale is the fraction of that we
      // actually rasterize — which is exactly what three's pixelRatio means, so
      // setSize(logical) + setPixelRatio(r) gives a buffer of logical×r while
      // the camera keeps the same aspect and projectToCanvas (which projects
      // into gameScaler.sceneImage) needs no change at all.
      const r = (gs && gs.renderScale) || 1;
      this.renderer.setPixelRatio(r);
      this.renderer.setSize(w, h, false);
      // Do NOT reassign canvas.width/height here — setSize already sized the
      // drawing buffer to w×r, and overwriting it with the logical size would
      // throw away the whole point (and desync the GL viewport).
      if (this.camera && this.camera.isPerspectiveCamera) {
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
      }
    }

    render (transform) {
      if (this._disposed || !this.ready) return;
      if (transform) this.syncTransform(transform);
      if (this.waterMesh && this.waterMesh.material.uniforms) {
        this.waterMesh.material.uniforms.uTime.value = performance.now() / 1000;
      }
      this.animateLevelPins();
      this._updateGuideRings();

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
      this._freezeMatrix(trunkMesh);
      this._freezeMatrix(leafMesh);
      this.trunkMesh = trunkMesh;
      this.leafMesh = leafMesh;
      _tlog('[ThreeMapRenderer] spawned', count, 'trees');
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
    // `out` (optional) receives {x,y} instead of a fresh object. Every 2D
    // overlay projects several points per unit per frame, so the two literals
    // this used to allocate per point (one here, one in GameScaler.projectXY)
    // were a steady GC drip proportional to unit count.
    projectToCanvas (wx, wy, out) {
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

      // Vector4 (not Vector3) so we keep the homogeneous w after the projection
      // matrix multiply — needed to reject points behind the camera. Vector3's
      // applyMatrix4 silently divides by w and produces flipped NDC for w<=0,
      // which is what caused the "camp icons scattered across the canvas" bug
      // when the camera zoomed in for FOLLOW_HERO (P1/P2) mode.
      if (!this._projVec4) this._projVec4 = new THREE.Vector4();

      // Cache the combined viewProjection matrix once per frame (set in render())
      if (!this._viewProjMatrix) this._viewProjMatrix = new THREE.Matrix4();
      if (this._projMatrixCached && !this._viewProjDirty) {
        // Already cached from last render() call
      } else {
        // matrixWorldInverse only auto-refreshes during render(); call this
        // explicitly when projecting between a camera move and the next frame.
        this.camera.updateMatrixWorld(true);
        this._viewProjMatrix.multiplyMatrices(
          this.camera.projectionMatrix,
          this.camera.matrixWorldInverse
        );
        this._viewProjDirty = false;
      }

      this._projVec4.set(
        wx - mapCenterX,
        this.sampleHeight(wx, wy),
        -(wy - mapCenterY),
        1
      );
      this._projVec4.applyMatrix4(this._viewProjMatrix);

      if (this._projVec4.w <= 0) return null;            // behind camera
      const ndcX = this._projVec4.x / this._projVec4.w;
      const ndcY = this._projVec4.y / this._projVec4.w;
      if (ndcX < -1 || ndcX > 1 || ndcY < -1 || ndcY > 1) return null;  // outside frustum

      const px = (ndcX + 1) * 0.5 * cw;
      const py = (1 - ndcY) * 0.5 * ch;
      if (out) { out.x = px; out.y = py; return out; }
      return { x: px, y: py };
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
          depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.renderOrder = 2;
        this.scene.add(mesh);

        // Wider glow ribbon
        const glowGeo = geo.clone();
        const glowMat = new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.15,
          depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true
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
          depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true
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
          depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true
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
      // for..in over the object instead of Object.values(), which allocated a
      // fresh array every frame. The bob also ASSIGNS from a remembered base
      // height — it used to `+=` a sine, accumulating a random walk that
      // drifted the pins upward over the course of a match.
      for (const id in this._levelPins) {
        const pin = this._levelPins[id];
        if (!pin) continue;
        if (pin._baseY === undefined) pin._baseY = pin.position.y;
        pin.rotation.y = t * 0.5;                          // slow spin
        pin.position.y = pin._baseY + Math.sin(t * 2) * 5; // subtle bob (~1/3 of the pin's 15u radius)
      }
    }

    // ── Guided-walkthrough ground glow ───────────────────────────────────────
    // A soft additive gold halo laid FLAT on the terrain under each highlighted
    // building / creep camp. The object renders in front of it (it's on the
    // ground, depthWrite off), so — unlike the old screen-space gold ring — it
    // physically cannot cover the building, its nameplate, or HP bars. Buildings
    // are instanced with shared materials so we can't glow a single building's
    // body; this halo is the per-building cue instead. Pooled + reused.
    //
    // specs: [{ key, wx, wy, colorHex, r?, itemId? }] — r in world units, else
    //   derived from the building's footprint table; `key` is stable per target
    //   so each halo flashes once (when its target first appears) then fades out.
    //   null/empty specs hides all.
    highlightGroundRings (specs, epoch) {
      if (!this._hlGlows) this._hlGlows = [];
      // A new step (epoch = its start time) forgets prior first-seen times so
      // every target of the new step flashes again — otherwise a building still
      // highlighted from the previous step would show up already-faded.
      if (epoch !== this._glowEpoch) { this._glowSeen = {}; this._glowEpoch = epoch; }
      if (!this._glowSeen) this._glowSeen = {};
      for (const g of this._hlGlows) g.visible = false;
      if (!specs || !specs.length || !this.scene) { this._hlActive = null; return; }
      // Shared geometry + texture; PER-glow material so each halo can fade on its
      // own timeline (a building built mid-step flashes when IT appears, not at
      // step start). depthTest OFF: a flat halo at one ground height gets clipped
      // wherever surrounding terrain rises above it — ignoring depth keeps the
      // whole halo visible (reads as projected light) and lightly washes the
      // building's base gold; it never covers the upper body or the (separate
      // canvas) nameplates/HP bars.
      if (!this._hlGlowGeo) this._hlGlowGeo = new THREE.PlaneGeometry(2, 2);
      const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const ext = this.mapInfo.bounds.map;
      const cx = (ext[0][0] + ext[0][1]) / 2;
      const cy = (ext[1][0] + ext[1][1]) / 2;
      const liveKeys = {};
      for (let i = 0; i < specs.length; i++) {
        const s = specs[i];
        const key = s.key || ('p' + i);
        liveKeys[key] = true;
        if (this._glowSeen[key] == null) this._glowSeen[key] = now; // first appearance → start its flash+fade
        let g = this._hlGlows[i];
        if (!g) {
          g = new THREE.Mesh(this._hlGlowGeo, new THREE.MeshBasicMaterial({
            map: this._guideGlowTexture(), transparent: true, depthWrite: false, depthTest: false,
            blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, forceSinglePass: true
          }));
          g.rotation.x = -Math.PI / 2;   // lay flat on the ground (XZ plane)
          g.renderOrder = 4;
          g.frustumCulled = false;
          this.scene.add(g);
          this._hlGlows[i] = g;
        }
        const r = (s.r != null)
          ? s.r
          : ((ThreeMapRenderer.BUILDING_CLEAR_RADIUS[s.itemId] || 260) * 0.62);
        const gy = (this.sampleHeight ? this.sampleHeight(s.wx, s.wy) : 0) + 3;
        g.position.set(s.wx - cx, gy, -(s.wy - cy));
        g._baseR = Math.max(80, r);
        g.scale.setScalar(g._baseR);
        g.material.color.set(s.colorHex || '#ffce3a');
        g._seenAt = this._glowSeen[key];
        g.visible = true;
      }
      // Forget targets that are no longer highlighted, so a target that genuinely
      // re-appears later flashes again.
      for (const k in this._glowSeen) { if (!liveKeys[k]) delete this._glowSeen[k]; }
      this._hlActive = { count: specs.length };
    }

    // White radial halo + a defined rim ring, drawn once and tinted per-use via
    // material.color (so additive blending glows in the highlight colour).
    _guideGlowTexture () {
      if (this._hlGlowTex) return this._hlGlowTex;
      const S = 256, c = document.createElement('canvas');
      c.width = c.height = S;
      const ctx = c.getContext('2d');
      const cx = S / 2, cy = S / 2;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 0.5);
      grad.addColorStop(0, 'rgba(255,255,255,0.18)');
      grad.addColorStop(0.55, 'rgba(255,255,255,0.06)');
      grad.addColorStop(0.74, 'rgba(255,255,255,0.0)');
      grad.addColorStop(1, 'rgba(255,255,255,0.0)');
      ctx.fillStyle = grad; ctx.fillRect(0, 0, S, S);
      // a soft wide rim then a crisp inner rim, for a defined-but-glowy ring
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 22;
      ctx.beginPath(); ctx.arc(cx, cy, S * 0.40, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,1)'; ctx.lineWidth = 9;
      ctx.beginPath(); ctx.arc(cx, cy, S * 0.40, 0, Math.PI * 2); ctx.stroke();
      const tex = new THREE.CanvasTexture(c);
      if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
      this._hlGlowTex = tex;
      return tex;
    }

    // Per-frame pulse for the guide ground glow. Each halo flashes hard when its
    // target first appears (loud), then FADES OUT to nothing a few seconds later
    // (vis) — so highlights never linger and pile up over a step's playback. Time
    // is per-glow (g._seenAt), driven by performance.now so it animates while
    // paused. A faded-out halo stays hidden for the rest of the step (its key
    // remains "seen") and won't re-flash unless the target genuinely re-appears.
    _updateGuideRings () {
      if (!this._hlActive || !this._hlGlows) return;
      const GLOW_HOLD_MS = 900;    // full strength for the initial grab
      const GLOW_FADE_MS = 2400;   // then fade to gone over this long
      const now = performance.now();
      const pulse = 0.5 + 0.5 * Math.sin(now / 300);
      for (let i = 0; i < this._hlActive.count; i++) {
        const g = this._hlGlows[i];
        if (!g || !g.visible) continue;
        const age = now - (g._seenAt || now);
        const loud = Math.max(0, 1 - age / 1700);
        const vis = (age <= GLOW_HOLD_MS) ? 1 : Math.max(0, 1 - (age - GLOW_HOLD_MS) / GLOW_FADE_MS);
        if (vis <= 0.01) { g.visible = false; continue; }
        g.material.opacity = (0.55 + 0.4 * loud + 0.14 * pulse) * vis;
        g.scale.setScalar(g._baseR * (1 + 0.05 * pulse));
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
          this._freezeMatrix(mesh);
          this.requestRender();
          loadedCount++;
          if (loadedCount === totalGroups) {
            _tlog('[ThreeMapRenderer] loaded', placements.length,
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
    // `usedTypeCodes` (optional Set of lowercase 4-char doodad type codes,
    // from the map's doo.json) narrows the preload to textures the map can
    // actually reference — the manifest lists ~93 textures (~6.7 MB) but a
    // typical map uses a fraction. Null/empty loads everything (safety).
    // Per-type doodad/destructable scale + pinned rotation, straight from the
    // game's own skin files (tools/extract-model-scale.js). Only the types that
    // differ from the defaults are in the file, so a miss means "defaults".
    //
    // war3map.doo carries a per-INSTANCE scale that the renderer already honours,
    // but WC3 multiplies that by the TYPE's defScale, which nothing here read.
    // 63 of 568 doodad types have a defScale other than 1 — the worst is 0.360,
    // i.e. rendering roughly 2.8x too large.
    loadDoodadScales () {
      if (this._doodadScales) return Promise.resolve();
      this._doodadScales = {};
      return fetch('/assets/models/doodad-scales.json')
        .then(r => (r.ok ? r.json() : null))
        .then(d => { if (d) this._doodadScales = d; })
        .catch(() => {});
    }

    loadDoodadTextures (tilesetChar, usedTypeCodes) {
      this._doodadTextureManifest = null;
      this._doodadTextures = new Map();
      this.loadDoodadScales();
      return fetch('/assets/textures/doodad-textures.json')
        .then(res => res.ok ? res.json() : null)
        .then(manifest => {
          if (!manifest) return;
          this._doodadTextureManifest = manifest;
          const loader = new THREE.TextureLoader();
          const loads = [];

          // Resolve which replaceable IDs / direct images the used type codes
          // reference. A missed entry degrades to the flat-color fallback.
          let neededReplaceable = null;
          let neededDirect = null;
          if (usedTypeCodes && usedTypeCodes.size && manifest.modelTextures) {
            neededReplaceable = new Set();
            neededDirect = new Set();
            for (const code of usedTypeCodes) {
              const info = manifest.modelTextures[code];
              if (!info) continue;
              if (info.replaceableId > 0) neededReplaceable.add(String(info.replaceableId));
              else if (info.image) neededDirect.add(info.image.toLowerCase());
            }
          }

          // Preload the tree texture for this tileset from each replaceable ID
          for (const [id, tilesets] of Object.entries(manifest.replaceable)) {
            if (neededReplaceable && !neededReplaceable.has(String(id))) continue;
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
            if (neededDirect && !neededDirect.has(blpPath.toLowerCase())) continue;
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

          const ls = this._loading();
          if (ls && loads.length) {
            ls.setDetail('doodads', 'Doodad textures');
            ls.stepAddTotal('doodads', loads.length);
            loads.forEach(p => p.then(() => ls.stepTick('doodads')));
          }
          return Promise.all(loads);
        })
        .then(() => {
          _tlog('[ThreeMapRenderer] doodad textures loaded:', this._doodadTextures.size);
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
    // Returns a Promise resolving once every model group has loaded (or
    // failed) — callers can await tree placement instead of racing it.
    setupDoodadModels (doodadData) {
      if (!doodadData || !this.ready) return Promise.resolve();
      if (!window.GLBLoader) {
        this.setupDoodads(doodadData);
        this.requestRender();
        return Promise.resolve();
      }
      const doodads = Array.isArray(doodadData) ? doodadData : doodadData.grid;
      if (!doodads || !doodads.length) return Promise.resolve();

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
      _tlog('[ThreeMapRenderer] loading doodad models:', doodads.length, 'doodads in', totalGroups, 'groups');
      if (totalGroups === 0) return Promise.resolve();

      const ls = this._loading();
      if (ls) {
        ls.setDetail('doodads', 'Tree & doodad models');
        ls.stepAddTotal('doodads', totalGroups);
      }
      let resolveAll;
      const allPlaced = new Promise(resolve => { resolveAll = resolve; });
      // Single accounting point for every per-group outcome (placed, no
      // geometry, missing .glb) — drives both the overlay tick and the
      // completion promise.
      const groupSettled = () => {
        loadedCount++;
        if (ls) ls.stepTick('doodads');
        if (loadedCount === totalGroups) resolveAll();
      };

      for (const [modelKey, group] of Object.entries(groups)) {
        const url = '/assets/models/trees/' + modelKey + '.glb';
        loader.load(url, (geo) => {
          if (!geo || geo.isGroup) { groupSettled(); return; }

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
              forceSinglePass: true,
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

          // Type-level scale / pinned rotation. Multiplies the per-instance
          // values the map author set — see loadDoodadScales.
          const typeInfo = (this._doodadScales && this._doodadScales[baseType]) || null;
          const typeScale = (typeInfo && typeInfo.s) || 1;
          const pinnedRot = typeInfo && typeInfo.r != null ? typeInfo.r : null;

          for (let i = 0; i < instCount; i++) {
            const d = group.instances[i];
            const wx = parseFloat(d.position.x);
            const wy = parseFloat(d.position.y);
            const groundY = this.sampleHeight(wx, wy);
            const s = ((d.scale && d.scale[0]) || 1) * typeScale;

            dummy.position.set(wx - mapCenterX, groundY, -(wy - mapCenterY));
            dummy.rotation.set(0, pinnedRot != null ? pinnedRot : (d.angle || 0), 0);
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
          // Trees can be hidden later (clearTreesAroundPoint) via setMatrixAt
          // + instanceMatrix.needsUpdate — that path doesn't need per-frame
          // matrixAutoUpdate, so freezing the mesh transform is safe.
          this._freezeMatrix(mesh);
          modelCount += instCount;
          this.requestRender();
          groupSettled();
          if (loadedCount === totalGroups) {
            _tlog('[ThreeMapRenderer] doodad models:', modelCount, 'placed,', skipCount, 'skipped (no glb)');
          }
        }, undefined, (err) => {
          skipCount += group.instances.length;
          groupSettled();
          if (loadedCount <= 3) _tlog('[ThreeMapRenderer] doodad glb not found:', modelKey);
        });
      }
      return allPlaced;
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

    // Load the building model manifest (itemId → model name mapping).
    loadBuildingManifests () {
      this._buildingTextures = new Map();
      this._buildingModelManifest = null;

      const ls = this._loading();
      if (ls) ls.setDetail('buildings', 'Building manifests');

      // Cache buster for GLB/JSON files. In dev, bust on every load so local
      // asset edits show up immediately; in production use the stable
      // WC3V_CONFIG.assetVersion so the browser + CDN can actually cache these
      // (the heaviest assets the viewer fetches) across replay loads.
      const cfg = (typeof window !== 'undefined' && window.WC3V_CONFIG) || null;
      this._buildingCacheBuster = (cfg && cfg.isDev)
        ? ('?v=' + Date.now())
        : ('?v=' + ((cfg && cfg.assetVersion) || '2'));

      // Building textures are embedded in the GLBs — the old standalone
      // building-textures.json (+ its 160 PNGs) had no live consumer and is
      // no longer fetched.
      return fetch('/assets/models/buildings/building-models.json' + this._buildingCacheBuster)
        .then(r => r.ok ? r.json() : null)
        .then(manifest => { this._buildingModelManifest = manifest; })
        .catch(() => {});
    }

    // itemId -> { model, scale }.
    //
    // `scale` is the game's Art Scaling Value (unitskin.txt `modelScale`), written
    // into the manifest by tools/patch-model-scale.js. It is 1 for most buildings
    // and is what separates Tree of Life / Ages / Eternity, which are one MDX.
    //
    // Older deployed manifests are `itemId -> "modelName"` strings; R2 serves these
    // with a long cache, so tolerate both shapes rather than rendering nothing.
    _buildingSpec (itemId) {
      const m = this._buildingModelManifest;
      const v = m && m[itemId];
      if (!v) return null;
      if (typeof v === 'string') return { model: v, scale: 1 };
      return v.model ? { model: v.model, scale: v.scale || 1 } : null;
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
        const spec = this._buildingSpec(nb.type);
        if (!spec) continue;
        if (!groups[spec.model]) groups[spec.model] = [];
        groups[spec.model].push(nb);
        nb._modelScale = spec.scale;
      }

      const totalGroups = Object.keys(groups).length;
      _tlog('[ThreeMapRenderer] loading neutral buildings:', neutralBuildings.length,
        'in', totalGroups, 'model groups');

      const ls = this._loading();
      if (ls && totalGroups) {
        ls.setDetail('buildings', 'Neutral buildings');
        ls.stepAddTotal('buildings', totalGroups);
      }

      const loadPromises = [];
      const cb = this._buildingCacheBuster || '';
      for (const [modelName, instances] of Object.entries(groups)) {
        const url = '/assets/models/buildings/' + modelName + '.glb' + cb;
        loadPromises.push(new Promise(resolve => {
          loader.load(url, (result) => {
            if (!result) { resolve(); return; }
            _tlog('[ThreeMapRenderer] neutral building loaded:', modelName,
              'isGroup:', !!(result && result.isGroup), 'instances:', instances.length);

            // result is either a Group (multi-primitive with textures) or BufferGeometry (legacy)
            for (const nb of instances) {
              const wx = nb.x;
              const wy = nb.y;
              // Lift buildings slightly above terrain to prevent ground clipping
              const groundY = this.sampleHeight(wx, wy) + 18;
              // Two independent multipliers, both game data:
              //   nb.scale     — the per-instance scale the map author set in
              //                  war3mapUnits.doo (parsed by lib/parsers/UNITFile.js)
              //   _modelScale  — the unit type's Art Scaling Value
              const s = ((nb.scale && nb.scale[0]) || 1) * (nb._modelScale || 1);

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
              // Neutral buildings never move — a cloned multi-primitive Group
              // is a whole subtree that scene.updateMatrixWorld would otherwise
              // re-walk every frame, once per instance.
              this._freezeMatrix(obj);
            }
            this.requestRender();
            resolve();
          }, undefined, () => { resolve(); });
        }));
      }
      if (ls) loadPromises.forEach(p => p.then(() => ls.stepTick('buildings')));
      return Promise.all(loadPromises).then(() => {
        _tlog('[ThreeMapRenderer] neutral buildings placed');
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
          const wx = unit.currentX || (unit.spawnPosition && unit.spawnPosition.x) || 0;
          const wy = unit.currentY || (unit.spawnPosition && unit.spawnPosition.y) || 0;
          if (wx === 0 && wy === 0) continue;

          const readyTime = unit.readyTime || unit.constructionStartTime || unit.spawnTime || 0;
          const destroyedAt = unit.destroyedAt || null;

          // A building's exported itemId is its FINAL form. upgradeSteps (hall
          // tiers, tower/ziggurat upgrades) carry each upgrade's completion
          // time, so each form gets its own windowed record: the Town Hall
          // model until the Keep completes, the Keep model after. Windows abut
          // exactly — visible is t >= readyTime && t < destroyedAt.
          const steps = (unit.upgradeSteps && unit.upgradeSteps.length && unit.initialItemId)
            ? unit.upgradeSteps : null;
          const forms = steps
            ? [{ itemId: unit.initialItemId, from: readyTime }]
                .concat(steps.map(s => ({ itemId: s.itemId, from: s.at })))
            : [{ itemId: unit.itemId, from: readyTime }];

          for (let fi = 0; fi < forms.length; fi++) {
            const itemId = (forms[fi].itemId || '').toLowerCase();
            const spec = this._buildingSpec(itemId);
            if (!spec) continue;
            buildingEntries.push({
              modelName: spec.model,
              modelScale: spec.scale,
              itemId,
              wx, wy,
              readyTime: forms[fi].from,
              destroyedAt: (fi + 1 < forms.length) ? forms[fi + 1].from : destroyedAt,
              playerColor: player.playerColor || '#cccccc',
              unit
            });
          }
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
      _tlog('[ThreeMapRenderer] loading player buildings:', buildingEntries.length,
        'buildings,', totalModels, 'unique models');

      const ls = this._loading();
      if (ls && totalModels) {
        ls.setDetail('buildings', 'Player buildings');
        ls.stepAddTotal('buildings', totalModels);
      }

      const loadPromises = [];
      const pcb = this._buildingCacheBuster || '';
      for (const [modelName, entries] of Object.entries(byModel)) {
        const url = '/assets/models/buildings/' + modelName + '.glb' + pcb;
        loadPromises.push(new Promise(resolve => {
          loader.load(url, (result) => {
            if (!result) { resolve(); return; }

            // Extract render prims. A multi-primitive model loads as a Group
            // of meshes (each with its own geometry + WC3 ShaderMaterial); a
            // single-primitive model loads as a bare BufferGeometry we light
            // with a flat Lambert material.
            const prims = [];
            if (result.isGroup) {
              result.traverse(c => {
                if (c.isMesh && c.geometry && c.material) {
                  prims.push({ geometry: c.geometry, baseMat: c.material, shader: true });
                }
              });
            } else {
              prims.push({ geometry: result, baseMat: null, shader: false });
            }
            if (!prims.length) { resolve(); return; }

            // Bucket this model's buildings by player color. Every
            // (model, prim, color) becomes ONE InstancedMesh = one draw call,
            // instead of a per-building Group. three.js getParameters/Qt cost
            // scales with the number of meshes in the render list, so a busy
            // 3v3 (hundreds of building meshes) collapses to a handful.
            const byColor = {};
            for (const e of entries) {
              (byColor[e.playerColor] || (byColor[e.playerColor] = [])).push(e);
            }

            if (!this._buildingMatCache) this._buildingMatCache = new Map();
            if (!this._buildingInstanced) this._buildingInstanced = [];
            const matCache = this._buildingMatCache;
            const IDENT = this._identityMat || (this._identityMat = new THREE.Matrix4());
            const HIDDEN = this._hiddenMat || (this._hiddenMat = new THREE.Matrix4().makeScale(0, 0, 0));

            for (const color of Object.keys(byColor)) {
              const bucket = byColor[color];
              const teamColor = new THREE.Color(color);

              // One shared _playerBuildings record per building, referenced by
              // every prim's InstancedMesh via _slots.
              const records = [];
              for (let i = 0; i < bucket.length; i++) {
                const e = bucket[i];
                const groundY = this.sampleHeight(e.wx, e.wy) + 18;
                const rec = {
                  readyTime: e.readyTime,
                  destroyedAt: e.destroyedAt,
                  wx: e.wx, wy: e.wy,
                  itemId: e.itemId,
                  unit: e.unit,
                  _slots: [],
                  // The type's Art Scaling Value. Buildings carried no scale at
                  // all before, which was right only because 169 of the 197
                  // mapped types happen to have modelScale 1.
                  _scale: e.modelScale || 1,
                  _matrix: ThreeMapRenderer._buildingMatrix(
                    e.wx - mapCenterX, groundY, -(e.wy - mapCenterY), e.modelScale || 1),
                  _visible: false,
                  _treesCleared: false,
                  _lastRootedX: e.wx,
                  _lastRootedY: e.wy
                };
                records.push(rec);
                this._playerBuildings.push(rec);
              }

              for (const prim of prims) {
                let mat;
                if (prim.shader) {
                  const key = prim.baseMat.uuid + '|' + color;
                  mat = matCache.get(key);
                  if (!mat) {
                    mat = prim.baseMat.clone();
                    if (mat.uniforms && mat.uniforms.emissiveColor) {
                      mat.uniforms.emissiveColor.value = teamColor;
                      mat.uniforms.emissiveIntensity.value = 0.15;
                    }
                    // InstancedMesh world matrix is identity (instances carry
                    // the translation); the shader's normal transform is
                    // translation-invariant, so a fixed identity is correct.
                    if (mat.uniforms && mat.uniforms.worldMatrix) {
                      mat.uniforms.worldMatrix.value = IDENT;
                    }
                    matCache.set(key, mat);
                  }
                } else {
                  const key = modelName + '|' + color;
                  mat = matCache.get(key);
                  if (!mat) {
                    mat = new THREE.MeshLambertMaterial({
                      color: 0x998877, flatShading: true,
                      emissive: teamColor, emissiveIntensity: 0.3
                    });
                    matCache.set(key, mat);
                  }
                }

                const im = new THREE.InstancedMesh(prim.geometry, mat, records.length);
                // Instances span the whole map; a geometry-derived bounding
                // sphere would wrongly frustum-cull the entire batch.
                im.frustumCulled = false;
                for (let i = 0; i < records.length; i++) {
                  im.setMatrixAt(i, HIDDEN); // hidden until readyTime
                  records[i]._slots.push({ mesh: im, index: i });
                }
                im.instanceMatrix.needsUpdate = true;
                this.scene.add(im);
                this._freezeMatrix(im);
                this._buildingInstanced.push(im);
              }
            }

            this.requestRender();
            resolve();
          }, undefined, () => { resolve(); });
        }));
      }
      if (ls) loadPromises.forEach(p => p.then(() => ls.stepTick('buildings')));
      return Promise.all(loadPromises).then(() => {
        _tlog('[ThreeMapRenderer] player buildings ready:', this._playerBuildings.length);
      });
    }

    // WC3's default structure facing, 270 degrees (3π/2). Measured, not assumed:
    // in every war3mapUnits.doo the preplaced structures AND the `sloc` start-
    // location markers sit at exactly 4.7124 rad while the creeps carry
    // randomised angles. A player's buildings go up on those start locations, so
    // they face the same way.
    //
    // Player buildings have no facing in the replay — nothing records it, because
    // in game it never varies. Neutral buildings do not use this: their real
    // per-instance rotation now comes through the map export.
    static get DEFAULT_BUILDING_FACING () { return Math.PI * 1.5; }

    // Per-instance building matrix: translate to the world position, apply the
    // default structure facing, then the type's model scale. Kept in one place so
    // re-rooting an uprooted Ancient cannot silently drop either.
    // Model forward is +X and scene yaw is +worldFacing — the same calibration
    // UnitModelRenderer uses (both converters land geometry in Y-up the same way).
    static _buildingMatrix (x, y, z, scale) {
      const m = new THREE.Matrix4().makeTranslation(x, y, z);
      m.multiply(new THREE.Matrix4().makeRotationY(ThreeMapRenderer.DEFAULT_BUILDING_FACING));
      if (scale && scale !== 1) m.scale(new THREE.Vector3(scale, scale, scale));
      return m;
    }

    // Show/hide an instanced building by swapping its per-instance matrix
    // (zero-scale = hidden). Returns true if the state actually changed.
    _setBuildingVisible (b, visible) {
      if (b._visible === visible) return false;
      b._visible = visible;
      const HIDDEN = this._hiddenMat || (this._hiddenMat = new THREE.Matrix4().makeScale(0, 0, 0));
      const m = visible ? b._matrix : HIDDEN;
      for (const s of b._slots) {
        s.mesh.setMatrixAt(s.index, m);
        s.mesh.instanceMatrix.needsUpdate = true;
      }
      return true;
    }

    // Re-root an uprooted building at a new world position (rebakes its
    // shared instance matrix; reapplies it if currently visible).
    _setBuildingRoot (b, wx, wy) {
      const ext = this.mapInfo.bounds.map;
      const cx = (ext[0][0] + ext[0][1]) / 2;
      const cy = (ext[1][0] + ext[1][1]) / 2;
      const groundY = this.sampleHeight(wx, wy) + 18;
      b._matrix.copy(ThreeMapRenderer._buildingMatrix(
        wx - cx, groundY, -(wy - cy), b._scale || 1));
      if (b._visible) {
        for (const s of b._slots) {
          s.mesh.setMatrixAt(s.index, b._matrix);
          s.mesh.instanceMatrix.needsUpdate = true;
        }
      }
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
        // Hide while uprooted (2D unit canvas owns rendering then);
        // snap to latest root location when re-rooted.
        let isUprooted = false;
        if (b.unit && b.unit.uprootStream && b.unit.uprootStream.length) {
          let lastRoot = null;
          for (let i = 0; i < b.unit.uprootStream.length; i++) {
            const e = b.unit.uprootStream[i];
            if (e.gameTime > gameTime) break;
            isUprooted = !!e.isUprooted;
            if (!e.isUprooted) lastRoot = e;
          }
          if (lastRoot && (lastRoot.x !== b._lastRootedX || lastRoot.y !== b._lastRootedY)) {
            this._setBuildingRoot(b, lastRoot.x, lastRoot.y);
            b._lastRootedX = lastRoot.x;
            b._lastRootedY = lastRoot.y;
            changed = true;
          }
        }

        const aliveAndReady = gameTime >= b.readyTime && (!b.destroyedAt || gameTime < b.destroyedAt);
        const visible = aliveAndReady && !isUprooted;
        if (this._setBuildingVisible(b, visible)) {
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

    // Register the BuildingSplats subsystem so renderBaseSnapshot can toggle
    // ground splats to match the snapshot's buildings.
    setBuildingSplats (splats) {
      this._buildingSplats = splats;
    }

    // Render the 3D scene focused on a player's base area into a target canvas.
    // Used by BuildingPlacementViewer to capture a 3D snapshot of the base.
    // snapshotBuildings: [{itemId, x, y}] — buildings to show in this snapshot
    // gridOptions: { enabled, size } — optional World-Editor-style tile grid
    renderBaseSnapshot (baseGrid, snapshotBuildings, targetCanvas, gridOptions) {
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
          savedBuildingVis.push(b._visible);
        }
      }

      // Save tree hidden state
      const savedTreeState = [];
      if (this._treeInstances) {
        for (const t of this._treeInstances) savedTreeState.push(t.hidden);
      }

      // Save building ground splat visibility
      const savedSplatVis = this._buildingSplats ? this._buildingSplats.captureVisibility() : null;

      // Hide construction progress bars during snapshot — they would otherwise
      // float over buildings/gold mines if the snapshot's gameTime falls inside
      // a build window.
      const hiddenBars = [];
      for (const child of this.scene.children) {
        if (child.userData && child.userData.isBuildingProgressBar && child.visible) {
          hiddenBars.push(child);
          child.visible = false;
        }
      }

      // Show only the snapshot buildings, hide others
      if (this._playerBuildings) {
        for (const b of this._playerBuildings) this._setBuildingVisible(b, false);
        // Match snapshot buildings by position
        for (const sb of snapshotBuildings) {
          for (const b of this._playerBuildings) {
            if (Math.abs(b.wx - sb.x) < 10 && Math.abs(b.wy - sb.y) < 10) {
              this._setBuildingVisible(b, true);
              break;
            }
          }
        }
      }

      // Show only the splats under the snapshot's buildings (neutral splats stay)
      if (this._buildingSplats) this._buildingSplats.showOnlyForSnapshot(snapshotBuildings);

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

      // World-Editor-style tile grid (added to scene only for this one-shot
      // render, removed below so it never appears in the live map).
      let gridObj = null;
      if (gridOptions && gridOptions.enabled) {
        gridObj = this._buildSnapshotGrid(baseGrid, gridOptions.size, mapCenterX, mapCenterY,
          gridOptions.footprints);
        if (gridObj) this.scene.add(gridObj);
      }

      // Render to the main renderer at target canvas size. Pixel ratio must be
      // pinned to 1 here: the live viewer runs at gameScaler.renderScale, and a
      // fractional ratio would give a buffer of tw×r that the 1:1 drawImage
      // below would paste into the corner of the target canvas. resize()
      // re-derives the live ratio during teardown.
      this.renderer.setPixelRatio(1);
      const tw = targetCanvas.width;
      const th = targetCanvas.height;
      this.renderer.setSize(tw, th, false);
      this.camera.aspect = tw / th;
      this.camera.updateProjectionMatrix();
      this.renderer.render(this.scene, this.camera);

      // Copy rendered image to target canvas
      const targetCtx = targetCanvas.getContext('2d');
      targetCtx.drawImage(this.renderer.domElement, 0, 0);

      // Tear down the one-shot grid overlay (a Group of line/mesh children)
      if (gridObj) {
        this.scene.remove(gridObj);
        gridObj.traverse(c => {
          if (c.geometry) c.geometry.dispose();
          if (Array.isArray(c.material)) c.material.forEach(m => m && m.dispose());
          else if (c.material) c.material.dispose();
        });
      }

      // Restore renderer size. resize() re-derives BOTH the logical size and the
      // live pixel ratio from gameScaler — savedSize holds the physical buffer,
      // which would be re-multiplied by the ratio if fed back through setSize.
      this.resize();

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
          this._setBuildingVisible(this._playerBuildings[i], savedBuildingVis[i]);
        }
      }

      // Restore construction progress bar visibility
      for (const bar of hiddenBars) bar.visible = true;

      // Restore building ground splat visibility
      if (this._buildingSplats) this._buildingSplats.restoreVisibility(savedSplatVis);

      // Re-render main view
      this.requestRender();
      return true;
    }

    // Build the World-Editor-style overlay for a base snapshot: a tile grid
    // plus per-cell buildability markings and building footprint outlines.
    // The grid LINES are depth-tested so trees/buildings draw over them (WE
    // look); the buildability marks and footprint outlines use depthTest:false
    // and stay on top so the annotations remain readable.
    // Returns a THREE.Group owned by the caller (add, then dispose via the
    // group's children). footprints: [{x, y, w, h}] — center in WC3 world units,
    // w/h the solid footprint in build cells.
    _buildSnapshotGrid (baseGrid, gridSize, mapCenterX, mapCenterY, footprints) {
      if (!gridSize || gridSize <= 0) return null;

      const originX = baseGrid.originX;
      const originY = baseGrid.originY;
      const cs = baseGrid.cellSize;
      const cols = baseGrid.cols;
      const rows = baseGrid.rows;
      const bw = cols * cs;
      const bh = rows * cs;

      // The overlay conforms to the terrain surface: every vertex samples the
      // ground height so the grid, buildability marks and footprint outlines
      // hug the slope instead of floating on one flat plane (which, under the
      // tilted camera, drifts off the buildings and spills past the base edges).
      const LIFT = 14; // small lift so lines read above the ground, not z-fighting
      const hAt = (wx, wy) => this.sampleHeight(wx, wy) + LIFT;
      // World (x, y) -> scene [x, z]. Height is sampled separately via hAt.
      const sx = (wx) => wx - mapCenterX;
      const sz = (wy) => -(wy - mapCenterY);

      const group = new THREE.Group();
      // Terrain-conforming quad from a world-space rect (wxa<wxb, wyTop>wyBot).
      const pushQuadW = (arr, wxa, wyTop, wxb, wyBot) => {
        const xa = sx(wxa), xb = sx(wxb), zt = sz(wyTop), zb = sz(wyBot);
        const hTL = hAt(wxa, wyTop), hTR = hAt(wxb, wyTop);
        const hBR = hAt(wxb, wyBot), hBL = hAt(wxa, wyBot);
        arr.push(xa, hTL, zt, xb, hTR, zt, xb, hBR, zb,
          xa, hTL, zt, xb, hBR, zb, xa, hBL, zb);
      };
      // Terrain-conforming line between two world points (one LineSegments pair).
      const pushSegW = (arr, wxa, wya, wxb, wyb) => {
        arr.push(sx(wxa), hAt(wxa, wya), sz(wya), sx(wxb), hAt(wxb, wyb), sz(wyb));
      };
      // A straight world-space run, subdivided per cell so it follows the slope.
      const pushRunW = (arr, wxa, wya, wxb, wyb) => {
        const segs = Math.max(1, Math.round(Math.hypot(wxb - wxa, wyb - wya) / cs));
        let px = wxa, py = wya;
        for (let i = 1; i <= segs; i++) {
          const t = i / segs;
          const nx = wxa + (wxb - wxa) * t, ny = wya + (wyb - wya) * t;
          pushSegW(arr, px, py, nx, ny);
          px = nx; py = ny;
        }
      };

      // --- Per-cell buildability classification ---
      // baseGrid.cells: 0=blocked, 1=walkable(no-build), 2=buildable, 3/4=water.
      // Trees from the doodad layer are not in the static WPM, so stamp them in.
      // flag: 0 = clear, 1 = tinted (no-build), 2 = tinted + X (hard obstacle).
      const flags = new Array(rows);
      for (let r = 0; r < rows; r++) {
        flags[r] = new Array(cols).fill(0);
        const rowCells = baseGrid.cells[r] || [];
        for (let c = 0; c < cols; c++) {
          const v = rowCells[c];
          if (v === 0) flags[r][c] = 2;
          else if (v === 1) flags[r][c] = 1;
        }
      }
      if (baseGrid.trees) {
        for (const t of baseGrid.trees) {
          const c = Math.floor((t.x - originX) / cs);
          const r = Math.floor((originY - t.y) / cs);
          if (r >= 0 && r < rows && c >= 0 && c < cols) flags[r][c] = 2;
        }
      }

      // Red tint quads (unbuildable cells) + X marks (hard obstacles).
      const tintVerts = [];
      const xVerts = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (!flags[r][c]) continue;
          const wxa = originX + c * cs;
          const wyTop = originY - r * cs;
          pushQuadW(tintVerts, wxa, wyTop, wxa + cs, wyTop - cs);
          if (flags[r][c] === 2) {
            const m = cs * 0.18; // inset so the X reads inside the cell
            pushSegW(xVerts, wxa + m, wyTop - m, wxa + cs - m, wyTop - cs + m);
            pushSegW(xVerts, wxa + cs - m, wyTop - m, wxa + m, wyTop - cs + m);
          }
        }
      }
      if (tintVerts.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(tintVerts, 3));
        const m = new THREE.MeshBasicMaterial({
          color: 0xe03434, transparent: true, opacity: 0.30,
          depthTest: false, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true
        });
        const mesh = new THREE.Mesh(g, m);
        mesh.renderOrder = 10;
        group.add(mesh);
      }
      if (xVerts.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(xVerts, 3));
        const m = new THREE.LineBasicMaterial({
          color: 0xff6464, transparent: true, opacity: 0.6,
          depthTest: false, depthWrite: false
        });
        const lines = new THREE.LineSegments(g, m);
        lines.renderOrder = 11;
        group.add(lines);
      }

      // Grid lines, aligned to world-coordinate multiples of gridSize. The WPM
      // lattice origin is itself a multiple of every grid size, so these lines
      // fall exactly on the build-cell / tile boundaries the buildings snap to.
      const wyBot = originY - bh;
      const lineVerts = [];
      const firstX = Math.ceil(originX / gridSize) * gridSize;
      for (let wx = firstX; wx <= originX + bw; wx += gridSize) {
        pushRunW(lineVerts, wx, originY, wx, wyBot);
      }
      const firstY = Math.ceil(wyBot / gridSize) * gridSize;
      for (let wy = firstY; wy <= originY; wy += gridSize) {
        pushRunW(lineVerts, originX, wy, originX + bw, wy);
      }
      // Clean bounding border. gridSize rarely divides the base rect evenly, so
      // the interior lines stop short of the rect edges while their perpendicular
      // partners run the full span — leaving lines that visibly overhang past the
      // outermost cells. Framing the rect caps every line at a real edge.
      pushRunW(lineVerts, originX, originY, originX + bw, originY);
      pushRunW(lineVerts, originX, wyBot, originX + bw, wyBot);
      pushRunW(lineVerts, originX, originY, originX, wyBot);
      pushRunW(lineVerts, originX + bw, originY, originX + bw, wyBot);
      if (lineVerts.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(lineVerts, 3));
        const m = new THREE.LineBasicMaterial({
          color: 0x66ccaa, transparent: true, opacity: 0.45,
          // depthTest TRUE so trees/buildings draw OVER the grid lines (the
          // World-Editor look). The grid sits +LIFT above terrain so the ground
          // itself doesn't occlude it, but anything 3D standing on the ground
          // does. Buildability marks + footprint outlines keep depthTest:false
          // and stay on top.
          depthTest: true, depthWrite: false
        });
        const lines = new THREE.LineSegments(g, m);
        lines.renderOrder = 12;
        group.add(lines);
      }

      // Building footprint outlines (where each building occupies grid space).
      if (footprints && footprints.length) {
        const fillVerts = [];
        const outlineVerts = [];
        for (const f of footprints) {
          // WC3 places building centers on the 32-unit build-grid (verified in
          // replay data: every center is an exact multiple of cellSize from the
          // grid origin). f.w/f.h are the real solid footprint in cells (from
          // the pathing manifest); snap the center to the grid and extend a whole
          // number of half-cells each way so corners land exactly on grid lines.
          const cx = originX + Math.round((f.x - originX) / cs) * cs;
          const cy = originY - Math.round((originY - f.y) / cs) * cs;
          const halfW = Math.max(1, Math.round((f.w || 4) / 2)) * cs;
          const halfH = Math.max(1, Math.round((f.h || 4) / 2)) * cs;
          const wxa = cx - halfW, wxb = cx + halfW;
          const wyTop = cy + halfH, wyBot = cy - halfH;
          pushQuadW(fillVerts, wxa, wyTop, wxb, wyBot);
          pushRunW(outlineVerts, wxa, wyTop, wxb, wyTop);
          pushRunW(outlineVerts, wxb, wyTop, wxb, wyBot);
          pushRunW(outlineVerts, wxb, wyBot, wxa, wyBot);
          pushRunW(outlineVerts, wxa, wyBot, wxa, wyTop);
        }
        const gf = new THREE.BufferGeometry();
        gf.setAttribute('position', new THREE.Float32BufferAttribute(fillVerts, 3));
        const mf = new THREE.MeshBasicMaterial({
          color: 0xffd84a, transparent: true, opacity: 0.14,
          depthTest: false, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true
        });
        const fill = new THREE.Mesh(gf, mf);
        fill.renderOrder = 13;
        group.add(fill);

        const go = new THREE.BufferGeometry();
        go.setAttribute('position', new THREE.Float32BufferAttribute(outlineVerts, 3));
        const mo = new THREE.LineBasicMaterial({
          color: 0xffd84a, transparent: true, opacity: 0.95,
          depthTest: false, depthWrite: false
        });
        const outline = new THREE.LineSegments(go, mo);
        outline.renderOrder = 14;
        group.add(outline);
      }

      return group.children.length ? group : null;
    }

    // Freeze an object's transform: bake its local AND world matrices once and
    // stop three.js from recomputing them every frame.
    //
    // matrixAutoUpdate=false alone only skips the local compose — r160's
    // Object3D.updateMatrixWorld still RECURSES into every child each render,
    // and with thousands of static objects the traversal itself is the cost
    // (measured: updateMatrixWorld was the top three.js self-time entry).
    // matrixWorldAutoUpdate=false on the subtree ROOT is what prunes the walk:
    // scene.updateMatrixWorld skips a child whose flag is false when no force
    // cascade is active, and the scene root's matrix never changes.
    //
    // MUST be called after the object is at its final transform AND parented
    // (all current call sites parent to the scene, whose matrix is identity).
    // To move a frozen object: set matrixWorldAutoUpdate=true on the root,
    // matrixAutoUpdate=true on the node you move, or call
    // updateMatrixWorld(true) manually after the change.
    _freezeMatrix (obj) {
      obj.traverse(c => {
        c.updateMatrix();
        c.matrixAutoUpdate = false;
      });
      obj.updateMatrixWorld(true);
      obj.matrixWorldAutoUpdate = false;
    }

    // Request a single render frame (for use after async model loads when
    // the main render loop isn't running yet).
    //
    // Callers fire this whenever a building/splat/unit model appears or
    // disappears — which during playback is constantly. The viewer's main loop
    // already calls render() every frame, so honouring those requests too would
    // schedule a SECOND full renderer.render(scene, camera) on the next frame.
    // Wc3vViewer.mainLoop clears _pendingRender each frame (the same way it
    // defuses its own requestRender), so this is a no-op while the loop drives
    // us and still works when it doesn't.
    requestRender () {
      if (this._disposed || this._pendingRender) return;
      this._pendingRender = true;
      this._rafId = requestAnimationFrame(() => {
        this._rafId = null;
        if (!this._pendingRender) return;   // main loop already rendered this frame
        this._pendingRender = false;
        if (this._disposed || !this.ready) return;
        this.render();
      });
    }

    // Release the WebGL context and every GPU resource this renderer owns.
    // MUST be called before dropping the reference (Wc3vViewer.reset()), or
    // each replay reload orphans a live context + tens of MB of textures.
    // A scene.traverse() catch-all covers terrain, water, trees, cliffs,
    // buildings, ribbons, rings and pins without enumerating each field;
    // the loose texture Maps are freed explicitly since not all are attached.
    dispose () {
      if (this._disposed) return;
      this._disposed = true;
      this.ready = false;

      if (this._rafId != null) { cancelAnimationFrame(this._rafId); this._rafId = null; }
      this._pendingRender = false;

      // Guide glow: pooled meshes share ONE geometry + texture but have per-glow
      // materials. Remove them from the scene and dispose everything exactly once
      // here, so the per-mesh scene.traverse below can't double-dispose the shared
      // geometry/texture.
      if (this._hlGlows) {
        for (const g of this._hlGlows) {
          if (this.scene) this.scene.remove(g);
          if (g.material) g.material.dispose();
        }
      }
      if (this._hlGlowGeo) this._hlGlowGeo.dispose();
      if (this._hlGlowTex && typeof this._hlGlowTex.dispose === 'function') this._hlGlowTex.dispose();
      this._hlGlows = this._hlActive = this._hlGlowGeo = this._hlGlowTex = this._glowSeen = null;
      this._glowEpoch = undefined;

      if (this.fogOfWar && typeof this.fogOfWar.dispose === 'function') {
        this.fogOfWar.dispose();
      }

      const disposeMaterial = (m) => {
        if (!m) return;
        for (const k in m) {            // free any texture maps the material holds
          const v = m[k];
          if (v && v.isTexture) v.dispose();
        }
        if (typeof m.dispose === 'function') m.dispose();
      };
      if (this.scene) {
        this.scene.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (Array.isArray(obj.material)) obj.material.forEach(disposeMaterial);
          else if (obj.material) disposeMaterial(obj.material);
        });
      }

      // Textures held in caches outside the live scene graph.
      const disposeTexMap = (mapOrNull) => {
        if (!mapOrNull) return;
        mapOrNull.forEach((t) => { if (t && typeof t.dispose === 'function') t.dispose(); });
      };
      disposeTexMap(this.paletteTextures);
      disposeTexMap(this._doodadTextures);
      disposeTexMap(this._buildingTextures);
      if (this.mapTexture && typeof this.mapTexture.dispose === 'function') this.mapTexture.dispose();

      this.scene = null;
      this.terrainMesh = this.waterMesh = this.trunkMesh = this.leafMesh = null;
      this.paletteTextures = this._doodadTextures = this._buildingTextures = null;
      this._pathRibbons = this._campRings = this._routeLines = this._levelPins = null;
      this._treeInstances = this._buildingInstanced = null;
      this._buildingSplats = null;

      if (this.renderer) {
        this.renderer.dispose();
        if (typeof this.renderer.forceContextLoss === 'function') this.renderer.forceContextLoss();
        // Detach from #three-canvas so a fresh renderer can bind a clean context.
        this.renderer.domElement = null;
        this.renderer = null;
      }
    }
  }

  window.ThreeMapRenderer = ThreeMapRenderer;
})();
