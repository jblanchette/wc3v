/**
 * FogOfWar — 3D fog mesh that darkens the non-playable map edges in the
 * Three.js scene. An oversized plane (3x map dimensions) sits just above
 * the terrain so it fills the screen from any camera angle. A custom shader
 * uses world-space XZ coordinates to determine fog intensity: transparent
 * over the playable area, fading to opaque black across the unplayable
 * margin.
 */
const FogOfWar = class {
  /**
   * @param {THREE.Scene} scene
   * @param {object} mapInfo — bounds.map + bounds.camera
   * @param {number} worldWidth — full map width in world units
   * @param {number} worldHeight — full map height in world units
   * @param {number} fogY — Y elevation for the fog plane (just above terrain)
   * @param {GameScaler} [gameScaler] — provides viewExtent (true playable
   *   bounds derived from gridSize.margins). Falls back to bounds.camera if
   *   not provided, but bounds.camera is the in-game camera pan box and is
   *   inset further than the playable edge — using it clips the fog into
   *   playable terrain (especially the south edge on most maps).
   */
  constructor (scene, mapInfo, worldWidth, worldHeight, fogY, gameScaler) {
    this.mesh = null;
    this._build(scene, mapInfo, worldWidth, worldHeight, fogY, gameScaler);
  }

  _build (scene, mapInfo, worldWidth, worldHeight, fogY, gameScaler) {
    const map = mapInfo.bounds.map;

    const mapLeft   = map[0][0];
    const mapRight  = map[0][1];
    const mapTop    = map[1][0];
    const mapBottom = map[1][1];

    // Prefer the playable bounds GameScaler computes from gridSize.margins —
    // those match what the 2D viewport considers playable. bounds.camera is
    // the WC3 in-game camera pan box, which is a smaller inset region and
    // would leave a strip of playable terrain (notably the south edge)
    // outside the fog's "clear" zone, putting fog over the map.
    let playLeft, playRight, playTop, playBottom;
    if (gameScaler && gameScaler.viewExtent) {
      const ve = gameScaler.viewExtent;
      playLeft   = ve.x[0];
      playRight  = ve.x[1];
      playTop    = ve.y[0];   // max WC3 Y (north)
      playBottom = ve.y[1];   // min WC3 Y (south)
    } else {
      const camera = mapInfo.bounds.camera;
      playLeft   = camera[0][0];
      playRight  = camera[0][1];
      playTop    = camera[1][0];
      playBottom = camera[1][1];
    }

    const hasGap = (
      playLeft > mapLeft + 10 ||
      playRight < mapRight - 10 ||
      playTop < mapTop - 10 ||
      playBottom > mapBottom + 10
    );
    if (!hasGap) return;

    // Feather width in world units (~2 tiles for smooth fade). The feather
    // sits ENTIRELY OUTSIDE the camera-playable area: fog is fully transparent
    // up to the playable edge, then fades to opaque over FEATHER units of the
    // unplayable border. This way the fog never bleeds onto playable terrain
    // at any zoom level — at high zoom an inward feather would smear a huge
    // dark gradient across the visible playable map.
    const FEATHER = 256;

    // Make the plane 3x map size so the tilted perspective camera can never
    // see past the fog edges — everything beyond the map is solid black.
    const SCALE = 3;
    const planeW = worldWidth * SCALE;
    const planeH = worldHeight * SCALE;
    const geo = new THREE.PlaneGeometry(planeW, planeH, 1, 1);
    geo.rotateX(-Math.PI / 2);

    // Map center (terrain mesh origin)
    const mapCenterX = (mapLeft + mapRight) / 2;
    const mapCenterY = (mapTop + mapBottom) / 2;

    // Playable bounds in Three.js world space, expanded outward by FEATHER
    // plus a small EDGE_BUFFER. The buffer keeps the gradient from biting
    // into playable terrain even when the source bounds are slightly tight
    // (e.g. a map's effective playable area extends ~half a tile past
    // gridSize.margins, or floating-point/edge-tile rounding leaves a sliver
    // of playable terrain just outside the reported playable rect).
    const EDGE_BUFFER = 128;
    const boundsXMin = (playLeft   - mapCenterX) - FEATHER - EDGE_BUFFER;
    const boundsXMax = (playRight  - mapCenterX) + FEATHER + EDGE_BUFFER;
    const boundsZMin = -(playTop    - mapCenterY) - FEATHER - EDGE_BUFFER;  // north (high WC3 Y) = negative Z
    const boundsZMax = -(playBottom - mapCenterY) + FEATHER + EDGE_BUFFER;  // south (low WC3 Y) = positive Z

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      // Flat overlay plane: skip three's two-pass transparent double-sided path.
      forceSinglePass: true,
      uniforms: {
        uBoundsMin: { value: new THREE.Vector2(boundsXMin, boundsZMin) },
        uBoundsMax: { value: new THREE.Vector2(boundsXMax, boundsZMax) },
        uFeather:   { value: FEATHER }
      },
      vertexShader: [
        'varying vec3 vWorldPos;',
        'void main() {',
        '  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform vec2 uBoundsMin;',   // (xMin, zMin) in Three.js world space
        'uniform vec2 uBoundsMax;',   // (xMax, zMax)
        'uniform float uFeather;',
        'varying vec3 vWorldPos;',
        '',
        'void main() {',
        '  float dLeft   = (vWorldPos.x - uBoundsMin.x) / uFeather;',
        '  float dRight  = (uBoundsMax.x - vWorldPos.x) / uFeather;',
        '  float dFront  = (vWorldPos.z - uBoundsMin.y) / uFeather;',
        '  float dBack   = (uBoundsMax.y - vWorldPos.z) / uFeather;',
        '',
        '  float fogX = 1.0 - clamp(min(dLeft, dRight), 0.0, 1.0);',
        '  float fogZ = 1.0 - clamp(min(dFront, dBack), 0.0, 1.0);',
        '  float fog = max(fogX, fogZ);',
        '',
        '  fog = smoothstep(0.0, 1.0, fog);',
        '  fog = fog * fog;',
        '',
        '  if (fog < 0.005) discard;',
        '  gl_FragColor = vec4(0.0, 0.0, 0.0, fog * 0.95);',
        '}'
      ].join('\n')
    });

    const _cfg = (typeof window !== 'undefined' && window.WC3V_CONFIG) || null;
    if (_cfg) {
      _cfg.log('three', '[FogOfWar] Three.js bounds:', { boundsXMin, boundsXMax, boundsZMin, boundsZMax });
      _cfg.log('three', '[FogOfWar] playable WC3:', { playLeft, playRight, playTop, playBottom });
      _cfg.log('three', '[FogOfWar] map WC3:', { mapLeft, mapRight, mapTop, mapBottom });
      _cfg.log('three', '[FogOfWar] plane size:', planeW, 'x', planeH, '| fogY:', fogY);
    }

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, fogY, 0);
    mesh.renderOrder = 999;
    scene.add(mesh);
    this.mesh = mesh;
  }

  dispose (scene) {
    if (this.mesh) {
      scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.mesh = null;
    }
  }
};

window.FogOfWar = FogOfWar;
