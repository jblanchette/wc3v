# TODO

Things left to finish, sorted by priority.

## wc3v engine

* read and parse JASS scripts from WC3 map files for starting position data
* unit pathing based on WC3 pathfinding (currently walking straight lines)
* backfill action support improvements:
  * simulate backfilled actions with retroactive timings
  * support abilities, shop events, item events
  * export backfill actions to correct record streams
* improved support for duplicate / corrupted / invalid actions (usually network related)

## wc3v client

* player status window groups rendering and selection
* load replay files based on minified hash ID schema
* replay upload improvements and error handling
* implement support for social features:
  * user comments
  * replay commentating support
