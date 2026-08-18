# WC3V Desktop: changelog

## 1.0.4 — 18 Aug 2026

### Updating your history never actually started

The strip that says "Updating your history" opened, counted the games it had to
re-read, and then sat there. It was not slow and it was not stuck on a bad
replay. It had not started at all.

`backfill.start` was never exported from the backfill module. The strip called
it, got a TypeError, and the error escaped before there was a promise to catch
it with, so nothing was logged and nothing moved. The count you were looking at
was the opening estimate, printed once, forever.

Pause did nothing for the same reason. With no run in progress the button fell
through to "start", which threw again. And it never changed to Resume, because
the label was only ever refreshed when a run began.

Three fixes. The engine exports `start`. Pausing and resuming now carries the
run's options with it, so a resumed migration still reports progress instead of
coming back with a bar that never moves. And a failure of any kind, including
one thrown before a promise exists, now says so on the strip and in the log
rather than leaving a number sitting on screen.

### One app, one process

Closing the window hides WC3V to the tray, so a second launch used to be
invisible until it did damage: a second tray icon, a second watcher re-reading
and re-announcing the same games, and a second overlay server that walked past
the taken port onto the next one, leaving the URL already pasted into OBS
pointed at the first copy. Launching WC3V again now raises the window that is
already open.

### The report reads tighter

Creep routes were below the fold on every screen, at the bottom of a scroller
nobody scrolled. They now sit at the top right, beside the result, and the box
prints what it is for: a camp total per player and how many camps were
contested. Contested comes from the parser's own reading of each camp rather
than from guessing at the overlap between two players' routes, which reported
zero for every game in the corpus.

The two-lane moments timeline is gone. It cost 70px of the fold to restate what
the dominance plot beside it already showed.

Alignment and empty space, found by walking every tab with a DOM auditor:

- The two tier bars started at different x, because the "You" chip widened its
  own row. They are one grid now, so names, bars and times line up down the
  block.
- The unit roster sized every tile to its own text, so the second row's columns
  were 24px off the first.
- Nothing stretches to its neighbour any more. An upgrades panel was 201px tall
  around 66px of content, and the Economy card put 196px of blank inside a
  drawn border.
- The damage matchup table needed 359px in a 294px card, so it opened with a
  scrollbar and cut "Unarmored" to "Unarn".

### Settings

App updates lead the sheet instead of sitting third behind two panels you set
once. The old "App" section, which mixed updates with startup and
notifications, is now "Startup and alerts" and holds only those.

## 1.0.3 — 18 Aug 2026

### The app holds still between games now

Going from a match, to the report, to the next match flapped. It dropped to
idle between games, and then jumped back onto a scouting panel for the match
you had *just finished reading about*.

Two causes, both about not knowing something.

The ladder client collapsed a five-second timeout, an offline machine, a 500
and a 404 into one `null`, and the poller could not tell that from "the match
is over". A single dropped request ran the whole end-of-game transition: live
card down, report column reset, broadcast told the game had finished. The
lookup now answers live / none / **unknown**, unknown moves nothing at all, and
it takes two consecutive definite misses to take a card down.

And when a replay landed, the poller forgot *which* match had ended. The
W3Champions ongoing endpoint lags the replay write by a good twenty seconds, so
the next poll handed the finished match straight back and the app latched it as
a new game. Ended match ids are remembered now.

Underneath both: there was no state machine. "Phase" was an emergent property
of five booleans in five modules across three processes, and nothing arbitrated
between them, so the window and the broadcast could disagree about whether a
game was on. One owner now decides idle/live/post, every view subscribes to it,
and the phase is published to OBS rather than re-derived inside it.

**Between games the app now rests on the previous game.** Idle is reachable
only from a cold start with nothing on disk.

Also in this pass:

- One report render when a game lands, not three. Two of the three painted the
  game you were about to be moved off, each remounting the dominance chart and
  its resize observer, so the previous game visibly flashed twice.
- The parse is visible. The two-to-five seconds after a match used to be a
  blank gap with the *old* game still on screen.
- A replay that cannot be read ends the match. The app used to sit in "in game"
  forever on a bad file, because only a successful parse cleared the card.
- The session board, the last game and the MMR climb baseline survive a
  restart. Reopening the app mid-stream used to reset a 3–1 night to 0–0 on
  air.
- The Stream tab's preview updates when a match starts. Nothing in the poller
  ever asked it to redraw, so it sat frozen while you watched it.

### The OBS URL no longer moves

