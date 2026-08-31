/**
 * clientConfig.js — global client-side config object.
 *
 * Loaded first on every HTML page (before Helpers.js / any subsystem) so the
 * rest of the client can read `window.WC3V_CONFIG` synchronously. The server
 * has its own `config/config.js`; this is the browser counterpart.
 *
 * Keep client `console.log` calls gated behind `WC3V_CONFIG.logging.*`.
 */
(function () {
  var hostname = (typeof window !== 'undefined' && window.location && window.location.hostname) || '';
  var isDev = (hostname === '127.0.0.1' || hostname === 'localhost');

  var config = {
    isDev: isDev,

    // Stable cache-buster for immutable assets (building GLBs, textures, SVGs).
    // Bump this string whenever those assets are regenerated/redeployed so the
    // browser + CDN refetch — using Date.now() instead defeats caching on every
    // single load (every map re-downloads all building models). In dev we keep
    // the always-fresh behaviour so local asset edits show up without a bump.
    assetVersion: '1',

    // Render-performance switches. Each one gates a single optimization so it
    // can be flipped at runtime (`WC3V_CONFIG.perf.instancedRings = false`) to
    // A/B a regression without a rebuild. Defaults are the FAST path — turning
    // one off restores the older, slower behaviour.
    perf: {
      // Max fixed-timestep catch-up iterations per animation frame. Without a
      // cap, a tab-switch or GC stall accumulates unbounded simulated time and
      // drains it in one frame (spiral of death). Dropping the excess is the
      // correct trade for a viewer: playback jumps, but the tab recovers.
      maxCatchupIterations: 5,
      // Draw unit selection rings + ground shadows as two InstancedMeshes for
      // the whole scene instead of two Meshes per unit (saves ~2 scene-graph
      // objects + 2 draw calls + 2 materials per unit). Per-unit color/fade
      // ride instanced attributes; consumers see the same descriptor fields
      // the meshes had. NOTE: read once at renderer construction — flipping it
      // needs a replay reload, not just a new frame.
      instancedRings: true,
      // WC3-style selection hoops under each player's currently-selected units,
      // in that player's colour. A THIRD InstancedMesh alongside the ring and
      // shadow pools, so the cost is one draw call and no scene-graph churn.
      // Unlike instancedRings above this is read EVERY FRAME — it only gates
      // whether the pool is filled, not how instances are represented, so it
      // can be flipped live without a replay reload. NOTE it still depends on
      // instancedRings: the selection pool is built in the same _ensurePools()
      // the other two are, so instancedRings:false turns selection rings off
      // as well. That is the legacy A/B path only.
      selectionRings: true,
      // Let Three cull off-screen skinned units, and skip their AnimationMixer
      // ticks. Safe because animation state is a pure function of gameTime, so
      // a unit re-entering the frustum poses correctly with no catch-up.
      frustumCull: true,
      // Swap VISIBLE-but-distant units to a baked idle-pose plain mesh, taking
      // their bone subtree out of the scene graph (this is the "static baked
      // pose" follow-up to the mixer-budget note below — the win comes from
      // drawing fewer skinned meshes, not from animating fewer of them).
      // Death and morph transitions always stay animated.
      staticPoseLOD: true,
      // The screen-height cutoff for staticPoseLOD: a nominal unit projecting
      // under this many CSS pixels freezes. Raise for more perf, lower for
      // more animation at distance. 24 keeps the P1/P2 follow camera (~30px
      // units) animated while the zoomed-out overview — where the scene-graph
      // cost actually lives — goes fully static.
      staticPoseMinPx: 24,
      // Adaptive LOD governor: when the frame-time EMA runs over budget, the
      // static-pose threshold scales up (more units freeze; measured: LOD off
      // 14fps vs on 21fps in a mid-game fight window — animated skeletons ARE
      // the frame cost), and relaxes back to staticPoseMinPx when the frame is
      // comfortable. Trades distant animation for framerate ONLY under load,
      // so fast machines never see it. Bounds + rates in Wc3vViewer.mainLoop.
      adaptiveLOD: true,
      // Bottom-centre match graphs HUD (dominance history + food). Its static
      // series are pre-rendered into two offscreen bitmaps, so a frame is a
      // clearRect, two drawImage and a handful of fillText — but this gates the
      // whole feature for A/B measurement.
      hudCharts: true,
      // Device-pixel-ratio ceiling for the HUD canvas ONLY. Deliberately not
      // canvasRenderDprCap (1.0): that cap exists because the five map canvases
      // are viewport-sized and rasterized every frame five times over, where
      // retina supersampling is pure fill-rate loss. The HUD is <=600x96 CSS px
      // and rasterizes once into a bitmap, and text legibility is the entire
      // point of the feature. Capped at 2 so a 3x phone panel doesn't pay 2.25x
      // for a difference nobody can see.
      hudChartsDpr: 2,
      // Draw ranged attack projectiles (arrows, bolts, artillery shells) and
      // their impact/muzzle flashes. Two InstancedMeshes, so the cost is two
      // draw calls and no scene-graph churn — but this gates the whole feature
      // for A/B measurement, since perf was the main risk when it was designed.
      projectiles: true,
      // Size the five map canvases (4× 2D + the WebGL buffer) to the box they
      // are DISPLAYED in rather than to the map image. They used to be sized to
      // playableTiles × 16px (1568²-2240²) and CSS-downscaled to fit, so a 900px
      // viewport rasterized ~6× the pixels it showed, every frame, five times
      // over. 'auto' matches the display box in device pixels; a number pins the
      // scale; false restores the old map-image sizing. On-screen sizes do not
      // change either way — only the rasterization resolution does, because the
      // logical coordinate space is untouched and each 2D context carries a
      // matching base transform (GameScaler.computeRenderScale).
      canvasRenderScale: 'auto',
      // Device-pixel-ratio ceiling for canvasRenderScale:'auto'. 1 means a HiDPI
      // panel rasterizes at CSS resolution — this is a switch aimed at weak GPUs,
      // and paying 4× fill for retina supersampling defeats it. Raise to 2 for a
      // sharper picture on a fast machine with a retina display.
      canvasRenderDprCap: 1.0,
      // Beyond the static-pose LOD distance, freeze WALKING and ATTACKING
      // units too, not just idle ones. A frozen walker slides in its baked
      // pose — the accepted trade of the Performance preset, because in a
      // mid-game fight walk/attack is most of the army and the idle-only gate
      // stops paying exactly when the frame is most expensive. Heroes and
      // death/morph windows keep their animated exemptions regardless.
      staticPoseFreezeMoving: false,
      // Quantize UnitBehavior.resolve() to this many game-ms (0 = every
      // frame). The full behavior build scans every live unit and rebuilds a
      // spatial hash; states/facings it produces change on hundreds-of-ms
      // scales and facing consumers smooth at the turn-rate cap. Positions
      // are never read from the behavior frame, so motion stays per-frame.
      behaviorResolveMs: 0,
      // Active quality preset name — set via WC3V_CONFIG.setQuality below.
      quality: 'balanced',
      // Corner readout: rolling frame time, draw calls, projectile counts.
      // Off by default. Exists because there was previously no in-viewer way to
      // measure a render change, only to assert one.
      showStats: false
    },

    // User-facing quality presets (Settings → Quality). Only levers that are
    // read per-frame (or on the resize path) belong here, so a preset switch
    // takes effect live; construction-time switches (instancedRings) do not.
    // 'balanced' mirrors the perf defaults above — keep them in sync.
    qualityPresets: {
      // High: more animation at distance, retina-sharp canvases. The adaptive
      // governor stays on as a safety net on weak machines.
      quality:     { staticPoseMinPx: 12, staticPoseFreezeMoving: false, behaviorResolveMs: 0,   canvasRenderDprCap: 2, hudChartsDpr: 2 },
      balanced:    { staticPoseMinPx: 24, staticPoseFreezeMoving: false, behaviorResolveMs: 0,   canvasRenderDprCap: 1, hudChartsDpr: 2 },
      // Performance: distant units freeze even while moving, behavior state
      // resolves at ~7Hz of game time, HUD renders at 1x. Playback content is
      // untouched — this trades decoration fidelity only.
      performance: { staticPoseMinPx: 48, staticPoseFreezeMoving: true,  behaviorResolveMs: 150, canvasRenderDprCap: 1, hudChartsDpr: 1 }
    },
    // NOTE on an optimization that was TRIED AND REMOVED: capping how many units
    // tick an AnimationMixer per frame ("animated unit budget"). Measured, it
    // made things WORSE -- 39.5fps unbudgeted vs 38.8 at 28 units vs 35.7 at 12.
    // The reason is structural: three calls skeleton.update() at RENDER time for
    // every VISIBLE skinned mesh, whether or not its mixer advanced, so skipping
    // mixer.update saves almost nothing while the budget bookkeeping costs real
    // time. Cutting skinned-unit cost further means drawing fewer skinned
    // meshes (static baked pose / imposter), not animating fewer of them.

    // Per-area logging flags. Default off in production, on in dev.
    logging: {
      app:        isDev,
      three:      isDev,
      buildOrder: isDev,
      map:        isDev,
      net:        isDev,
      // Split-screen camera decisions (per-side anchor / bbox / zoom).
      // OFF even in dev: this fires several times a second and each line is a
      // formatted template string, which is a measurable frame cost with
      // DevTools open — exactly when you'd be looking at it. Opt in for a
      // session with `WC3V_CONFIG.logging.splitCamera = true`.
      splitCamera: false,
      // Parser + upload pipeline. Also propagated into the parser Web
      // Worker via a `?log=1` URL param, since the worker runs in its own
      // global scope and can't read this object.
      parser:     isDev
    }
  };

  // Apply a quality preset by name and persist the choice. Returns false for
  // an unknown name. hudChartsDpr applies to the next HUD build (a preset
  // switch mid-match keeps the current HUD bitmaps); everything else is read
  // per-frame or on the resize path.
  config.setQuality = function (name) {
    var p = config.qualityPresets[name];
    if (!p) return false;
    for (var k in p) config.perf[k] = p[k];
    config.perf.quality = name;
    try { localStorage.setItem('wc3v-quality', name); } catch (e) { /* private mode */ }
    return true;
  };

  // Restore the saved preset before any subsystem reads config.perf — this
  // file loads first on every page.
  (function () {
    var saved = null;
    try { saved = localStorage.getItem('wc3v-quality'); } catch (e) { /* private mode */ }
    if (saved && config.qualityPresets[saved]) config.setQuality(saved);
  })();

  // Light helper so callers can write `WC3V_CONFIG.log('three', ...)` without
  // sprinkling `if (...)` everywhere. No-op when the area flag is off.
  config.log = function (area /* , ...args */) {
    if (!config.logging || !config.logging[area]) return;
    var args = Array.prototype.slice.call(arguments, 1);
    // eslint-disable-next-line no-console
    console.log.apply(console, args);
  };

  if (typeof window !== 'undefined') {
    window.WC3V_CONFIG = config;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = config;
  }
})();
