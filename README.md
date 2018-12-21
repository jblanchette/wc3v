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

parse: 356.022ms
******************************
Inspecting player: 1
Unit count: 43
Unregistered units: -10
[ 'Peon',
  'Peon',
  'Peon',
  'Peon',
  'Peon',
  'Building - Fortress',
  'Peon',
  'Peon',
  'Building - Altar of Storms',
  'Building - Orc Burrow',
  'Peon',
  'Building - Barracks',
  'Peon',
  'Peon',
  'Peon',
  'Blademaster - (4)',
  'Building - Orc Burrow',
  'Grunt',
  'Grunt',
  'Peon',
  'Grunt',
  'Unknown (shas)',
  'Grunt',
  'Building - Orc Burrow',
  'Grunt',
  'Shadow Hunter - (4)',
  'Building - Beastiary',
  'Building - Beastiary',
  'Wind Rider',
  'Wind Rider',
  'Building - Orc Burrow',
  'Wind Rider',
  'Wind Rider',
  'Wind Rider',
  'Building - Orc Burrow',
  'Building - War Mill',
  'Wind Rider',
  'Unknown (tgrh)',
  'Building - Orc Burrow',
  'Building - Orc Burrow',
  'Building - Watch Tower',
  'Peon',
  'Building - Watch Tower' ]
******************************
Inspecting player: 2
Unit count: 46
Unregistered units: -2
[ 'Acolyte',
  'Acolyte',
  'Acolyte',
  'Building - Black Citadel',
  'Acolyte',
  'Ghoul',
  'Building - Crypt',
  'Building - Graveyard',
  'Acolyte',
  'Building - Altar of Darkness',
  'Building - Nerubian Tower',
  'Ghoul',
  'Unknown (ocor)',
  'Death Knight - (4)',
  'Crypt Fiend',
  'Building - Ziggurat',
  'Crypt Fiend',
  'Skeleton Warrior',
  'Ghoul',
  'Crypt Fiend',
  'Building - Ziggurat',
  'Crypt Fiend',
  'Lich - (2)',
  'Building - Slaughterhouse',
  'Crypt Fiend',
  'Crypt Fiend',
  'Obsidian Statue',
  'Building - Ziggurat',
  'Crypt Fiend',
  'Obsidian Statue',
  'Crypt Fiend',
  'Building - Temple of the Damned',
  'Acolyte',
  'Building - Ziggurat',
  'Building - Necropolis',
  'Banshee',
  'Crypt Fiend',
  'Banshee',
  'Obsidian Statue',
  'Building - Ziggurat',
  'Acolyte',
  'Acolyte',
  'Acolyte',
  'Acolyte',
  'Building - Ziggurat',
  'Acolyte' ]


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