The overlay port was ephemeral — persisted between launches, but drawn from the
same 49152+ range Windows hands to outbound sockets. Any other program could
take it over a reboot, and the app would quietly rebind somewhere else, leaving
a Browser Source blank with nothing on screen to explain why.

It now takes a fixed registered port with a deterministic fallback ladder, and
**keeps answering on every port it previously served** — so a URL already
pasted into OBS keeps working and nobody has to re-copy anything. In the one
case that does need action, a handed-out port nothing can bind any more, the
Stream tab says so.

### Creep routes, on the map

Both players' creep routes are drawn on the map's own minimap art: every camp
as a ring, each route as a numbered line from the starting position, and the
camps nobody touched still showing. Under the player columns on Overview, and
again larger on Economy beside the per-camp list that says what was in each one.

Reading a route as a numbered list answered "what did they kill" and never
"where did they go", which is the thing a route is actually about.

### The stream overlay looks like the app now

The post-game card was a verdict word, three metric rows, two sentences and a
record — while the app's own report of the same game leads with portraits. Two
new panels are on by default:

- **heroes** — every hero, their level and what they were carrying, as art. The
  card previously showed one portrait and nobody's level.
- **army** — what both sides fielded, biggest first, yours over theirs.

Plus a timings rail on the verdict banner (tier 2, tier 3, expansion, first
tower as ticks where they happened, which says "fast expand, late tower" before
a label is read), and the gold trade drawn as a two-sided bar — it has been in
the payload since the panel was written and was never on screen.

One new panel is off by default and available by name: **route**, the creep-route
map. It is the only thing on the card that fetches an image, and it wants more
height than a default card should take.

Every panel name that has ever worked still works. A URL already in OBS that
names its panels explicitly is untouched.

### Games on newer map versions were read against the wrong map

A replay names the map file it was played on, and WC3V matched that name against
its map library by taking the first library entry whose name appeared anywhere in
it. Map names nest, so the shortest one always won: a game on Echo Isles S2 was
read against classic Echo Isles, AutumnLeaves v2.0 against v2-0, Tidehunters v1.2
against Tidehunters.

Nothing failed. The game parsed, the report rendered, every number had a value.
They were just measured against another map's terrain, creep camps and starting
positions — on Echo Isles S2 the bases were placed 1536 units from where the
players actually built, which put ordinary base activity on top of a creep camp
that was not there and recorded a camp clear that never happened.

Half the ladder pool was affected: 175 of 362 test replays resolved to a
different map than they were played on. Games on maps whose name is nobody's
prefix — Concealed Hill, Twisted Meadows, Northern Isles — were always read
correctly.

Stored summaries carry the consequences with no marker, so this is a schema
bump (v6) rather than a silent fix: the app re-reads the games it already has.
Existing games show as stale and "Parse all replays" brings them current.

## 1.0.2 — 16 Aug 2026

An overlay pass driven by actually streaming with it. Both complaints turned
out to share a cause: the card was built against a monitor at arm's length
rather than a 720p window several metres away.

### It is readable now

The Size control ran 0.85 / 1 / 1.25 and started at 1, which puts the body type
at 14 pixels — about nine of them once Twitch has encoded the stream and the
viewer is not fullscreen. It now runs 1 to 2 and starts a rung higher, and the
suggested Browser Source size follows the size you picked instead of quoting
the old number back at you.

Every crest, hero portrait and section mark was sized in pixels, so the Size
control scaled all the words and left the art exactly where it was. The whole
card scales together now.

### Between games it says something

The card used to shrink itself when there was nothing on: half the padding, a
smaller wordmark, two grey lines in a corner. That is the state it is in for
most of a night. It is a session board now — the score at four times its old
size, a rail of notches for the night's results in order, your rank and MMR with
the day's climb, and the last result on one line. Before your first game it
shows a plate rather than a sentence.

The live dot beside the clock breathes, so a card that is connected does not
look identical to one that died an hour ago.

### The live match card no longer freezes in the tray

Closing WC3V hides it to the tray, which is what a streamer does after starting
it, and starting at login goes straight there. The ladder poll behind the live
match card stopped dead whenever that happened, so the card froze on the
broadcast for the rest of the session. It now keeps polling for as long as a
Browser Source is attached.


## 1.0.1 — 14 Aug 2026

The Stream tab, and an overlay that has something to say while you are playing.

### The card during a game

The overlay used to show the last game's verdict for the whole time you were
in the next one. A finished result sitting under a player who is visibly still
playing is the most confusing thing the card could do, so it now comes off and
the scouting panel becomes the live match: a LIVE mark, a clock counting up,
your opponent with their rank and MMR, your record against them, your record on
the map being played, and the heroes they usually open on.

