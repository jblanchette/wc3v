---
title: "WC3V — Pro Build Orders, In-Browser Replay Analysis & Pro Comparison"
url: https://wc3v.com/
description: "Free Warcraft III build order library and replay analyzer. Browse pro builds by race and matchup, drop a .w3g to analyze it locally in your browser (never uploaded), or compare your replay to a pro's with letter-graded macro, tech, expansion, and build-order feedback."
updated: 2026-08-17
---

# WC3V

A Warcraft III replay simulator, built for learning the game.

WC3V does three things.

**Pro build library.** Tournament builds by race and matchup, each with the pro replay behind it. Not theory, not a wiki page: a build someone actually won a tournament game with, and the game itself so you can watch it played.

**Replay simulator.** Warcraft III cannot rewind a replay. WC3V rebuilds the game from the `.w3g` file, so you can jump to any second, follow both build orders as they happen, and see where the game turned.

**Compare to a pro.** Drop your own replay and it is matched to the closest pro game in the corpus, then graded: macro, production, item economy, idle resources, build order, tech timings, hero skill choices.

Replay files are parsed entirely in your browser. Nothing is uploaded, there are no accounts, and there is no analytics. The site is free and open source under GPLv3.

There is also a Windows desktop app that watches your replay folder and has the report ready by the time you alt-tab out of a finished game.

## The build library

16 curated builds, every one taken from a tournament game you can watch.
Full detail for each is at the linked page.

### DK Fiend Standard

Undead · UvO, UvH, UvU · New to WC3 · 5 pro replays

A simple Undead build for new players. Death Knight opener, Ghouls mine lumber, and your fighting army is Crypt Fiends -- you never have to micro Ghouls in a fight. Reach Tier 2, pump Fiends, add Obsidian Statues for sustain, and bring in a Lich second hero for Frost Nova burst.

- Open DK for Unholy Aura speed and Death Coil sustain — creep efficiently to level 3
- Rush to tier 2 around 5:30–6:00, start Fiend production immediately from Crypt
- Lich second hero with Frost Nova — obliterates clumped melee and provides burst damage
- Add Obsidian Statues at T2 for mana/HP regen sustain in prolonged fights

Full build: https://wc3v.com/builds/udo-dk-fast-fiend

### DK Destroyer

Undead · UvN, UvH, UvO · Pro meta · 10 pro replays

DK Fiend opener that priorities a fast T3 for Destroyer tech. Destroyers' Devour Magic hard-counters caster-heavy armies like NE Dryads or HU Priests.

- Standard DK Ghoul T1 — creep efficiently, build 4-5 Ghouls before teching to Fiends at T2
- Lich second with Frost Nova for burst damage in engagements
- Rush T3 for Destroyers — they eat buffs/debuffs and counter caster compositions
- Destroyers absorb mana for healing — self-sustaining vs magic-heavy armies

Full build: https://wc3v.com/builds/ud-dk-destroyer

### BM Wind Rider

Orc · OvU · Pro meta · 18 pro replays

Blademaster opener with heavy early harassment, transitioning into Wind Rider air superiority. Denies expansion and wins on economic disruption.

- BM's Mirror Image and Wind Walk make him nearly impossible to catch early game
- Constant worker harassment forces UD to divert Acolytes and delays expansion
- Wind Riders fly over Undead army positioning and attack buildings directly
- Shadow Hunter second hero for Serpent Wards and Healing Wave sustain

Full build: https://wc3v.com/builds/orc-bm-wind-rider

### FS Headhunter

Orc · OvU, OvH · Ladder · 15 pro replays

Far Seer opener with Headhunters and Shamans. The most versatile Orc opener — Bloodlust makes Headhunters burst targets down, Hex and Purge shut down enemy heroes.

- Far Seer Spirit Wolves are free tanks that absorb Death Coil and Holy Light
- Headhunters with Berserker Upgrade have extreme DPS under Bloodlust
- Shaman Hex removes key enemy units from fights for several seconds
- Purge removes Unholy Aura speed, Brilliance Aura, Devotion Aura

