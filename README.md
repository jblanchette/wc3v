# wc3v

 (WIP) warcraft 3 replay viewer.

 Goal is to simulate enough of wc3 to get a 'birds eye view'
 of the match from a given replay.

# Usage

run `node wc3v.js`

A list of replays is provided in the `replays` folder.

To configure a different replay parsing, edit the `replayPaths` const
in the `config.js` file.

To enable debugging turn on the `debugActions` config bool
For specific player only debugging, set the debugPlayer to their playerId

# Example output

see the [me-vs-orc.wcg.wc3v.pp](output/me-vs-orc.wcg.wc3v.pp) file for a pretty-printed JSON dump
of the current output for a b.net game I won UD vs ORC

# How It Works

See the [DESIGN.md](DESIGN.md) file

# Progress

Most basic game functionality works - some showstopper errors
are left in places where problems are still WIP.

Patch `1.31` broke viewing of downloaded replays, so debbuging
is difficult at the moment.

## Implemented
	
* unit selection / deselection
* unit spawning
* skill training, levels
* skill usage - point, object target, summon
* Right Click path tracking
* Hotkey Groups
* Items (partially - registrtion of shop items / giving or dropping)
* Shop tracking
* Game Time simulation
  * unit movement is simulated (turn rates and basic pathing around known buildings and terrian WIP)
  * building construction and upgrading is simulated

## Not implemented

* Neutral Creep tracking
* Item unit spawns
* Gold + Wood resource tracking
* Food / Upkeep tracking
* Rendering 'birds eye view' of game play

# Credits

Replay parsing using:

* https://github.com/anXieTyPB/w3gjs

Replay documentation from:

* https://github.com/scopatz/w3g/blob/master/w3g_format.txt