The session footer gained your ladder rank, your MMR, and how far it has moved
since the app opened. It is what every ladder stream carries and this never had.

The clock counts from the ladder's match-created time, which is the queue pop
rather than the first frame, so it says "live" and never claims to be the
in-game timer. Where W3Champions gives no usable start time the card shows no
clock rather than a wrong one.

None of this reads the running game. It is the public W3Champions ongoing-match
lookup over the replays already on this machine, and the card says so on itself.

### The Stream screen

Getting it into OBS is the first thing on the screen instead of the last, and
it is called OBS setup. The copy button sits at the top of it.

Casting is a mode now rather than a panel below the fold of a scroller with its
own copy button below that. The switch at the top picks your own stream or a
match you are casting, and each gets its own setup panel and preview.

Layout and Look were two panels asking one question, so they are one panel
called Card. Each setting is a labelled row rather than a heading stacked above
its buttons.

The preview steps through the three states a card actually passes through in a
night: waiting, during a game, after a game.

### Themes

Three, and they differ in form rather than in colour. Carved is the stone panel
and the default. Etched has no panel at all and strikes the type onto the
footage, for a scene that has already spent its screen on the game. Parchment is
a light quest-log page for a bright scene the dark box fights. The WC3V mark is
on every one of them, in every state.

Slate was a re-tint of Carved and is gone from the picker. Its styling stays, so
an overlay URL copied while it was offered keeps rendering exactly as it did.

### Fixes

- A hero portrait that failed to load left the browser's broken-image mark on
  the card. It is replaced with a blank tile now, which is what an OBS machine
  with no internet was always supposed to get.
- A W3Champions account with no ladder record made an extra lookup on every
  poll for the rest of the session.

## 1.0.0 — 10 Aug 2026

The launch. Everything below 1.0.0 was dogfooding: builds published to R2 so
one install could update itself, with nothing user-facing announcing them.
From here the download page (wc3v.com/download.html) is live, reads the same
update manifest the app does, and always points at this — the current —
installer.

1.0.0 is 0.10.0's report made public: the density ruleset, the one-row frame,
the Overview header riding the dominance band, the moments timeline, the
per-team creep truth and the interleaved build order, on the schema-v5 store
with self-migration. See 0.10.0 below for the detail; nothing changed between
the two but the version, the download page going live, and the launch
housekeeping (the preview pages and pre-release language went).

## 0.10.0 — 10 Aug 2026

The report gets a design system, loses its band, and reads the game's moments.
Every layout decision below went through screenshot rounds against real games
— personal 1v1s, the 3v3, the 4v4, sparse fixtures, stale summaries, at
1280x820 and 900x600.

### One ruleset instead of two rhythms

The report body rendered from the viewer's own stylesheet: Verdana, a
saturated `#00aaff` accent, rem-scale spacing — a second product pasted into
the middle of a warm carved one. `report.css` now re-registers the whole
shared sheet onto the desktop's tokens (the vendor file untouched, the viewer
keeps its skin): the app's face everywhere, nothing under the 0.8rem floor,
tier and category hues pulled into the warm paintbox, spacing on the `--sp-*`
scale, the active tab a carved pressed well instead of a blue underline. New
tokens `--radius-xs`, `--scrim`, `--tier2-ink`, `--tier3-ink`; `--sp-8`
closed; the button height declared once instead of three times.

### The band is gone; the frame is one row

Tabs left, Open in WC3V Viewer right — on every game, including one whose
summary is too old to draw tabs. The band's content (result, opponent,
all-time record, map, length, tags, benchmarks) leads the Overview tab
instead, riding the band's right column beside the dominance plot, over the
tier bars: the result and the shape of the game in one glance, scrolling with
the tab instead of taxing every tab's frame. A team game gets no "carries no
result" placeholder — the meta line already says 3v3.

### The moments timeline

The summary's typed moments — hero kills, wipes, raids, tier-ups, expansions,
scouts, up to 24 per game — were reaching the stream overlay in full and the
report not at all. They are now two lanes under the band, yours over theirs
(per team in team games), every mark a 36px target that opens the viewer at
that second, the least important hiding when the width gets crowded.

### Team games stop lying

The mode is derived from the seats when the parser did not record it (a 4v4
read as a duel in the feed and a team game in the report at the same time);
old summaries are repaired at read time rather than marked stale. Team-scoped
creep routes and hero XP render once per team instead of identically in every
teammate's column; the creep score counts per team instead of double; the
unreadable 2px six-seat APM bars yield to the per-player lines each column
already carries.

