# wc3v

 (WIP) warcraft 3 replay viewer.

 Goal is to simulate enough of wc3 to get a 'birds eye view'
 of the match from a given replay.

# Usage

run `node wc3v.js`

A list of replays is provided in the `replays` folder.

To configure a different replay parsing, edit the `paths` const
in the `wc3v.js` file.

(WIP) accept replay file / replay flags from CLI

# How It Works

See the [DESIGN.md](DESIGN.md) file

# Progress

The system handles most early game actions generally well.
As more actions occur in the replay the data becomes more certain.

Output from Grubby vs Happy showmatch:

```
Inspecting player: 1
Unit count: 28
Unregistered units: -1
[ 'Peon',
  'Peon',
  'Peon',
  'Peon',
  'Peon',
  'Building - Great Hall',
  'Building - Altar of Storms',
  'Building - Orc Burrow',
  'Building - Barracks',
  'Blademaster - (4)',
  'Building - Orc Burrow',
  'Grunt',
  'Building - Voodoo Lounge',
  'Building - Orc Burrow',
  'Shadow Hunter - (4)',
  'Building - Beastiary',
  'Building - Beastiary',
  'Building - Orc Burrow',
  'Wind Rider',
  'Building - Orc Burrow',
  'Building - War Mill',
  'Building - Voodoo Lounge',
  'Building - Orc Burrow',
  'Building - Orc Burrow',
  'Building - Watch Tower',
  'Building - Watch Tower',
  'Building - Watch Tower',
  'Peon' ]
******************************
Inspecting player: 2
Unit count: 26
Unregistered units: 1
[ 'Acolyte',
  'Acolyte',
  'Acolyte',
  'Building - Necropolis',
  'Ghoul',
  'Building - Crypt',
  'Building - Graveyard',
  'Building - Altar of Darkness',
  'Building - Ziggurat',
  'Building - Tomb of Relics',
  'Death Knight - (4)',
  'Acolyte',
  'Crypt Fiend',
  'Skeleton Warrior',
  'Building - Ziggurat',
  'Lich - (2)',
  'Building - Slaughterhouse',
  'Building - Ziggurat',
  'Obsidian Statue',
  'Building - Temple of the Damned',
  'Building - Ziggurat',
  'Acolyte',
  'Building - Necropolis',
  'Banshee',
  'Building - Ziggurat',
  'Building - Ziggurat' ]
```

Output from a normal starting match on `Echo Isles` for an Undead player:

```
====================================
parse: 316.603ms
******************************
Inspecting player: 1
Unit count: 16
Unit names:

[ 'Acolyte',
  'Acolyte',
  'Acolyte',
  'Building - Necropolis',
  'Acolyte',
  'Acolyte',
  'Building - Crypt',
  'Building - Altar of Darkness',
  'Building - Ziggurat',
  'Building - Graveyard',
  'Building - Tomb of Relics',
  'Death Knight - (1)',
  'Ghoul',
  'Ghoul',
  'Building - Ziggurat',
  'Crypt Fiend' ]
```

## Implemented
	
* unit selection / deselection
* unit spawning
* skill training, levels
* skill usage - point, object target, summon
* Right Click path tracking

## Not implemented

* Neutral Creep tracking
* ~Hotkey Groups~
* Items
* Item unit spawns
* Shop tracking
* Game Time simulation
* Gold + Wood resource tracking
* Food / Upkeep tracking
* Rendering 'birds eye view' of game play

# Credits

Replay parsing using:

* https://github.com/anXieTyPB/w3gjs

Replay documentation from:

* https://github.com/scopatz/w3g/blob/master/w3g_format.txt