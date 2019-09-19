# WC3V

 **W**ar**c**raft **3** Replay **V**iewer.

 http://wc3v.com

 Goal is to simulate enough of wc3 to get a 'birds eye view'
 of the match from a given replay.

 Examples:

 ![Happy vs Grubby showmatch on Concealed Hill](/example-client-v5.png)

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
$ node wc3v.js --test
user args:  [ '--test' ]
parse: 97.790ms
TEST PASSED:  ./replays/test-ch-movement.w3g
parse: 23.388ms
TEST PASSED:  ./replays/test-ei-movement.w3g
parse: 700.738ms
TEST PASSED:  ./replays/bnet-ud-vs-orc-2.w3g
parse: 706.537ms
TEST PASSED:  ./replays/happy-vs-grubby.w3g
parse: 1425.998ms
TEST PASSED:  ./replays/grubby-vs-thorzain.w3g
parse: 1575.497ms
TEST PASSED:  ./replays/happy-vs-lucifer.w3g
parse: 1185.854ms
TEST PASSED:  ./replays/cash-vs-foggy.w3g
parse: 297.573ms
TEST PASSED:  ./replays/foggy-vs-cash-2.w3g
parse: 982.399ms
TEST PASSED:  ./replays/crow-vs-john.w3g
parse: 905.581ms
TEST PASSED:  ./replays/chae-vs-hawk.w3g
parse: 938.540ms
TEST PASSED:  ./replays/soin-vs-chae.w3g
parse: 1090.073ms
TEST PASSED:  ./replays/joker-vs-lil.w3g
```

# Example output

see the [happy-vs-grubby.w3g.wc3v](client/replays/happy-vs-grubby.w3g.wc3v) file for a pretty-printed JSON dump
of the current output for a Happy vs Grubby show match.

# How It Works

See the [DESIGN.md](/docs/DESIGN.md) file

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
