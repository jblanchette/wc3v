# TODO

Things left to finish, list sorted by priority

## wc3v engine

* implement correct starting position mappings for all maps
* read and parse needed information from WC3 map files
* unit pathing based on WC3 pathfinding (currently walking straight lines)
* backfill action support improvements:
  * simulate backfilled actions with retroactive timings
  * support abilities, shop events, item events
  * export backfill actions to correct record streams
* improved support for duplicate / corrupted / invalid actions (usually network related)


## wc3v client

* implement support for all ladder 1v1, 2v2 maps
* implement support for all ladder 4v4 maps
* player status window groups rendering and selection
* load replay files based on minified hash ID schema
* create page for replay listings
* create page for replay uploads
* implement support for social features:
  * user profiles, reputation, rewards
  * user comments
  * replay commentating support

## wc3v webserver

* create golang webserver that accepts W3G files for parsing
* host API to download WC3V files
* persist WC3V in a datastore versioned by parser version
* create WC3V user community
* add social features API for commenting, sharing, and commentating