### One build order

The Build tab's two parallel per-player columns are one interleaved
chronology: each row wears its player's race ink, the reader's own rows at
full ink. "He made his altar while I was still on the mill" is now a thing
the list just says.

### The audit is a command

`tools/desktop-preview.js` gained `--mix` (one page carrying every data shape:
the audit preset) and `--out` (pages coexist); new `tools/report-shots.js`
walks every page x game x tab x chart mode x size headless, runs the README
fold assertions at every stop, and exits non-zero on any violation. The
release gate is a clean run across five pages.

## 0.9.1 — 10 Aug 2026

Three tabs instead of six, an Overview that reads across instead of down, and a
dominance chart that is drawn rather than stretched.

### Overview leads with the game, then the players

Dominance and tier progression are the only two things on the tab that are about
the game rather than about a player, and they sat under a screenful of rosters.
They are a band across the top now, both short: the plot is read as a shape and
the tier bars are three segments on a track, and the height they used to take is
height the columns below get.

Inside each player column the sections sit **side by side**. Left is the
identity, the heroes and the unit roster — one tall narrow list. Right is the
damage matchup, the APM line and the match stats, stacked beside it. Stacked
down the column the tab was roughly twice as tall and half of every row was
empty.

### The dominance chart was being stretched, not drawn

`DominanceChart` is authored at a 320x96 viewBox with
`preserveAspectRatio="none"`, which is right in the viewer's ~320px Insights
panel and wrong everywhere else. In a report column three or four times that
wide, every horizontal unit stretched to match while the vertical stayed put:
the 30-unit y-axis gutter became a 100px trench, slopes sheared flat, and the
momentum dots only stayed round because the class scaled them back by hand.

`setResponsive(true)` matches the viewBox to the rendered element, so one unit
is one pixel in both axes. Verified at three window sizes: the viewBox and the
box now agree exactly. The scrub maths reads `chart.geometry()` off the
instance rather than the class constant, and measures the plot rather than the
panel around it — the old version was a few pixels early on every seek.

### Six tabs became three

**Army** is production and research. **Economy** is resources, items, creeps and
the four time series. Army/Upgrades and Economy/Creeps/Charts were five screens
each holding one short section list, so every one of them opened on a page that
was mostly background — and the sections that answer each other, what you built
against what you upgraded and what you spent against the camps that paid for it,
were never on screen together. Every section packs two-across into its column
now, and the four time-series plots run two-up rather than one per row.

Nothing was dropped. The Build tab is unchanged. `ChartPanel`'s Resources and
Army plots follow the charts they belong beside, to the foot of Economy.

### "You" is marked, not just sorted first

The reader's own seat carried a faint `you` on the Build tab and nothing at all
on Overview, so on a screen of two symmetric columns you read a name to find
your own half. The column now takes a gold ring and a lift, the name takes a
`You` chip, and the tier bars and the creep score mark their own row.

This is a desktop-only claim and the shared renderer treats it as optional: the
viewer loads replays of strangers and has no seat to point at. `isYou` is set by
`js/summary-model.js`; `client/js/MatchSummary.js` never sets it.

### Everything else lands on the site too

All of the above except the "You" marker is `client/js/MatchSummaryView.js` and
`client/css/match-summary.css`, so the viewer's Match Summary modal is the same
screen. Its panel widened from 1,100 to 1,400 because the layout converts width
into height it no longer needs, and the Overview split degrades on the width of
its own column rather than the window's, which is the only question a modal
inside a wide viewport can answer.

Two rules enforced while in there: the upgrade rows carried a 3px single-edge
accent stripe per category and now carry a background tint and a coloured
portrait frame, and the `.ms-chart` height cap was 30px under what a half-width
plot actually needs, so every chart letterboxed itself inside its own block.

## 0.9.0 — 7 Aug 2026

The game report becomes the viewer's Match Summary screen, drawn by the viewer's
own code.

### Seven tabs, six of them shared

Home now shows **Overview, Army, Economy, Upgrades, Creeps, Charts** and
**Build**. The first six are `client/js/MatchSummaryView.js`, the same renderer
the site's viewer mounts in its Match Summary modal, and this app draws none of
them: `js/summary-model.js` turns a stored summary into the model it takes and
injects the icon resolver and the colour function. Same rule as the dominance
chart. If this app ever starts drawing a tab of its own, the seam has leaked.

This **reverses `c6af5a5` ("one screen, no tabs")**, deliberately. What that
change was right about is still true — the old tab strip split one game's story
across two screens — but the Match Summary is one screen's worth of material
per tab, not half of a report.

