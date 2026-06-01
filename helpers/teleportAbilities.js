/*
 * teleportAbilities — central registry of every WC3 ability/item that
 * teleports a unit (or group of units) from one location to another in a
 * fashion the simulator should treat as a path JUMP rather than smooth
 * movement.
 *
 * Without this registry the parser silently misses teleports — the hero's
 * `path` array shows continuous walking through the cast point instead of a
 * clean jump, which then drags the tracker box across the map (e.g. an
 * Archmage Mass Teleport pulled the camera halfway across Hammerfall in
 * happy-vs-grubby because the BM's path never registered an isJump).
 *
 * Each entry encodes the four properties the simulator needs to model the
 * cast faithfully:
 *
 *   channelMs   — channel time in ms before the teleport applies. 0 = instant.
 *   invulnerable — the caster is invulnerable during the channel. Used by
 *                  client visuals; ALSO used by cancel-detection: when the
 *                  ability is invulnerable+uncancellable we never skip the
 *                  apply, even if the hero's path data looks weird.
 *   cancellable  — stuns/silences/death can interrupt the channel. If true,
 *                  the simulator checks whether the caster moved meaningfully
 *                  during the channel and skips the jump if so.
 *   grabRadius   — game-unit radius around the caster from which friendly
 *                  non-hero non-summoned units are pulled along to the
 *                  destination. 0 means hero only.
 *
 * Authoritative numerical sources:
 *   - AHmt area = 800u (helpers/heroAbilityStats.json DataA, level 1)
 *   - AHmt channel ≈ 3s (DataB)
 *   - AEbl range = 1000/1075/1150u by level (DataA)
 *   - AEbl duration 0.33s (treated as instant for jump purposes)
 *   - stwp grab/channel: standard WC3 melee documentation (3s, ~900u,
 *     invulnerable, uncancellable)
 *   - stel: hero-only, ~1.5s channel, NOT invulnerable, cancellable
 *   - spre/ssan: hero-only, instant single-unit teleport to nearest town
 *     hall (NE Ancient of Wonders / HU Arcane Vault staffs). NOT invulnerable.
 *
 * The `category` field groups visuals/labels in the client:
 *   - 'town-portal'  → stwp (group teleport to allied building, gold visual)
 *   - 'single-unit'  → stel/spre/ssan (hero-only, cyan visual + distinct label)
 *   - 'mass'         → AHmt (ultimate area-grab teleport)
 *   - 'blink'        → AEbl (instant short-range jump)
 *
 * Not in this registry on purpose:
 *   - Wind Walk (AOww) — movement-speed buff, not a teleport
 *   - Storm Earth Fire (ANef) — splits the brewmaster in place, not a teleport
 *   - Hero Revive — handled separately (HeroRevive action); appearance at altar
 *   - Tavern hero hire — first-spawn placement, not a teleport
 *   - Goblin Zeppelin / Boat — real transport movement, not a teleport
 */

