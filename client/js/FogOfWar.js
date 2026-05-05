/**
 * FogOfWar — 3D fog mesh that darkens the non-playable map edges in the
 * Three.js scene. An oversized plane (3x map dimensions) sits just above
 * the terrain so it fills the screen from any camera angle. A custom shader
 * uses world-space XZ coordinates to determine fog intensity: transparent
 * inside the camera bounds, fading to opaque black outside.
 */
const FogOfWar = class {
  /**
   * @param {THREE.Scene} scene
   * @param {object} mapInfo — bounds.map + bounds.camera
   * @param {number} worldWidth — full map width in world units
   * @param {number} worldHeight — full map height in world units
   * @param {number} fogY — Y elevation for the fog plane (just above terrain)
   */
  constructor (scene, mapInfo, worldWidth, worldHeight, fogY) {
    this.mesh = null;
    this._build(scene, mapInfo, worldWidth, worldHeight, fogY);
  }

  _build (scene, mapInfo, worldWidth, worldHeight, fogY) {
    const camera = mapInfo.bounds.camera;
    const map = mapInfo.bounds.map;

    // Camera bounds in WC3 world coords
    const camLeft   = camera[0][0];
    const camRight  = camera[0][1];
    const camTop    = camera[1][0];   // max Y (north)
    const camBottom = camera[1][1];   // min Y (south)

    const mapLeft   = map[0][0];
    const mapRight  = map[0][1];
    const mapTop    = map[1][0];
    const mapBottom = map[1][1];

    const hasGap = (
      camLeft > mapLeft + 10 ||
      camRight < mapRight - 10 ||
      camTop < mapTop - 10 ||
      camBottom > mapBottom + 10
    );
    if (!hasGap) return;

    // Feather width in world units (~2 tiles for smooth fade)
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

    // Camera bounds in Three.js world space (X = WC3 X - center, Z = -(WC3 Y - center))
    const boundsXMin = camLeft - mapCenterX;
    const boundsXMax = camRight - mapCenterX;
    const boundsZMin = -(camTop - mapCenterY);    // north (high WC3 Y) = negative Z
    const boundsZMax = -(camBottom - mapCenterY);  // south (low WC3 Y) = positive Z

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
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

    console.log('[FogOfWar] Three.js bounds:', { boundsXMin, boundsXMax, boundsZMin, boundsZMax });
    console.log('[FogOfWar] camera WC3:', { camLeft, camRight, camTop, camBottom });
    console.log('[FogOfWar] map WC3:', { mapLeft, mapRight, mapTop, mapBottom });
    console.log('[FogOfWar] plane size:', planeW, 'x', planeH, '| fogY:', fogY);

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