Overview carries the dominance plot, so the chart panel's Dominance chip is
gone; its Resources and Army charts moved into the Charts tab. Build is the only
tab with no equivalent on the site: the build cards and the build order in the
order it happened. "Buildings by tier" and "Upgrades and mercenaries" are gone
from it, because the Army, Upgrades and Economy tabs are those sections.

The fold rule is unchanged and re-audited: `.report-body` is still the only
element allowed to scroll, and the tab strip sits above it in the fixed band.

### The band is one line

**99px → 36px**, which is 62px straight back into the only scroller on the
screen. Nothing was removed: the verdict, the opponent, the all-time record,
the map, the length, the tags, the three benchmarks and the viewer button are
all still there, in one row that wraps only if the window is too narrow.

It was three stacked things — a verdict row, a fact line under it, and a
four-row benchmark table beside them. The table was 96px of the 99 on its own;
the one-line form of it already existed but only applied below 1040px, and it
is now the only form. Army, Economy and Upgrades fit inside the fold at
1280x820 as a result.

### Tabs looked like operating-system buttons

`.ms-tab` was written for the viewer's `<div>` tabs and set only a bottom
border. This app renders them as `<button>` for the keyboard and the `tablist`
role, so every user-agent default came through: grey fill, full border, system
font. The rule resets `appearance`, `background` and `border` now, and works as
either element.

### The Overview tab packs across the width

`.ms-ov-bottom { margin-top: auto }` pinned Match Stats to the foot of a column
taller than its content, which is where the hole in the middle came from. The
sections are `.ms-block`s in a grid now, so Damage Matchup and APM sit side by
side, and Match Stats is a wide strip of label/value pairs rather than a 180px
two-column table. Per-player column: **734px → 554px**.

### Schema v5, and a backfill that actually backfills

Stored summaries now carry `players[].build` — what `BuildOrderData` derives
from the event stream — plus the camp records the Creeps tab needs (claim state,
owner, route order, the creeps themselves, per-hero XP).

It is **stored rather than re-derived**. `BuildOrderData.buildTierSnapshots`
accumulates gold over its own synthesised event list, not the raw stream, so a
second extractor here would have disagreed with the viewer the first time either
was edited. The class is dual-runtime now and runs at parse time.

Measured with `tools/measure-summary-v5.js`: **+2.4 KB per game, 34 MB for
3,072 games.**

**The backfill would never have upgraded anything.** It skipped a replay when
`isStored(key)` was true, which is presence, not freshness — so every summary
written before a schema bump stayed at the old version forever, with only the
per-game "Re-read" button as a way out. The store tracks stale keys now and the
backfill skips on `isCurrent(key)`.

### The app upgrades your history itself

A summary written under an older schema is missing blocks only a full parse can
produce. There is no in-place fix, so on launch **the app re-reads the whole
history by itself**, newest first, in the background, with a strip under the app
bar showing how far it has got and a Pause. Nothing to find, no button to press.

**A game not yet re-read shows the reason and nothing else** — the result, the
map, the length, Open in Viewer, and one line explaining that it needs
re-reading. It does **not** draw a partial report. The old data is enough for
build cards and a build order, and showing them was the obvious kindness, but
the result looks complete while silently omitting the roster, the creep route,
the upgrades and every chart. Nobody can tell that screen apart from a game
where those things did not happen.

Two bugs behind this, both of which made the update look like it had done
nothing on a machine with history: the boot catch-up was gated on an **empty**
store, so it never ran; and the backfill skipped on presence rather than
freshness, so even "Parse all replays" would have skipped every stale game.

### Split out of the site, not copied from it

`client/css/match-summary.css` and `client/js/CombatTables.js` are new files,
split out of `main.css` and `Constants.js` so this app can load them without
dragging in the viewer's layout vocabulary or its canvas enums. Both are copied
into `css/vendor` and `js/vendor` by `tools/build-desktop-client.js`, alongside
`dominance.css`, which was split for exactly this reason a release ago.

## 0.8.0 — 7 Aug 2026

The report stops describing you and starts measuring you, the app learns about
other people's replays, and the stylesheet becomes a directory.

### No generated prose, anywhere

`client/js/GameReport.js` is deleted, with `tools/test-game-report.js`. It wrote
a sentence about how somebody played ("Army led it; mechanics lagged") from five
pillar scores on an invented 0-100 scale. The sentence is gone from the report
header, the OBS overlay and the post-game toast; the pillar bars and the named
mistakes are gone from the overlay with it.

