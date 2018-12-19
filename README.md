# wc3v

 (WIP) warcraft 3 replay viewer.

 Goal is to simulate enough of wc3 to get a 'birds eye view'
 of the match from a given replay.

# Usage

run

`node wc3v.js`

# Progress

The system handles most early game actions generally well.
As more actions occur in the replay the data becomes more certain.

Hotkey unit selections are not supported yet.

Need to implement starting position best-guess.

No time / game simulation yet.

# Credits

Replay parsing using:

* https://github.com/anXieTyPB/w3gjs

Replay documentation from:

* https://github.com/scopatz/w3g/blob/master/w3g_format.txt