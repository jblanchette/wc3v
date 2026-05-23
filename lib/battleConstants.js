/*
 * battleConstants — tunables for BattleDetector.
 *
 * Centralized so tuning sweeps (tools/battle-sweep.js, when it lands) can
 * load and vary them without grepping the detector. Units: ms for time,
 * WC3 game units for distance.
 *
 * Defaults chosen from the plan; expect a corpus-driven tuning pass after
 * first run on happy-vs-grubby / happy-vs-moon / a 4v4. Documented rationale
 * inline so future changes don't lose context.
 */
module.exports = Object.freeze({
  // Two signals can be in the same cluster only if their gameTimes are within
  // this gap AND within SIGNAL_MERGE_DIST in space. 6s captures the "stutter"
  // of a real fight (chase, kite, re-engage) without merging unrelated
  // skirmishes 10s apart.
  SIGNAL_MERGE_TIME_MS: 6000,
  SIGNAL_MERGE_DIST:    1400,  // ~sqrt(2)*1000 — covers screen-sized engagement

  // A battle that's shorter than this OR has fewer than this many signals is
  // dropped during finalize. Filters out lone-stutter (e.g. one harass shot
  // before retreat). Tower-pokes from afar will still count if they cross
  // both thresholds.
  MIN_BATTLE_DURATION_MS: 2500,
  MIN_SIGNAL_COUNT:       3,

  // Once a battle closes, NEW battles cannot open in the same spatial
  // neighborhood within this window. Prevents two consecutive engagements
  // from being treated as the same battle when the action briefly pauses.
  POST_BATTLE_COOLDOWN_MS: 8000,

  // Tracker-box cadence — the time-varying bbox samples we ship to the client.
  // 400ms matches Unit POSITION_SAMPLE_MS so the box updates at the same
  // resolution as unit positions. Client interpolates linearly between samples.
  TRACK_SAMPLE_MS: 400,
  TRACK_PADDING:   200,  // game units padding around participant positions per sample

  // Proximity-pass parameters (Phase 2 Pass A). Worker/illusion units are
  // filtered out; only combat units register a proximity signal.
  PROXIMITY_RADIUS:         600,
  PROXIMITY_MIN_OVERLAP_MS: 1200,
  PROXIMITY_SAMPLE_MS:      800,
  // After we emit a proximity signal for a unit-pair, suppress the next one
  // for this many ms — otherwise one sustained engagement floods the signal
  // stream and inflates cluster timestamps.
  PROXIMITY_DEBOUNCE_MS:    2400,

  // Categorization radii. "base" means a player's startingPosition; an
  // "expansion" is a non-start town hall (resolved at categorization time).
  BASE_DEFENSE_RADIUS:      1800,
  EXPANSION_DEFENSE_RADIUS: 1500,
  // Tower-dive flag: a hostile signal landing this close to a defensive
  // building of the defender's race.
  TOWER_DIVE_BUILDING_DIST: 700,

  // Categorization thresholds (combined with team/participant counts).
  PITCHED_MIN_DURATION_MS:  12000,
  PITCHED_MIN_PARTICIPANTS: 6,
  ENGAGEMENT_MIN_DURATION_MS: 6000,
  HARASS_MAX_DURATION_MS:    6000,
  HARASS_MAX_ACTORS:         3,

  // Cap on signals we ship per battle in the output .wc3v. The detector
  // keeps all internally; the export prunes oldest-attached tails first.
  MAX_EXPORT_SIGNALS_PER_BATTLE: 400,

  // possiblyDead inference window (Phase 4).
  PD_TAIL_GRACE_MS:   2000,  // last path sample must be before endTime+grace
  PD_QUIET_AFTER_MS:  5000,  // no new samples until endTime+quiet

  // ── Trip detection (Macro engine) ────────────────────────────────────────
  // A "trip" is a participant unit leaving the battle for a recognizable WC3
  // destination — fountain heal, shop run, moonwell, base return, etc.
  // Trips drive both the visual tags AND tracker-box exclusion (the box stops
  // following the lone medic walking to a fountain).
  //
  // Three passes:
  //   Pass 1 — for each (battle, participant), walk path forward from the
  //            unit's last in-battle signal up to TRIP_LOOKAHEAD_MS and look
  //            for arrival at a known destination.
  //   Pass 2 — cross-battle context: link re-engagements to the next battle,
  //            mark trips that ended in death, dedupe yo-yo healing.
  //   Pass 3 — confidence filter: drop low-confidence ambiguous trips.
  TRIP_LOOKAHEAD_MS:          90_000,  // walk this far past lastEngagedTime for trips
  TRIP_MID_BATTLE_GRACE_MS:    3_000,  // unit must have been engaged ≥3s before counting as tripping
  TRIP_DEPARTURE_DISTANCE:     1_500,  // unit must move this far from lastEngagedPosition to be "departing"
  TRIP_DESTINATION_DISTANCE:     650,  // close enough to a fountain/shop/moonwell to count as arrived
  TRIP_BASE_DISTANCE:          1_500,  // larger radius for base / expansion (TH is a big footprint)
  TRIP_REENGAGE_MAX_MS:        30_000, // re-entering another battle within this window → trip-reengage
  TRIP_MAX_PER_UNIT_PER_BATTLE:     2, // cap yo-yo healing — record at most 2 trips per (battle, uuid)
  TRIP_YOYO_COLLAPSE_MS:       8_000,  // trips to same destination within this window collapse into one

  // Unit-itemId predicates for trip destinations. Kept here (not in mappings)
  // so the BattleDetector module is self-contained for testing/sweeps.
  TRIP_FOUNTAIN_HEAL_IDS: new Set(['nfoh']),  // Fountain of Health
  TRIP_FOUNTAIN_MANA_IDS: new Set(['nmoo']),  // Fountain of Mana
  TRIP_SHOP_IDS:          new Set(['nmer', 'ntav', 'ngme']),  // Mercenary / Tavern / Goblin Merchant
  TRIP_MOONWELL_IDS:      new Set(['emow']),  // Night Elf Moon Well

  // Defensive tower itemIds — used by tower-dive flag. Per-race; keep
  // synchronized with helpers/mappings.js building lists. Read-only.
  DEFENSIVE_BUILDING_IDS: new Set([
    // Human
    'hgtw',  // guard tower
    'hctw',  // cannon tower
    'hatw',  // arcane tower
    // Orc
    'owtw',  // watch tower
    // Undead
    'usep',  // spirit tower
    'unpl',  // nerubian tower (?)
    'uzg2',  // upgraded ziggurat (spirit/nerubian)
    'uzg1',
    // Night Elf
    'eaom',  // ancient of war (uprooted can attack)
    'eaoe',  // ancient of lore? actually shrine variants
    'etrp',  // ancient protector
    'etol',  // tree of life (auto-attack)
    'etoa',  // tree of ages
    'etoe'   // tree of eternity
  ]),

  // Expansion town hall itemIds — used by expansion-fight category. Same
  // list as Player.EXPANSION_BUILDING_IDS (kept in sync).
  EXPANSION_BUILDING_IDS: new Set([
    'htow', 'hkee', 'hcas',  // Human Town Hall / Keep / Castle
    'ogre', 'ostr', 'ofrt',  // Orc Great Hall / Stronghold / Fortress
    'etol', 'etoa', 'etoe',  // NE Tree of Life / Ages / Eternity
    'unpl', 'unp1', 'unp2'   // UD Necropolis / Halls / Black Citadel
  ])
});