Full build: https://wc3v.com/builds/orc-fs-headhunter-shaman

### BM Grunt Standard

Orc · OvN, OvU · New to WC3 · 13 pro replays

Blademaster opener into mass Grunts for an aggressive ground push. BM harasses workers while Grunts pressure the front door. Transitions into Spirit Walkers or Raiders at T2.

- BM Wind Walk into enemy base for worker kills while Grunts creep
- Mass Grunts are cost-effective and trade well in melee engagements
- Shadow Hunter second — Healing Wave keeps Grunts alive in sustained fights
- Push timing at 50-60 food with BM3 + SH + 5-6 Grunts

Full build: https://wc3v.com/builds/orc-bm-grunt-push

### AM Caster

Human · HvN, HvO, HvU · Ladder · 19 pro replays

Archmage into Footmen, then Priests and Spell Breakers at T2. The dominant Human build in the current meta. Inner Fire buffs Footmen, Spell Steal counters summons.

- Archmage Water Elementals trade well early — micro them aggressively
- Footmen tank while casters deal damage from behind
- Priests with Inner Fire are the core — buff Footmen damage and Heal sustains
- Spell Breakers counter enemy summons and provide spell immunity

Full build: https://wc3v.com/builds/hu-am-caster

### AM Rifle

Human · HvN, HvH, HvO · New to WC3 · 3 pro replays

Archmage into Footmen transitioning to Riflemen and Sorceresses. Rifle range controls space, Slow from Sorceresses kites melee armies.

- Archmage Water Elementals are free units that trade well early — micro them aggressively
- Brilliance Aura gives permanent mana regen to all nearby units — enables Blizzard spam
- Riflemen have the longest range of any T1 ground unit — kite melee effectively
- Mountain King second for Storm Bolt stun and Bash — shuts down enemy hero plays

Full build: https://wc3v.com/builds/hu-am-rifle

### MK Fast Expand

Human · HvU, HvN · Ladder · 7 pro replays

Mountain King first into fast expansion. Storm Bolt stuns harassers, Bash provides melee dominance. Build army to 60 food then upgrade to Castle for Knights.

- MK first — Storm Bolt is the best anti-harass stun in the game
- Fast expansion with militia to defend the new Town Hall
- MK + Footmen + Rifles can defend expo against most early aggression
- AM second for Brilliance Aura mana sustain and Water Elementals

Full build: https://wc3v.com/builds/hu-mk-fast-expand

### KotG Mountain Giant

Night Elf · EvH, EvO, EvU, EvE · Ladder · 10 pro replays

Keeper of the Grove opener into Mountain Giant tank line. Entangle roots Human heroes, Giants taunt Human armies, and Treant summons provide free reinforcements.

- KotG Entangling Roots roots Human heroes — removes Divine Shield timing windows
- Mountain Giants have the highest HP of any unit in the game at Tier 3
- Giant Taunt forces Human Sorceresses to polymorph their own units if poorly positioned
- Force of Nature summons free Treants from enemy trees — punishes Human passive play

Full build: https://wc3v.com/builds/ne-kotg-mountain-giant

### DH Standard

Night Elf · EvU, EvO, EvH · Ladder · 42 pro replays

The standard Night Elf build. Demon Hunter first for Manaburn harassment, fast tech to T3 for Druid of the Claw (bears). Bears in Bear Form have massive HP and Roar aura.

- DH first — Manaburn drains enemy hero mana, shutting down their abilities
- Immolation provides passive AoE damage — good for fast creeping
- Fast tech through T2 to T3 — the goal is Bears as fast as possible
- Druids of the Claw in Bear Form have 960 HP and Roar gives 25% damage aura

Full build: https://wc3v.com/builds/ne-dh-fast-bear

### DH Mass Talons

Night Elf · EvO · Pro meta · 11 pro replays

Demon Hunter into mass Druids of the Talon with Cyclone spam. Exploits Orc's limited dispel options. Cyclone removes key units from fights, Faerie Fire reduces armor.

