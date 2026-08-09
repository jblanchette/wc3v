/**
 * EventModel — single normalized event pipeline for the whole viewer.
 *
 * Replaces the per-frame stream scanning that used to live in FloatingText.
 * Replay events are immutable after parse, so we build ONE flat, time-sorted
 * list of normalized events when the replay loads, then every consumer reads
 * from it:
 *
 *   - EventFeed       → right-edge canvas feed + caster pips (onCanvas subset)
 *   - InsightsEventLog → full scrollable, filterable log in the bottom panel
 *
 * A normalized event is renderer-agnostic: it carries the actor, the player
 * color, a category + tags (for filtering), an icon id, terse title/detail,
 * and — for spells — the resolved target and targeting class the parser now
 * exports. Renderers decide how to draw; the model decides what each event
 * *means*.
 *
 * Categories (coarse, for filter chips):
 *   combat       — spells, ability toggles
 *   progression  — hero levels, tiers, research, hero acquisition, revive
 *   economy      — item buy/use/sell/drop/pickup
 *   logistics    — transport load/unload, expansion
 *   scouting     — worker scouting
 *
 * `onCanvas` marks the high-signal subset that also draws on the map. Low-
 * signal events (item churn, autocast toggles, scouting) live in the log only.
 */

const EventModel = (function () {

  // Per-event-key descriptors. Ported + extended from the old
  // FloatingText.EVENT_STYLES. Each descriptor resolves a normalized event;
  // functions receive the raw event object.
  //
  //   category   — coarse bucket (above)
  //   onCanvas   — draw a pip + feed row on the map canvas
  //   priority   — feed stacking / pip prominence (higher = more important)
  //   color      — accent (icon ring, row bar) — category-tuned
  //   icon(e)    — fourcc icon id, or null
  //   title(e)   — primary terse text (the "what")
  //   actor(e)   — the unit/hero that acted (the "who"), or null
  //   detail(e)  — secondary qualifier, or null
  //   tags(e)    — extra filter tags beyond category
  //   accept(e)  — optional gate; return false to drop the event entirely
  //
  // Obsidian Statue Replenish Life/Mana (Urlf/Urlm/Urep): the ability re-fires
  // continuously while toggled on, flooding the feeds with identical casts.
  // The meaningful signal is the on/off toggle, which arrives separately as
  // 'autocastToggle' — so the raw casts are dropped from every feed.
  const HIDDEN_AUTOCAST_CASTS = new Set(['Urlf', 'Urlm', 'Urep']);
  const TYPE_META = {
    'spellCast': {
      category: 'combat',
      onCanvas: true,
      priority: 50,
      color: '#88CCFF',
      accept: (e) => !HIDDEN_AUTOCAST_CASTS.has(e.spellItemId),
      icon: (e) => e.icon || e.spellItemId || null,
      title: (e) => e.spellName || (e.unit ? e.unit.displayName : 'Spell'),
      actor: (e) => e.unit ? e.unit.displayName : null,
      detail: () => null,
      tags: (e) => {
        const t = ['spell'];
        if (e.unit && e.unit.isHero) t.push('hero');
        if (e.isAoe) t.push('aoe');
        if (e.target && e.target.enemy) t.push('enemy-target');
        if (e.target && e.target.isHero) t.push('hero-target');
        if (e.isAutocast) t.push('autocast');
        return t;
      }
    },
    'HeroLevel': {
      category: 'progression',
      onCanvas: true,
      priority: 100,
      color: '#FFD700',
      // Primary icon is the HERO portrait — the event is "this hero levelled".
      // The skill that got the point is shown as a secondary icon (see
      // _normalize → secondary), so "Hex 1" can never be mistaken for a cast.
      icon: (e) => (e.unit ? e.unit.itemId : null) || e.spellItemId,
      title: (e) => e.unit ? e.unit.displayName : 'Hero',
      actor: () => null,
      detail: (e) => {
        const sk = e.spell ? e.spell.displayName : null;
        const rank = e.spell ? e.spell.level : null;
        if (sk) return rank ? `put a point in ${sk} (rank ${rank})` : `learned ${sk}`;
        return 'levelled up';
      },
      tags: () => ['hero', 'levelup']
    },
    'heroRevive': {
      category: 'progression',
      onCanvas: true,
      priority: 90,
      color: '#00FF88',
      icon: (e) => e.unit ? e.unit.itemId : null,
      title: (e) => e.unit ? e.unit.displayName : 'Hero',
      actor: () => null,
      detail: () => 'Revived',
      tags: () => ['hero', 'revive']
    },
    'expansion': {
      category: 'logistics',
      onCanvas: true,
      priority: 75,
      color: '#FFD166',
      icon: (e) => e.building ? e.building.itemId : (e.unit ? e.unit.itemId : null),
      title: () => 'Expansion',
      actor: () => null,
      detail: () => 'New base',
      tags: () => ['expansion', 'base']
    },
    'addUnit': {
      category: 'progression',
      onCanvas: true,
      priority: 80,
      color: '#FFD700',
      // Heroes only on canvas; non-hero unit production stays in the BO panel.
      // Illusions (Mirror Image copies) are NOT trained/spawned heroes — never
      // surface them as a "New Hero" event.
      accept: (e) => !!(e.unit && e.unit.isHero && !e.unit.isIllusion),
      icon: (e) => e.unit ? e.unit.itemId : null,
      title: (e) => e.unit ? e.unit.displayName : 'Hero',
      actor: () => null,
      detail: () => 'New hero',
      tags: () => ['hero', 'train']
    },
    'makeTavernHero': {
      category: 'progression',
      onCanvas: true,
      priority: 100,
      color: '#FFD700',
      icon: (e) => e.unit ? e.unit.itemId : null,
      title: (e) => e.unit ? e.unit.displayName : 'Tavern Hero',
      actor: () => null,
      detail: () => 'Tavern hero',
      tags: () => ['hero', 'tavern']
    },
    'hireMercenary': {
      category: 'progression',
      onCanvas: true,
      priority: 70,
      color: '#FF8844',
      icon: (e) => e.unit ? e.unit.itemId : null,
      title: (e) => e.unit ? e.unit.displayName : 'Mercenary',
      actor: () => null,
      detail: (e) => e.building ? `Hired · ${e.building}` : 'Hired',
      tags: () => ['mercenary', 'hire']
    },
    'tierUpgrade': {
      category: 'progression',
      onCanvas: true,
      priority: 85,
      color: '#FFFFFF',
      icon: (e) => e.building ? e.building.itemId : null,
      title: (e) => e.tier ? `Tier ${e.tier}` : 'Tier up',
      actor: () => null,
      detail: () => 'Tech upgrade',
      tags: () => ['tier', 'tech']
    },
    'research': {
      category: 'progression',
      onCanvas: false,
      priority: 40,
      color: '#BB88FF',
      icon: (e) => e.icon || null,
      title: (e) => e.displayName || 'Research',
      actor: () => null,
      detail: (e) => {
        if (e.category === 'attack') return e.level ? `Attack ${e.level}` : 'Attack upgrade';
        if (e.category === 'defense') return e.level ? `Defense ${e.level}` : 'Defense upgrade';
        return 'Research';
      },
      tags: (e) => ['research', e.category].filter(Boolean)
    },
    'autocastToggle': {
      category: 'combat',
      onCanvas: false,
      priority: 20,
      color: '#FFAA44',
      icon: (e) => e.icon || e.spellItemId || null,
      title: (e) => e.spellName || 'Autocast',
      actor: (e) => e.unit ? e.unit.displayName : null,
      detail: (e) => e.state === 'on' ? 'Autocast on' : 'Autocast off',
      tags: () => ['autocast', 'toggle']
    },
    'formToggle': {
      category: 'combat',
      onCanvas: false,
      priority: 25,
      color: '#44DDAA',
      icon: (e) => e.icon || e.spellItemId || null,
      title: (e) => e.spellName || 'Form change',
      actor: (e) => e.unit ? e.unit.displayName : null,
      detail: (e) => e.state === 'off' ? 'Form off' : 'Form on',
      tags: () => ['form', 'toggle']
    },
    'itemPurchase': {
      category: 'economy',
      onCanvas: false,
      priority: 15,
      color: '#44DD88',
      accept: (e) => !(e.item && e.item.itemId === 'Jwid'),
      icon: (e) => e.item ? e.item.itemId : null,
      title: (e) => e.item ? e.item.displayName : 'Item',
      actor: (e) => e.unit ? e.unit.displayName : null,
      detail: (e) => e.shop ? `Bought · ${e.shop}` : 'Bought',
      tags: () => ['item', 'buy']
    },
    'itemUse': {
      category: 'economy',
      onCanvas: false,
      priority: 12,
      color: '#AADDFF',
      // tomes + slotless fallbacks are diagnostic noise — keep them out.
      accept: (e) => e.category !== 'tome' && e.source !== 'use-no-slot',
      icon: (e) => e.item ? (e.item.knownItemId || e.item.itemId) : null,
      title: (e) => e.item ? e.item.displayName : 'Item',
      actor: (e) => e.unit ? e.unit.displayName : null,
      detail: (e) => {
        if (e.category === 'consumable') return 'Consumed';
        if (e.category === 'active') return 'Activated';
        return 'Used';
      },
      tags: () => ['item', 'use']
    },
    'sellItem': {
      category: 'economy',
      onCanvas: false,
      priority: 12,
      color: '#F08A54',
      icon: (e) => e.item ? (e.item.knownItemId || e.item.itemId) : null,
      title: (e) => e.item ? e.item.displayName : 'Item',
      actor: (e) => e.unit ? e.unit.displayName : null,
      detail: (e) => e.goldRefunded ? `Sold · +${e.goldRefunded}g` : 'Sold',
      tags: () => ['item', 'sell']
    },
    'dropItem': {
      category: 'economy',
      onCanvas: false,
      priority: 10,
      color: '#DDAA44',
      accept: (e) => !(e.type === 'potentialUnregisteredItem') &&
                     !(e.item && e.item.itemId === 'Jwid'),
      icon: (e) => e.item ? (e.item.knownItemId || e.item.itemId) : null,
      title: (e) => e.item ? e.item.displayName : 'Item',
      actor: (e) => e.unit ? e.unit.displayName : null,
      detail: (e) => (e.type === 'knownItem' && e.targetHero) ? 'Traded' : 'Dropped',
      tags: () => ['item', 'drop']
    },
    'pickupItem': {
      category: 'economy',
      onCanvas: false,
      priority: 10,
      color: '#F0C464',
      accept: (e) => !(e.isRandomDrop && (!e.item || !e.item.itemId)),
      icon: (e) => e.item ? e.item.itemId : null,
      title: (e) => e.item ? e.item.displayName : 'Item',
      actor: (e) => e.unit ? e.unit.displayName : null,
      detail: (e) => e.campUuid ? 'Camp loot' : 'Picked up',
      tags: () => ['item', 'pickup']
    },
    'transportLoad': {
      category: 'logistics',
      onCanvas: false,
      priority: 10,
      color: '#88AADD',
      icon: (e) => e.passenger ? e.passenger.itemId : null,
      title: (e) => e.passenger ? e.passenger.displayName : 'Unit',
      actor: () => null,
      detail: (e) => `Loaded · ${e.transport ? e.transport.displayName : 'Transport'}`,
      tags: () => ['transport', 'load']
    },
    'transportUnload': {
      category: 'logistics',
      onCanvas: false,
      priority: 10,
      color: '#88DDAA',
      icon: (e) => e.passenger ? e.passenger.itemId : null,
      title: (e) => e.passenger ? e.passenger.displayName : 'Unit',
      actor: () => null,
      detail: (e) => `Unloaded · ${e.transport ? e.transport.displayName : 'Transport'}`,
      tags: () => ['transport', 'unload']
    },
    'scout': {
      category: 'scouting',
      onCanvas: false,
      priority: 30,
      color: '#44DDBB',
      icon: (e) => e.unit ? e.unit.itemId : null,
      title: (e) => {
        if (e.isLumberScout) return 'Wisp lumber scout';
        const name = e.unit ? e.unit.displayName : 'Worker';
        return `${name} scouting`;
      },
      actor: () => null,
      detail: (e) => e.isLumberScout ? 'Persistent vision' : 'Scouting',
      tags: () => ['scout']
    }
  };

  // Short "what kind of moment is this" kicker shown at the start of every row
  // so a spell CAST can never be confused with a LEVEL UP. Mostly static; a few
  // are computed from the event.
  const KIND_MAP = {
    spellCast:      (e) => e.isUnitSpell ? 'Ability' : 'Cast',
    HeroLevel:      () => 'Level Up',
    heroRevive:     () => 'Revived',
    expansion:      () => 'Expand',
    addUnit:        () => 'New Hero',
    makeTavernHero: () => 'Tavern Hero',
    hireMercenary:  () => 'Hire',
    tierUpgrade:    () => 'Tech',
    research:       (e) => e.category === 'attack' ? 'Attack Up'
                         : e.category === 'defense' ? 'Defense Up' : 'Research',
    autocastToggle: () => 'Autocast',
    formToggle:     () => 'Form',
    itemPurchase:   () => 'Buy',
    itemUse:        () => 'Use',
    sellItem:       () => 'Sell',
    dropItem:       () => 'Drop',
    pickupItem:     () => 'Loot',
    transportLoad:  () => 'Load',
    transportUnload:() => 'Unload',
    scout:          () => 'Scout'
  };

  // Category → accent color for filter chips + row tint (shared with CSS).
  const CATEGORY_COLOR = {
    combat:      '#88CCFF',
    progression: '#FFD166',
    economy:     '#7FD99A',
    logistics:   '#9BB4D6',
    scouting:    '#44DDBB'
  };

  class Model {
    constructor () {
      this.events = [];
    }

    // Build the normalized, time-sorted list from ClientPlayer instances.
    build (players) {
      const events = [];
      // uuid -> ClientUnit, so _resolvePosition can sample where a caster
      // actually WAS at cast time. Events carry Unit.exportUnitReference()
      // (lib/Unit.js), a flat snapshot whose `lastPosition` is the unit's
      // position at EXPORT time — end of replay — with no path and no
      // interpolation. Only the live ClientUnit can answer "where at t".
      this._unitsByUuid = new Map();
      this._unitsByOwner = new Map();     // playerId -> ClientUnit[]
      (players || []).forEach(player => {
        const pid = player && player.playerId;
        const list = [];
        for (const u of ((player && player.units) || [])) {
          if (u && u.uuid) this._unitsByUuid.set(u.uuid, u);
          if (u) list.push(u);
        }
        if (pid != null) this._unitsByOwner.set(pid, list);
      });

      (players || []).forEach((player, pIdx) => {
        if (!player || player.isNeutralPlayer) return;
        const color = player.playerColor || '#cccccc';
        const pname = player.displayName ||
          ('Player ' + (player.playerId != null ? player.playerId : pIdx));

        (player.eventStream || []).forEach((ev, i) => {
          const norm = this._normalize(ev, pIdx, color, pname, i);
          if (norm) events.push(norm);
        });

        (player.tierStream || []).forEach((t, i) => {
          if (!t || t.tier == null || t.tier <= 1) return;
          events.push(this._normalizeTier(t, pIdx, color, pname, i));
        });
      });

      events.sort((a, b) => (a.gameTime - b.gameTime) || (a.priority - b.priority));
      this.events = events;
      return events;
    }

    _normalize (ev, playerIndex, playerColor, playerName, streamIndex) {
      const meta = TYPE_META[ev.key];
      if (!meta) return null;
      if (meta.accept && !meta.accept(ev)) return null;

      const title = meta.title ? meta.title(ev) : null;
      if (!title) return null;

      // Kind kicker (disambiguates Cast vs Level Up vs Buy ...).
      const kindFn = KIND_MAP[ev.key];
      const kind = kindFn ? kindFn(ev) : null;

      // A small badge chip (e.g. hero level reached) + an optional SECONDARY
      // icon shown at the row's right edge: the spell's TARGET portrait, or the
      // skill that a level-up point went into. Both render at full icon size so
      // the relationship reads at a glance.
      let badge = null;
      let secondary = null;
      if (ev.key === 'HeroLevel') {
        const lvl = ev.newLevel || (ev.spell && ev.spell.level);
        if (lvl) badge = 'Lv ' + lvl;
        if (ev.spellItemId) {
          secondary = {
            icon: ev.spellItemId,
            kind: 'skill',
            hero: false,
            label: (ev.spell && ev.spell.displayName) || 'Skill'
          };
        }
      } else if (ev.key === 'spellCast' && ev.target && ev.target.itemId) {
        secondary = {
          icon: ev.target.itemId,
          kind: ev.target.enemy ? 'target-enemy' : 'target-ally',
          hero: !!ev.target.isHero,
          label: ev.target.displayName
        };
      }

      return {
        id: `${playerIndex}:${streamIndex}:${ev.key}`,
        gameTime: ev.gameTime || 0,
        playerIndex,
        playerColor,
        playerName,
        category: meta.category,
        type: ev.key,
        kind,
        icon: meta.icon ? meta.icon(ev) : null,
        title,
        badge,
        secondary,
        actor: meta.actor ? meta.actor(ev) : null,
        detail: meta.detail ? meta.detail(ev) : null,
        target: ev.target || null,
        targeting: ev.targeting || null,
        isAoe: !!ev.isAoe,
        tags: (meta.tags ? meta.tags(ev) : []).concat([meta.category]),
        onCanvas: !!meta.onCanvas,
        priority: meta.priority || 0,
        color: meta.color || CATEGORY_COLOR[meta.category] || '#cccccc',
        pos: this._resolvePosition(ev),
        // Who acted. Kept so consumers can re-resolve the caster against the
        // live unit rather than trusting the snapshot baked into the event.
        actorUuid: (ev.unit && ev.unit.uuid) || null,
        // target click point — drives the caster→target connector / AoE ring
        targetPos: this._resolveTargetPos(ev),
        // Which unit the parser's target reference names, resolved by
        // (itemId, owner) since the reference carries no uuid. Set as a side
        // effect of _resolveTargetPos immediately above.
        targetUuid: this._lastTargetUuid || null
      };
    }

    _normalizeTier (t, playerIndex, playerColor, playerName, streamIndex) {
      const meta = TYPE_META['tierUpgrade'];
      return {
        id: `${playerIndex}:tier${streamIndex}`,
        gameTime: t.gameTime || 0,
        playerIndex,
        playerColor,
        playerName,
        category: 'progression',
        type: 'tierUpgrade',
        kind: 'Tech',
        icon: null,
        title: `Tier ${t.tier}`,
        badge: null,
        secondary: null,
        actor: null,
        detail: 'Tech upgrade',
        target: null,
        targeting: null,
        isAoe: false,
        tags: ['tier', 'tech', 'progression'],
        onCanvas: true,
        priority: meta.priority,
        color: meta.color,
        pos: t.position || null,
        targetPos: null
      };
    }

    // Mirror of the old FloatingText._resolvePosition — caster first so pips
    // float on the unit that acted, not its target.
    //
    // The position must be sampled AT THE EVENT. `lastPosition` is the parser's
    // final currentX/currentY for the unit (lib/Unit.js) — where it finished the
    // game, or died. Anchoring to it put every spell pip, connector and AoE ring
    // at the caster's resting place instead of the cast site, which reads as
    // "way off, and randomly so" because it depends on where each unit happened
    // to end up. Buildings are exempt in practice (they don't move) but go
    // through the same path so there is one rule.
    _resolvePosition (event) {
      if (event.spot) return event.spot;
      const at = event.gameTime;
      const UB = (typeof window !== 'undefined') ? window.UnitBehavior : null;
      const posOf = (ref) => {
        if (!ref) return null;
        // The event carries a flat reference, not the ClientUnit — resolve by
        // uuid to reach the path, then fall back to the baked snapshot for
        // anything the index doesn't know (buildings discovered by selection,
        // streams built before build() ran).
        const live = (ref.uuid && this._unitsByUuid) ? this._unitsByUuid.get(ref.uuid) : null;
        // UnitBehavior.sampleAt, NOT ClientUnit.getInterpolatedPosition. The
        // latter interpolates around `recordIndexes.path`, a cursor the playback
        // loop advances to the CURRENT time — it ignores the timestamp you hand
        // it and answers for wherever the replay is parked. Events are built
        // once at setup, so it would stamp every event with the unit's position
        // at t=0. sampleAt is a pure binary search over the immutable path.
        if (live && live.path && at != null && UB && typeof UB.sampleAt === 'function') {
          const p = UB.sampleAt(live.path, at);
          if (p) return { x: p.x, y: p.y };
        }
        return ref.lastPosition || (live && live.lastPosition) || null;
      };
      return posOf(event.unit) || posOf(event.transport) ||
             event.targetPosition || posOf(event.building) || null;
    }

    /**
     * Where the caster→target connector should END.
     *
     * For GROUND-targeted abilities `targetPosition` is the click point and is
     * correct. For UNIT-targeted ones it is not the target at all: measured on
     * a Mountain King Storm Bolt, the recorded point sat 246 world units from
     * the nearest unit and every unit within 400 of it belonged to the CASTER,
     * while the actual victim was across the map. Drawing to it produced a line
     * pointing at bare ground.
     *
     * The parser resolves the target object but exports no uuid for it (see
     * Player.js, which builds { displayName, itemId, isHero, ownerPlayerId,
     * enemy }), so identify it the only way the data allows: the unit of that
     * itemId, owned by that player, nearest the caster at cast time.
     *
     * The identification is recorded on `targetUuid`. The POSITION still comes
     * from the click point, and that is deliberate — measured across 38
     * unit-targeted casts, sampling the identified unit's path put 4 of them
     * further from the caster than the recorded click point, one at 2806 world
     * units for a Storm Bolt whose range is 800. Replay paths are built from
     * ORDERS, not tracking, so an enemy unit's path is often stale, while the
     * click point is a direct record of where the target was at that instant.
     *
     * The visible consequence: the connector can point at ground that looks
     * empty, because the unit it names is DRAWN at its stale path position.
     * That is a rendering-truth problem, not a targeting one, and picking which
     * end to believe is a product call — `targetUuid` is exposed so the renderer
     * can switch to the drawn position if that is preferred.
     */
    _resolveTargetPos (ev) {
      if (!ev) return null;
      if (ev.targeting !== 'unit' || !ev.target) return ev.targetPosition || null;

      const at = ev.gameTime;
      const owner = ev.target.ownerPlayerId;
      const itemId = ev.target.itemId;
      const pool = (this._unitsByOwner && owner != null) ? this._unitsByOwner.get(owner) : null;
      const UB = (typeof window !== 'undefined') ? window.UnitBehavior : null;
      if (!pool || !itemId || at == null || !UB || typeof UB.sampleAt !== 'function') {
        return ev.targetPosition || null;
      }

      const from = this._resolvePosition(ev);
      let best = null, bestD = Infinity;
      for (const u of pool) {
        if (!u || u.itemId !== itemId || !u.path) continue;
        // Skip units that hadn't spawned or were already gone at cast time.
        const ready = u.readyTime != null ? u.readyTime : u.spawnTime;
        if (ready != null && at < ready) continue;
        if (u.destroyedAt != null && at > u.destroyedAt) continue;
        const p = UB.sampleAt(u.path, at);
        if (!p) continue;
        const d = from ? Math.hypot(p.x - from.x, p.y - from.y) : 0;
        if (d < bestD) { bestD = d; best = { u, p }; }
      }
      this._lastTargetUuid = best ? best.u.uuid : null;
      return ev.targetPosition || null;
    }

    // Events whose gameTime <= now (already happened), most-recent first.
    // Used by the insights log; cheap linear scan is fine (events are static).
    upTo (gameTime) {
      const out = [];
      for (const e of this.events) {
        if (e.gameTime > gameTime) break;
        out.push(e);
      }
      return out;
    }
  }

  // Pretty labels for category filter chips.
  const CATEGORY_LABEL = {
    combat: 'Combat',
    progression: 'Tech',
    economy: 'Items',
    logistics: 'Moves',
    scouting: 'Scout'
  };

  // ---------------------------------------------------------------------------
  // Shared DOM row builder — the single source of the event "look" used by BOTH
  // the right-edge feed and the insights log, so they are visually identical.
  // opts: { showTime, seekable, onSeek(gameTime) }
  // ---------------------------------------------------------------------------
  // Build a square icon node (rounded), with graceful empty fallback.
  function buildIconEl (className, iconId, borderColor) {
    const wrap = document.createElement('span');
    wrap.className = className;
    if (borderColor) wrap.style.borderColor = borderColor;
    if (iconId) {
      const img = document.createElement('img');
      img.src = '/assets/wc3icons/' + iconId + '.jpg';
      img.alt = '';
      img.onerror = function () { this.remove(); wrap.classList.add('ev-icon-empty'); };
      wrap.appendChild(img);
    } else {
      wrap.classList.add('ev-icon-empty');
    }
    return wrap;
  }

  Model.buildRowEl = function (ev, opts) {
    opts = opts || {};
    const row = document.createElement('div');
    row.className = 'ev-row ev-cat-' + ev.category;
    if (ev.secondary) row.classList.add('ev-has-secondary');
    row.dataset.eventId = ev.id;
    row.dataset.category = ev.category;
    if (ev.tags) row.dataset.tags = ev.tags.join(' ');

    // Ownership and category are shown WITHOUT a single-edge stripe:
    //  - player color → a full ring around the actor icon (same language the
    //    map + canvas feed use for "who owns this");
    //  - category color → exposed as --ev-cat-color for the KIND kicker tint
    //    and empty-icon fallback.
    const playerColor = ev.playerColor || '#888';
    row.style.setProperty('--ev-pcolor', playerColor);
    row.style.setProperty('--ev-cat-color', ev.color || CATEGORY_COLOR[ev.category] || '#888');

    // Primary icon (the actor/subject) — full player-color ring carries owner.
    row.appendChild(buildIconEl('ev-icon', ev.icon, playerColor));

    const main = document.createElement('div');
    main.className = 'ev-main';

    // Line 1: KIND kicker + title + optional level badge + AoE/self tag.
    const line1 = document.createElement('div');
    line1.className = 'ev-line1';
    if (ev.kind) {
      const kick = document.createElement('span');
      kick.className = 'ev-kind';
      kick.textContent = ev.kind;
      line1.appendChild(kick);
    }
    const title = document.createElement('span');
    title.className = 'ev-title';
    title.textContent = ev.title;
    line1.appendChild(title);

    if (ev.badge) {
      const b = document.createElement('span');
      b.className = 'ev-badge';
      b.textContent = ev.badge;
      line1.appendChild(b);
    }
    // AoE / self qualifier only when there's no concrete target portrait.
    if (!ev.secondary && ev.isAoe) {
      const tag = document.createElement('span');
      tag.className = 'ev-tag';
      tag.textContent = 'AoE';
      line1.appendChild(tag);
    } else if (!ev.secondary && ev.targeting === 'self' && ev.type === 'spellCast') {
      const tag = document.createElement('span');
      tag.className = 'ev-tag ev-tag-muted';
      tag.textContent = 'self';
      line1.appendChild(tag);
    }
    main.appendChild(line1);

    // Line 2: actor + detail (+ time in the log). Wraps — never truncates.
    const line2 = document.createElement('div');
    line2.className = 'ev-line2';
    const parts = [];
    if (ev.actor) parts.push(ev.actor);
    if (ev.detail) parts.push(ev.detail);
    if (parts.length) {
      const meta = document.createElement('span');
      meta.className = 'ev-meta';
      // Strict wrap rules: the "·" separator binds to the word before it (a
      // line never starts with "·"), and short parentheticals like "(rank 1)"
      // are kept whole instead of splitting across lines. CAREFUL: the join
      // string and the inner replacement contain a LITERAL non-breaking space
      // (U+00A0) — it looks like a normal space in most editors.
      meta.textContent = parts.join(' · ')
        .replace(/\([^()]{1,16}\)/g, (m) => m.replace(/ /g, ' '));
      line2.appendChild(meta);
    }
    if (opts.showTime) {
      const time = document.createElement('span');
      time.className = 'ev-time';
      time.textContent = (typeof formatGameTime === 'function')
        ? formatGameTime(ev.gameTime)
        : Math.round(ev.gameTime / 1000) + 's';
      line2.appendChild(time);
    }
    if (line2.childNodes.length) main.appendChild(line2);
    row.appendChild(main);

    // Secondary icon at the right edge: spell TARGET portrait or learned SKILL,
    // same size as the primary icon, joined by a small relationship glyph so
    // "who/what" is unmistakable (red ring = enemy target).
    if (ev.secondary) {
      const link = document.createElement('span');
      link.className = 'ev-link ev-link-' + ev.secondary.kind;
      link.textContent = ev.secondary.kind === 'skill' ? '+' : '▶';
      row.appendChild(link);

      const sec = buildIconEl('ev-secicon ev-sec-' + ev.secondary.kind, ev.secondary.icon, null);
      if (ev.secondary.hero) sec.classList.add('ev-sec-hero');
      sec.title = (ev.secondary.kind === 'skill' ? 'Skill: ' : 'Target: ') +
                  (ev.secondary.label || '');
      row.appendChild(sec);
    }

    if (opts.seekable && typeof opts.onSeek === 'function') {
      row.classList.add('ev-seekable');
      row.addEventListener('click', () => opts.onSeek(ev.gameTime));
    }
    return row;
  };

  Model.TYPE_META = TYPE_META;
  Model.CATEGORY_COLOR = CATEGORY_COLOR;
  Model.CATEGORY_LABEL = CATEGORY_LABEL;
  return Model;
})();

window.EventModel = EventModel;
