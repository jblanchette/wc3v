# Design

The `wc3v` project aims to be able to get useful and impactful imformation
out of a Warcraft 3 replay file.  Because the `w3g` file format only contains
information about player inputs - the engine must keep track of uncertain
game events and actions by simulating them.

## Unit Tracking

The replay file tracks units with three basic concepts:

* `itemId` - either a unique string or a 4 entry list 
* `objectId1` and `objectId2` - numeric ids, unique to each unit
* `itemId1` and `itemId2` - numeric ids, list of 4 integers

Additionally commands can have `ability flags` sent as well, which further defines the command.

### Gameplay Breakdown

Each race starts out with a group of workers (UD starts with 3, rest 5) + a town hall building.
We assume these units to exist when we define our player instances - this is because we know
that a 'normal' game player will eventually select and interact with these units.

The engine keeps track of how many 'unregistered' units we know about - registering a unit is a concept we talk more about later.

#### Known Object IDs

Units with equal `objectId1-2` field were spawned at the start of game.  

Once we identify the `itemId` of a worker, we know the rest of the worker ID's are within `6` positions of this unit, because the game spawns them in sequentially.

With this information we are able to associate "known object IDs" for the 'worker' and 'town hall' groups.

These known object IDs become useful later when determining what an "unregistered" unit
really is.

#### Player actions required to make more units

Because Warcraft 3 requires the player to actually perform actions in order for more units to "spawn" into the world - it's easy for us at this point to associate things when a user selects that unit.

As a player begins a (normal) match they will select their existing town hall and produce a new unit.  We track this new unit as an "unregistered" unit, up until it has spawned and since been selected.  Because this unit is unregistered it means we need to increase our counter.

#### Selecting units 

When a player issues a command to `Change Selection` of the units the engine is told which `itemId` the player selected and a list of `itemId1` and `itemId2` keys for each selected unit. This `Change Selection` command is what happens either when you click on a unit - like a worker or a town hall; or when you tab-select between groups of units.

The `Select Subgroup` action gives us the `objectId1` and `objectId2` pair for the unit who is first in the group (and shown on your game UI).  The action is either a `select` or `deselect` tracked by the engine via the `SubGroup` class.

#### Registering units

Whenever a unit enters a players list of selected units we try to associate the `itemId1-2` with the `objectId1-2` by keeping units unregistered until they're registered.  A unit becomes "registered" when they are both in a selection group and also the focus of a `Select Subgroup` action.

Unit metadata is mapped to known `itemId` values - giving us the ability to simulate different actions and in-game results.

Luckily because Warcraft 3 forces you to interact with these units by selecting them "first" to do anything actually worth tracking - we eventually register all the known units that have done something meaningful.

#### Skills and Abilities

The Warcraft 3 engine tracks abilities of different categories based on how they function in-game.
For example a hero skill that summons a unit when cast is an `Ability with no target`.

The types of abilities are:

* UseAbilityNoTarget
* UseAbilityWithTarget
* UseAbilityWithTargetAndObjectId
* UseAbilityTwoTargets

and a notable mention for another active command:

* GiveOrDropItem

#### Skill levels

The replay contains an action for when a hero skill is learned, allowing us to keep track
of which skills a hero has taken and the level of the given skill.  This is also a good way
to infer hero level - but may not always be accurate.

### Player Position

Warcraft 3 uses a starting random seed to encode where the player 'starting positions'
should be on a given map.

The engine will need to read the map `JASS` file and determine the possible list of starting
locations, and then 'predict' where the player started based on their known movements.

In probably 99% of scenarios we will be able to guess correctly based on the assumption that
a player will build at least their buildings near their starting position.

### Backfilling 

As covered previously the `wc3v` map parser handles units in an unregistered state.  The actions units and buildings can take while still in an unregistered state are all important to determining the state of the game.

One common example can be seen in the test replay `test-backfill.wc3g`:

The sceanrio is that a newly spawned `Hero (DK)` is moving around the map - when a `Ghoul is then added to the selection group.  This `Ghoul` has yet to be selected directly - meaning we have not registered it yet.

After a couple of movement actions to and from a creep camp, the player eventually selects the `Ghoul` directly and sends them back to base.  At this point the `wc3v` parser recognizes that we've stored some `backfill` data for this `itemId1 / itemId2` pair in our action selections and performs a backfill of the data.

The backfill is performed by simulating the actions that we've stored in a compacted format alongside the gametime at which they occured.  Simulating the events allows for unit actions to be canceled or detected, in the same ways registered units have.