Also cut from the report's fact line: the hero opener, `Tower rush` (which was
`classifyArchetype` guessing a strategy from three timings) and
`11 workers @5:00`. What is left is the result, the two races, the map and the
length.

### Three numbers against two baselines

The verdict band carries **dominance, effective APM and hero kills**, each
against your own recent games and against the other players of that race in your
history.

The second column was going to be a published race average. It was measured
first, over all 334 replays in `client/replays`, and both candidates were dead:

- **Dominance is a share of 100 between two players**, so any population average
  of it is 50 by construction. Measured 48 to 52 across all four races. A delta
  against that says "did you beat your opponent", which the result already says.
- **Effective APM belongs to the bracket, not the race.** The repo's corpus is
  professional games, medians 395 to 565. A ladder player at 74 would have been
  told they are 490 behind Orc.

Matchmaking is what fixes both, so the column is the people you actually played,
excluding yourself. `js/race-baseline-data.js` (generated by
`tools/build-race-baselines.js`) covers the cold start and is labelled as a
ladder sample wherever it is used.

### A metrics layer, and two schemas that were one

- **`client/js/GameMetrics.js`** turns a stored summary and a seat into scalars.
  "Workers at 5:00" had three implementations; it now has one.
- **Dominance is time-weighted.** The stored series is not on a fixed grid, so
  the overlay's old sample-count average over-weighted the seconds around every
  hero death. Fixed, and asserted in `tools/test-game-metrics.js`.
- **`client/js/SummaryBuild.js`** owns the stored-summary shape and
  `SCHEMA_VERSION`. It existed twice, in `store.js` and hand-copied into
  `tools/desktop-preview.js`, with the version number in only one of them.
- **A 3v3 seat was being compared against 1v1 pro medians**, rendering 102 APM as
  `−462.5`. The comparison block is 1v1 only now, like the result and the record.

**No schema change and no re-parse.** A 0.7.x store upgrades with nothing to do.

### Library

A fourth view: games you were not in. Its own list, its own filters, its own
report column, and "Open a replay…", which registers the chosen file's FOLDER as
a replay root rather than reaching past the scoped-read guard in `read_replay`.

Home and the Library mount the same renderer, `js/game-report-view.js`, extracted
from `games-view.js`. Passing `seat: null` selects its symmetric presentation: no
"you", no seat put first, and the result stated as one player beating another.
The README's identity sentence changed to admit it.

### Tags, and a casting overlay

- **Free tags per game**, in a sidecar at `<app_data>/labels.json` keyed by
  content key. Not on the summary: a re-parse rebuilds that, and a schema bump
  re-parses everything. Editable from the report, filterable in the Library.
- **`/cast` is a second overlay page**, with its own renderer and its own
  Browser Source. Event line, two players, a running series score and a format
  badge, plus a symmetric stat bar with no deltas, because every baseline this
  app has is one person's history and on a broadcast neither player is that
  person. The player overlay is untouched. Driven from Stream → Casting.
- Both are covered in `overlay.rs`'s tests: `/cast` is asserted token-gated and
  asserted self-contained.

### First run

One screen, once: replay folder, your player name, W3Champions (**checked**, with
what it sends and where to turn it off stated on the screen), and read-my-history.
Every row skippable. The checkbox writes through `set_w3c_enabled`, so `w3c.rs`
stays the authority and skipping leaves lookups genuinely off.

### The design pass

- **Build cards are race-keyed.** A header band with the race sigil, the name and
  all four timings (they used to dangle off the bottom under five wrapping rows),
  a full-perimeter race rim, and section glyphs in place of a 5rem text column.
- **Every icon is on a 36px lattice**, so both cards line up and a short row
  leaves empty cells in the same columns as the long row's icons. Hero cells get
  one track per hero rather than a permanently empty trailing column.
- **Race as material**, `[data-race]` in the token layer, on cards, feed rows,
  player titles and build-order columns. Muted, no glow, never a single edge.
- **`js/glyphs.js`** is every mark that is not a race and not game art. Section
  headings have icons now.
- **`app.css` is ten ordered sheets.** 2,567 lines in one file is most of why the
  report drifted away from the feed. Load order is the cascade and is fixed in
  `index.html`; `states.css` is last because its breakpoints override everything.

Fold audit clean at 900x600 and 1280x820, every game, every chart mode, drawer
open and closed, all four views, plus the 3v3 path.

## 0.7.4 — 6 Aug 2026

Resources stops drawing two staircases and a flat floor.

