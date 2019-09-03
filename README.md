# WC3V

 (WIP) **W**ar**c**raft **3** Replay **V**iewer.

 Goal is to simulate enough of wc3 to get a 'birds eye view'
 of the match from a given replay.

 Examples:

 ![Happy vs Grubby showmatch on Concealed Hill](/example-client-v2.png)

 ![Battle.net match with title commentary](/wc3v-beta-preview.webm)

# Usage

## Running the reference `wc3v` client viewer

(NOTE: in order to show wc3 icons, you must follow the instructions on war3observer
 and put the resulting icons in the `client/assets/wc3icons` folder).

navigate to the `client` directory

run `npm install -g http-server` to install `http-server`

run `http-server` and follow the printed directions to see the locally hosted site


Also see the [client README.md](client/README.md) for more information

## Running the `wc3v` map parser

```
note: currently built as a node project for ease of development, will eventually
be ported to web.
```

run `node wc3v.js --replay=[REPLAY NAME]`

where `REPLAY NAME` is the replay file path in the `replays` folder without any extension

**example:**

`node wc3v.js --replay=happy-vs-grubby`

### Testing mode

to run wc3v in testing mode against a set of known test maps, run:

`node wc3v.js --test`

Latest test output:

```
user args:  [ '--test' ]
parse: 76.962ms
TEST PASSED:  ./replays/test-ch-movement.w3g
parse: 22.853ms
TEST PASSED:  ./replays/test-ei-movement.w3g
parse: 849.267ms
TEST PASSED:  ./replays/happy-vs-grubby.w3g
parse: 2317.975ms
TEST PASSED:  ./replays/happy-vs-lucifer.w3g
parse: 1732.055ms
TEST PASSED:  ./replays/cash-vs-foggy.w3g
parse: 454.778ms
TEST PASSED:  ./replays/foggy-vs-cash-2.w3g
parse: 1384.555ms
TEST PASSED:  ./replays/crow-vs-john.w3g
TEST FAILED:  ./replays/chae-vs-hawk.w3g
parse: 1306.988ms
TEST PASSED:  ./replays/soin-vs-chae.w3g
TEST FAILED:  ./replays/joker-vs-lil.w3g
parse: 706.573ms
TEST PASSED:  ./replays/bnet-ud-vs-orc-2.w3g


```

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
* Rendering 'birds eye view' of game play
* Player starting position detection
* Mirror matches

## Not implemented

* Neutral Creep tracking
* Item unit spawns
* Gold + Wood resource tracking
* Food / Upkeep tracking


# Credits

Replay parsing using:

* https://github.com/PBug90/w3gjs

Replay documentation from:

* https://github.com/scopatz/w3g/blob/master/w3g_format.txt

Icon extraction from:

* https://github.com/warlockbrawl/war3observer