- DH first for Manaburn — drains Blademaster's mana, preventing Wind Walk escapes
- Druids of the Talon cast Cyclone — removes Grunts and key units from fights for 6 seconds
- Mass Cyclone means Orc can never fight at full strength — always 2-3 units disabled
- Faerie Fire reduces armor and reveals invisible units — BM can't hide

Full build: https://wc3v.com/builds/ne-dh-mass-talons

### DK Gargoyle

Undead · UvO · Pro meta · 18 pro replays

DK opener into mass Ghouls for lumber, then flood Gargoyles from multiple Crypts. Air superiority overwhelms Orc ground armies. Dark Ranger or Dreadlord third hero for utility.

- DK first with Death Coil — creep efficiently, mass Ghouls for lumber harvesting
- Delayed T2 (7:00-8:00) because heavy Ghoul investment feeds the Gargoyle transition
- Lich second with Frost Nova — burst damage on Orc ground clumps
- T3 for mass Gargoyle production from double Crypt — quantity is key

Full build: https://wc3v.com/builds/ud-dk-mass-gargoyle

### Lich Fast Tech

Undead · UvH, UvU, UvO · Pro meta · 10 pro replays

Lich first hero for early Frost Armor tankiness and Frost Nova burst. Slightly defensive opener that creeps with Ghouls and rushes T2 Crypt Fiends. DK as second hero anchors the army at level 6 with Death Coil sustain.

- Lich opener trades creep speed for early magic damage and Frost Armor on Ghouls — survives harassment better than DK first
- Frost Nova on tightly packed melee armies is a swing in midgame fights
- Skip aggressive level 6 timing — wait until DK is also at 6 to commit
- Statues at T2 sustain Lich mana for repeated Frost Nova casts

Full build: https://wc3v.com/builds/ud-lich-fast-tech

### PotM Mass Huntress

Night Elf · EvH, EvE, EvO · New to WC3 · 1 pro replay

PotM first hero for Trueshot Aura damage boost and Searing Arrows hero harass. Mass Huntresses provide ranged DPS and Sentinel scout vision. Strong open-map control build.

- PotM Searing Arrows is a powerful early hero-harass tool — trade hits at any creep camp
- Trueshot Aura at level 3 buffs all ranged units permanently — Huntresses scale incredibly with it
- Sentinel Owl gives free vision at any tree line — abuse for scouting and creep timing
- Build Hunter's Hall after first Ancient of War — Moon Glaive upgrade is critical

Full build: https://wc3v.com/builds/ne-potm-mass-hunts

### Paladin Rifle

Human · HvO, HvN, HvU · Pro meta · 2 pro replays

Paladin first hero for Holy Light sustain on early Footmen. Tower up at base, mass Riflemen with Priest support. Defensive opener that scales into a powerful T2 ranged army.

- Holy Light keeps Footmen alive through early creeping and harass — pivotal at low levels
- Tower one or two Guard Towers at home before second peasant batch — discourages early aggression
- Riflemen production starts around 4:30 — keep all Barracks busy
- Priests with Inner Fire double-buff Riflemen damage; Heal sustains the front

Full build: https://wc3v.com/builds/hu-paladin-rifle

### Crypt Lord Standard

Undead · UvH, UvN, UvO · Ladder · 1 pro replay

Crypt Lord first hero for Carrion Beetles map presence and Impale stun. Ghoul opener like other UD builds, transitions to Crypt Fiends and Statues at T2. Strong vs Night Elf Bears (Impale shuts down DPS) and Human casters (CL tankiness in the front line).

- Carrion Beetles are free creeping units — produce off cooldown, let them tank camps
- Spiked Carapace at level 2 — CL becomes the front-line tank, takes Footman/Grunt focus fire
- Level 6 Impale stun is decisive on grouped enemy heroes — wait until T2 fight to commit
- DK second hero for Death Coil sustain on CL between fights

Full build: https://wc3v.com/builds/ud-cl-standard

## The replay corpus

351 parsed pro games are indexed at https://wc3v.com/data/summaries-index.json.