Measured first, over 80 games (`node tools/analyse-resource-series.js`): gold
lost is flat for a median **27%** of the x-axis and lumber lost for **43%** —
the entire game at worst — while the two food lines sit **9%** apart and trace
each other. Three of those stacked in a landscape window is three skinny strips
where nothing happens for the first third.

- **Trade balance replaces both loss curves.** One line: their cumulative losses
  minus yours, filled back to a zero midline, moss above and rust below. Two
  monotonic climbs cannot show who is winning the trades — that is the gap
  between them, which is the one thing a reader has to do arithmetic to get. So
  plot the difference. The headline number sits above it (`−670 · peak −1,770`).
- **Food is drawn against its cap, not beside it.** The cap is a stepped band
  behind the used line instead of a second dashed line per player. Four lines
  became two and a background. Square corners on the band, because supply
  arrives in whole buildings and a diagonal between two levels claims a moment
  that never happened.
- **Every chart mode trims its flat lead-in** and labels the axis with the
  second it really starts. Dominance eases out of an even 50/50 over the
  engine's 150s ramp; Army is cumulative production, so it is 0 until the first
  unit. Worst game in the sample trimmed **9:40** of dead axis. Everything that
  maps a pointer back to a time — the dominance scrub, all three double-click
  seeks — now goes through the drawn span rather than assuming the plot starts
  at 0:00.
- **Axes that a person would have chosen.** The balance axis was labelled
  `+1173 / +587 / −586 / −1173`, two of which are the same number rounded in
  opposite directions, and the negative signs were clipped off the left of the
  viewBox so they read as positive. Now `+2k / +1k / −1k / −2k`. The food axis
  was rounding a 100-supply game up to a 200 ceiling and drawing the whole curve
  in the bottom half; the cap is the ceiling by construction, so it is the axis.
- **Aspect authored for the box it gets.** A 1200x200 viewBox in a half-width
  column renders 70px tall — 6:1, the same skinny strip this pass exists to
  kill. 560x200 lands at 2.75:1 at the 405–594px these columns actually measure,
  and keeping the viewBox near the rendered width keeps the axis type at its
  authored size instead of scaling it to 9px.
- `ResourceCharts.js` is no longer shipped to the desktop. The mount-seam rule
  was never "mount the viewer's class whatever it draws" — it is "do not redraw
  a chart the viewer has", and a loss curve and its difference are not the same
  chart. The new plots live in `CompareCharts`, the shared factory, next to Army
  for the same reason: a derivation with no viewer class to borrow.

Render-side only: no schema change, no re-parse.

## 0.7.3 — 6 Aug 2026

Density, and an end to the wall of potions.

Measured at 1280x820. A 3v3 report went from 857px of content in a 547px body
to 545 — the whole thing above the fold. A 1v1 went from 1849 to 1208.

- **A chart mode that cannot draw gets no chip.** `DominanceSeries` refuses team
  games by construction, and the panel was still offering a greyed Dominance tab
  on every 2v2 and 3v3 — a control whose only outcome is a sentence saying there
  is no chart. Only modes with something to say get a chip now, and the head
  disappears entirely when that leaves one. A game where nothing can be drawn
  keeps all three, because that is where the explanation lives.
- **Resources draws three across instead of three down.** Stacked, the panel was
  258px and gave each series a 1200x56 box — 21:1, where every curve flattens
  into a line near the floor. Side by side it is 148px and each plot has a shape
  a curve can be read in. Below 720px wide it goes back to the viewer's stack.
- **Compact build cards lost their section labels.** HEROES and UNITS above two
  rows of art that could not be anything else, 38px a card, 228px across a 3v3.
  Compact columns are 11rem too, so six seats sit on one row rather than five
  and an orphan.
- **The build-order list runs in columns.** A row is 131px of content and it was
  being given a 610px column, so twenty of them ran 800px. 400 now, with no name
  wrapped — 13rem is measured against "Troll Headhunter/Berserker", the longest
  name the parser produces here.

- **The Bought row stacks.** Repeat purchases collapse to one icon carrying an
  ×N pip. Across the preview corpus that is 202 purchases drawn as 91 chips;
  the worst single card went from 41 icons to 7. Nothing is lost — the count
  was always the fact, and it now fits on one line.
- **Bought splits kept from spent.** Claws, orbs and boots read left of a
  hairline in purchase order; potions, scrolls and tomes read right of it by
  volume. The split comes from `js/item-classes.js`, generated out of
  `helpers/mappings.js` by `tools/build-item-classes.js` — an item the table has
  never heard of counts as kept.
