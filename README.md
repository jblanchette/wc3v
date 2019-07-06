# wc3v

 (WIP) warcraft 3 replay viewer.

 Goal is to simulate enough of wc3 to get a 'birds eye view'
 of the match from a given replay.

 Examples:

 ![Happy vs Grubby showmatch on Concealed Hill](/example-client.png)

# Usage

## Running the client viewer

navigate to the `client` directory

run `npm install -g http-server` to install `http-server`

run `http-server` and follow the printed directions to see the locally hosted site

## Running the map parser

```
note: currently built as a node project for ease of development, will eventually
be ported to web.
```

run `node wc3v.js --replay=[PATH TO REPLAY]`

# Example output

see the [happy-vs-grubby.w3g.wc3v](client/replays/happy-vs-grubby.w3g.wc3v) file for a pretty-printed JSON dump
of the current output for a Happy vs Grubby show match.

# How It Works

See the [DESIGN.md](/docs/DESIGN.md) file

# Progress

Most basic game functionality works - some show stopper errors
are left in places where problems are still WIP.

Patch `1.31` broke viewing of downloaded replays, so debugging
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
