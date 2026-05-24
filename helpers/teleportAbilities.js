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
    displayName: 'Staff of Teleportation',
    icon: 'stel',
    channelMs: 1500,
    invulnerable: false,
    cancellable: true,
    grabRadius: 0,
    grabsHero: true,
    grabsAlliedUnits: false,
    grabsSummons: false,
    targetType: 'unit-or-ground',
    sourceAction: null               // dispatched by spell order id; resolved via fallback
  },

  // ── Hero spells ──────────────────────────────────────────────────────────
  'AHmt': {
    kind: 'ultimate',
    code: 'AHmt',
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

module.exports = {
  teleportAbilities,
  isTeleportItemId,
  isTeleportAbilityId
};