- **Past ten distinct items the row folds** into a `+N` chip that expands in
  place. Nothing is dropped without being counted.
- **Mercs stack the same way.** Six batriders is one decision repeated.
- **The spacing scale is three quarters of what it was.** `--sp-*` is overridden
  for the desktop in `app.css`, not in the shared `tokens.css`: this is a fixed
  window with an absolute fold, where the web client is a page that scrolls.
  Body leading drops to 1.35 and the app bar to 48px.
- **No type or art got smaller.** `--fs-min` is still the floor and identity
  icons are still 36px. Hero portraits came down from 56 to 48, which is not a
  floor.
- The build card's section-label gutter is 5.0rem, measured rather than
  guessed: "UPGRADES" renders 73.2px, so 80px clears it by 7. It had been 5.6.

## 0.7.2 — 6 Aug 2026

The report became one screen.

- **No tabs.** Story and Build merged. The report is the verdict band, then one
  panel holding the chart, a build card per seat, and the per-player record.
  `.report-body` is the only element allowed to scroll.
- **The stat tile grid is gone.** Six bordered cells of six different kinds of
  number read as a dashboard rather than as a reading of a game. Its comparative
  half survives as rows in the verdict band: tier 2, expansion, workers and APM
  against your own rolling median.
- **The Story timeline is gone**, three days after it was built. Right answer to
  "Story doesn't tell a story", wrong thing to sit above the builds.
- **Team games get an abbreviated form.** Past two players the build cards go
  compact and the per-player record is not rendered at all.
- **Team games no longer break the frame.** The verdict band's build strips
  stacked one row per player, so a 3v3 was a 296px band beside a 103px verdict
  column. The strips are gone entirely now that the real cards are on the same
  screen.
- **Dominance refuses team games** instead of drawing nonsense. `DominanceSeries`
  splits 100 points across everyone in the game, so in a 3v3 the six shares sit
  around 16 and nobody can reach the "50 = even" line the chart is built around.
- **First-boot catch-up.** A fresh install reads its ten newest replays at
  launch, with progress chips in the quick-nav band, instead of showing an empty
  feed until you find a button in Settings.
- Fixed: `Open in WC3V Viewer` had never been flush right, because the rule
  pushing it named `.btn-primary` and the button is `.btn-viewer`.
- Fixed: heroes appeared among the units on build cards, because `t2Units` and
  `t3Units` include a hero trained inside that tier.
- Fixed: `MomentsExtract.phrase` worded the same beat two ways, "Your Tier 2"
  against "Moon: Tier 2".
- Added `tools/test-backfill-catchup.js` to the `desktop:test` suite.

## 0.7.1 — 6 Aug 2026

The report redesign.

- Four tabs became two: Story and Build. Economy and Full details deleted.
- **One chart panel with three chips** (Dominance, Resources, Army) replacing a
  chart in Story and two more on a separate tab. `js/chart-panel.js` wraps the
  existing mount panels and owns no drawing code.
- **The five-pillar grade rail was deleted**, not moved. Economy, Army, Hero,
  Map control and Mechanics as bare integers against a rolling median is not
  something an integer can convey. `GameReport` still supplies the headline and
  the benchmarks.
- The game strip was deleted with `js/game-strip.js`.
- `js/build-card.js` gained a `Bought` section and exported `heroesOf`/`keyUnits`.
- Render-side only: no schema change, no re-parse.

## 0.7.0 — 6 Aug 2026

The charts pass.

- **Schema v4** adds `dominance` and `resources` to the stored summary, packed
  by `client/js/SeriesExtract.js`. Measured cost **+1.7 KB gzipped per game**.
  Like `moments` (v2) and `combat` (v3), these are extract-at-parse-time-or-never,
  so every game stored before this build offers "Re-read this game" until it is
  re-parsed.
- The report mounts **the viewer's own chart classes** (`DominanceChart`,
  `ResourceCharts`) rather than lookalikes.
- `client/css/dominance.css` split out of `main.css`, shared by the viewer, the
  dominance lab and the desktop.

## 0.3.0 — 5 Aug 2026

- First walked upgrade: 0.2.0 → 0.3.0 installed and updated end to end.
- The window became a feed of your games.

## 0.2.0 — 5 Aug 2026

- First build published to R2 through `tools/deploy-desktop.js`, with the
  manifest and installer fetched back to confirm.
- Auto-update plumbing: signed packages, public key compiled into the binary,
  private key at `~/.tauri/wc3v-updater.key`. **Back that key up. Losing it ends
  updates for every existing install.**
