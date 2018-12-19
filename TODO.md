# TODO

Things left to finish

## wc3v engine

* add building meta data so we can detect alters from each race and such

* FIX - starting position based on team ID is wrong.  need to estimate based on action targets.
* Add itemId mappings for units / buildings with extra metadata
 * isBuilding
 * isClickable
 * isPermanent
 * isSpawnedAtStart
* support simulating actions over time by reading time blocks

## map parser

* read possible starting positions, neutral spawns from `j` file
* determine pathable grid, map size
* shop item loot tables / timings

## wc3v renderer

* determine best way to draw mini-size map
* draw known unit icons on screen at known position over time
* add start / stop / pause / seek
* support for 'highlights' checkpoints / seeking
* winner/loser and game result stats determination
