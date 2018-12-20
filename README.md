# wc3v

 (WIP) warcraft 3 replay viewer.

 Goal is to simulate enough of wc3 to get a 'birds eye view'
 of the match from a given replay.

# Usage

run `node wc3v.js`

A list of replays is provided in the `replays` folder.
To configure a different replay parsing, edit the `paths` const.

# How It Works

See the [DESIGN.md](DESIGN.md) file

# Progress

The system handles most early game actions generally well.
As more actions occur in the replay the data becomes more certain.

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