const teleportAbilities = Object.freeze({
  // ── Items ────────────────────────────────────────────────────────────────
  'stwp': {
    kind: 'item',
    code: 'stwp',
    category: 'town-portal',
    displayName: 'Scroll of Town Portal',
    icon: 'stwp',
    channelMs: 3000,
    invulnerable: true,
    cancellable: false,
    grabRadius: 900,
    grabsHero: true,                 // caster teleports
    grabsAlliedUnits: true,          // ALL friendly units in radius — including
                                     // other heroes. Confirmed via happy-vs-grubby
                                     // where Lich was 265u from the casting DK
                                     // and should have come along.
    grabsSummons: false,
    targetType: 'allied-building',
    sourceAction: 'TeleportScroll'
  },

  'stel': {
    kind: 'item',
    code: 'stel',
    category: 'single-unit',
    displayName: 'Staff of Teleportation',
    icon: 'stel',
    channelMs: 0,                    // instant — hero (or target) jumps directly
    invulnerable: false,
    cancellable: false,
    grabRadius: 0,
    grabsHero: true,                 // teleports caster OR the target friendly unit
    grabsAlliedUnits: false,         // single-unit only; never pulls bystanders
    grabsSummons: false,
    targetType: 'unit-or-ground',
    sourceAction: null               // dispatched by spell order id; resolved via fallback
  },

  // Staff of Preservation (NE Ancient of Wonders) — single-unit teleport
  // to nearest town hall + slight heal. Behaves like a hero-only stwp:
  // instant resolve, no grab radius, no channel.
  'spre': {
    kind: 'item',
    code: 'spre',
    category: 'single-unit',
    displayName: 'Staff of Preservation',
    icon: 'spre',
    channelMs: 0,
    invulnerable: false,
    cancellable: false,
    grabRadius: 0,
    grabsHero: true,
    grabsAlliedUnits: false,
    grabsSummons: false,
    targetType: 'allied-unit',
    sourceAction: null
  },

  // Staff of Sanctuary (HU Arcane Vault) — sister item to spre: single-unit
  // teleport to nearest town hall + invuln bubble on target.
  'ssan': {
    kind: 'item',
    code: 'ssan',
    category: 'single-unit',
    displayName: 'Staff of Sanctuary',
    icon: 'ssan',
    channelMs: 0,
    invulnerable: false,
    cancellable: false,
    grabRadius: 0,
    grabsHero: true,
    grabsAlliedUnits: false,
    grabsSummons: false,
    targetType: 'allied-unit',
    sourceAction: null
  },

  // ── Hero spells ──────────────────────────────────────────────────────────
  'AHmt': {
    kind: 'ultimate',
    code: 'AHmt',
    category: 'mass',
    displayName: 'Mass Teleport',
    icon: 'AHmt',
    channelMs: 3000,
    invulnerable: false,
    cancellable: true,
    grabRadius: 800,                 // confirmed: heroAbilityStats area[0]
    grabsHero: true,
    grabsAlliedUnits: true,
    grabsSummons: false,
    targetType: 'allied-building'
  },

  'AEbl': {
    kind: 'spell',
    code: 'AEbl',
    category: 'blink',
    displayName: 'Blink',
    icon: 'AEbl',
    channelMs: 0,                    // 0.33s anim lock, treated as instant
    invulnerable: true,              // instant — no window to interrupt
    cancellable: false,
    grabRadius: 0,
    grabsHero: true,
    grabsAlliedUnits: false,
    grabsSummons: false,
    targetType: 'ground',
    maxRange: 1150                   // worst-case (level 3); documentation only
  }
});

// Quick predicates for common dispatch decisions.
const isTeleportItemId = (itemId) => !!(itemId && teleportAbilities[itemId]);
const isTeleportAbilityId = (abilityId) => !!(abilityId && teleportAbilities[abilityId]);

// Town hall itemIds shared by every TP-class ability that auto-targets the
// caster's nearest base (stwp without target, spre / ssan single-unit staffs).
// Kept here so Player.js / Hero.js can share one home-TH lookup.
const TOWN_HALL_IDS = Object.freeze({
  'htow': true, 'hkee': true, 'hcas': true,
  'ogre': true, 'ostr': true, 'ofrt': true,
  'etol': true, 'etoa': true, 'etoe': true,
  'unpl': true, 'unp1': true, 'unp2': true
});

// Returns the player's closest live town hall to `fromUnit` (the casting
// hero / unit). Falls back to a synthesized startingPosition stub so a
// destroyed-base replay still gets a teleport destination — without that
// fallback _applyTeleport would bail and the TP would silently disappear.
const findHomeTownHall = (player, fromUnit) => {
  if (!player || !player.units) return null;
  let best = null;
  let bestD2 = Infinity;
  const fx = (fromUnit && fromUnit.currentX != null) ? fromUnit.currentX : 0;
  const fy = (fromUnit && fromUnit.currentY != null) ? fromUnit.currentY : 0;
  for (const u of player.units) {
    if (!u.isBuilding) continue;
    if (u.destroyed) continue;
    if (!TOWN_HALL_IDS[u.itemId]) continue;
    if (u.currentX == null || u.currentY == null) continue;
    const dx = u.currentX - fx;
    const dy = u.currentY - fy;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = u;
    }
  }
  if (best) return best;
  if (player.startingPosition) {
    return {
      currentX: player.startingPosition.x,
      currentY: player.startingPosition.y,
      uuid: null,
      itemId: null,
      displayName: null
    };
  }
  return null;
};

module.exports = {
  teleportAbilities,
  isTeleportItemId,
  isTeleportAbilityId,
  TOWN_HALL_IDS,
  findHomeTownHall
};
