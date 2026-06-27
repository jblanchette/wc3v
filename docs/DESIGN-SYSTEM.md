# WC3V Homepage Design System

**Status:** authoritative source-of-truth for `client/proto/*`. Phase 2 implements `proto.css` and the
three prototype pages against this document. This file is the contract; page CSS may not contradict it.

> Scope: the homepage-redesign prototypes (`welcome-gate.html`, `learn.html`, `experienced.html`,
> `index.html`). It deliberately does **not** depend on the production `main.css`. Tokens stay faithful
> to the real app's palette but tighten and disambiguate it.

---

## 0. North star

A **dark esports-broadcast control room**: calm, neutral, slightly cool chrome that gets out of the way,
with the four race colors used **only as data** — the way a broadcast lower-third tints a player's name,
never the whole UI. The room is quiet so the signal (your grade, the pro build, the race you main) is
loud. Density is comfortable, not cramped; everything is readable at a glance from across a desk.
Borrowed directly from W3Champions' own redesign: keep the platform neutral, let the races be the color.

---

## 1. The core decision — race color is DATA, not chrome

**Problem:** today the chrome accent (`#4488FF`) is identical to the Human race color. Selecting a
build, focusing a button, and "this is Human" all read as the same blue. The four race colors stop
being a reliable signal because one of them is also "the app."

**Decision (non-negotiable):**

1. **The neutral UI accent shifts OFF Human blue.** Chrome accent becomes **`--accent: #5B8DEF`** — a
   slightly cooler, more periwinkle/indigo blue that is visibly distinct from the warmer Human
   `#4488FF`. Focus rings, primary buttons, links, the active segmented-control state, the band
   switcher, "selected step" markers — all use `--accent`, never `--race-H`.
2. **Race color only ever appears bound to race data.** A race color may tint: a race/hero/unit icon
   frame, a race name, a race chip, a build card's race-themed surface, a "your replay" chip keyed to
   the player's race. It may **never** be the app's primary button, focus ring, link color, or generic
   "selected" state.
3. **Race color is always redundantly encoded.** Per accessibility research (CatPAW; the red↔green pair
   is invisible to ~8% of men — and our Orc=red sits next to Elf=green), a race is *never* identified by
   color alone. Every race-colored element also carries the **race abbr** (`HU/ORC/NE/UD`) or the race
   **icon**. Color is the accelerator, text/icon is the source of truth.

This is the single rule the rest of the system protects.

---

## 2. Color tokens

All values are CSS custom properties defined in `:root` in `proto.css`. Names are stable; Phase 2 uses
these exact names.

### 2.1 Surfaces & elevation (dark, Material-style lift)

Dark UIs can't show elevation with shadow alone, so higher surfaces get **lighter**, not just shadowed
(Material dark-theme guidance). Five steps, lowest → highest:

```css
--bg-deep:   #12131f;  /* app backdrop / page gutter, recessed wells, inputs        */
--bg:        #1a1d2e;  /* default page background                                    */
--surface:   #212538;  /* card / panel base (elevation 1)                            */
--surface-2: #2a2f45;  /* raised within a card: chips, buttons, list rows (elev 2)   */
--surface-3: #323750;  /* hover / popover / active raised (elevation 3)              */
--surface-4: #3b4060;  /* drawer header, modal top bar, highest chrome (elevation 4) */
```

Rule: never skip more than one step for adjacent nested surfaces (a chip on a card is `surface-2` on
`surface`, not `surface-3`).

### 2.2 Borders & dividers

```css
--border:     rgba(255,255,255,0.10);  /* default hairline divider / card edge   */
--border-2:   rgba(255,255,255,0.18);  /* emphasized edge, button border, hover  */
--border-3:   rgba(255,255,255,0.26);  /* focus-adjacent / strong separation     */
```

Dividers are always **full-perimeter or full-line**. Single-edge accent stripes are forbidden
(see §10).

### 2.3 Text

```css
--text:       #e8eaf0;  /* primary copy, headings                  */
--text-muted: #9ca3b8;  /* secondary copy, labels, sublines        */
--text-dim:   #6b7290;  /* tertiary: metadata, counts, hints, mono */
--text-on-accent: #ffffff;  /* text on --accent / primary button   */
--text-on-gold:   #2a2107;  /* text on gold button (dark ink)      */
```

Body text on any surface ≥ `--surface` meets WCAG AA (≥ 4.5:1). `--text-dim` is for non-essential
metadata only and must not be the sole carrier of meaning.

### 2.4 Chrome accent (neutral — the app's own color)

```css
--accent:        #5B8DEF;  /* THE app accent — distinct from Human #4488FF       */
--accent-strong: #6E9CF5;  /* hover / brighter state                            */
--accent-deep:   #3F6FD0;  /* gradient bottom on primary button, pressed         */
--accent-soft:   rgba(91,141,239,0.14);  /* tinted fill (selected chip bg, wash) */
--accent-ring:   rgba(91,141,239,0.55);  /* focus outline                        */
```

### 2.5 Gold (achievement / "your build" / premium accent — sparing)

```css
--gold:        #FFD24D;
--gold-deep:   #E0A800;
--gold-ink:    #2a2107;  /* text on gold */
--gold-soft:   rgba(240,178,50,0.12);
--gold-edge:   rgba(240,178,50,0.45);
```

Gold is reserved for the single "★ YOUR BUILD / best fit" moment, the "compare to a pro" call-to-action,
and the prototype watermark banner. Do not use gold as a generic highlight.

### 2.6 Resource accents (data only — economy readouts)

```css
--lumber: #44DD88;  /* lumber count / NE-adjacent econ; NOT a generic "good" green */
--gold-res: var(--gold);  /* gold count */
```

### 2.7 Race-as-data palette

The four race colors plus a derived per-race theme set. **On dark surfaces the saturated base is used
for text/edges; fills are tinted low-opacity** (Material: saturated fills vibrate on dark). Set
`data-race="H|O|E|U"` on a container to resolve the `--race-*` group.

```css
--race-H: #4488FF;  /* Human  — kept exactly as the in-game blue (now != chrome)   */
--race-O: #FF4444;  /* Orc                                                          */
--race-E: #44DD88;  /* Night Elf                                                    */
--race-U: #AA66FF;  /* Undead                                                       */
```

Per-race resolved group (one block per race, selected via `[data-race]`):

```css
[data-race="H"]{ --race:#4488FF; --race-ink:#A8C8FF; --race-bg:#1e2848; --race-head:#283c6a;
                 --race-bd:#3860b0; --race-bd-hi:#5888dd; --race-glow:rgba(80,130,220,0.22);
                 --race-soft:rgba(68,136,255,0.14); }
[data-race="O"]{ --race:#FF4444; --race-ink:#FF9A8A; --race-bg:#2c1e18; --race-head:#5a2820;
                 --race-bd:#904030; --race-bd-hi:#bb5540; --race-glow:rgba(200,80,40,0.22);
                 --race-soft:rgba(255,68,68,0.14); }
[data-race="E"]{ --race:#44DD88; --race-ink:#8DEEB6; --race-bg:#162820; --race-head:#1e4830;
                 --race-bd:#286848; --race-bd-hi:#389068; --race-glow:rgba(60,200,140,0.22);
                 --race-soft:rgba(68,221,136,0.14); }
[data-race="U"]{ --race:#AA66FF; --race-ink:#CDA6FF; --race-bg:#221a38; --race-head:#382858;
                 --race-bd:#583880; --race-bd-hi:#7848a8; --race-glow:rgba(160,80,240,0.22);
                 --race-soft:rgba(170,102,255,0.14); }
```

- `--race` — the saturated brand value. Use for **race name text, icon-frame border, the race chip
  outline/text**. Because it can be low-contrast as body text, use `--race-ink` (lightened) when the
  race color must sit as readable text on a dark surface.
- `--race-bg` / `--race-head` — the card body / card header tints for race-themed cards.
- `--race-bd` / `--race-bd-hi` — card and icon-frame borders (base / hover-selected).
- `--race-glow` — the hover box-shadow color.
- `--race-soft` — low-opacity fill for a race chip background.

### 2.8 Grade scale (A→F, redundant: letter + color)

Grades always show the **letter** (the source of truth) tinted by color. Adjacent grades stay
distinguishable and avoid a pure red↔green collision by routing through amber/orange.

```css
--grade-a: #6EE7A8;  /* A — green   */
--grade-b: #8FD0FF;  /* B — blue    (NOT race-H blue; lighter/cyan-leaning) */
--grade-c: #F0C674;  /* C — amber   */
--grade-d: #F0A86A;  /* D — orange  */
--grade-f: #F08A8A;  /* F — red     */
--grade-none: #9ca3b8;  /* ungraded / pending */
```

Grade badge fill is the color at low alpha, border at mid alpha, letter at full color (see §6.7). The
`gradeColor()` helper in `proto-data.js` already returns these hues — keep them in lockstep.

### 2.9 Tier scale (T1/T2/T3 — matches the real app)

```css
--tier-1: #FFFFFF;  /* T1 white  */
--tier-2: #21A5E3;  /* T2 cyan   */
--tier-3: #FFFF33;  /* T3 yellow */
```

Tier markers always carry the `T1/T2/T3` label in mono — color is secondary.

### 2.10 Semantic states (outcome / validity — NOT race, NOT grade)

```css
--ok:    #6EE7A8;  --ok-soft:   rgba(60,200,140,0.12);  --ok-edge:   rgba(80,200,140,0.40);
--warn:  #F0C674;  --warn-soft: rgba(240,178,50,0.12);  --warn-edge: rgba(240,178,50,0.40);
--bad:   #F08A8A;  --bad-soft:  rgba(220,80,80,0.12);    --bad-edge:  rgba(220,80,80,0.40);
--info:  var(--accent);
--privacy: #7FE0A8;  /* the browser-only / no-upload trust badge */
```

Difficulty maps onto states: easy → `--ok`, medium → `--warn`, hard → `--bad` — but always with the
word ("Easy/Medium/Hard"), never color alone.

> **Collision note:** `--ok` (win/good) and `--race-E` (Night Elf) are both green; `--bad` (loss) and
> `--race-O` (Orc) are both red. This is acceptable **only** because both channels are always labeled
> (WIN/LOSS text; race abbr). Never place an unlabeled green/red dot and expect it to read as
> "good vs. Elf" or "loss vs. Orc."

---

## 3. Typography

Floor is **0.8rem (12.8px)** — nothing smaller, ever (house rule). Base is 16px.

```css
--font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
--mono: 'Consolas', 'Cascadia Mono', monospace;
```

### Type scale (rem)

| Token            | Size      | px    | Use                                                        |
|------------------|-----------|-------|------------------------------------------------------------|
| `--fs-display`   | 2.1rem    | 33.6  | Gate logo / hero number                                    |
| `--fs-h1`        | 1.8rem    | 28.8  | Page lead headline                                         |
| `--fs-h2`        | 1.4rem    | 22.4  | Section / card-title / "best fit" title                    |
| `--fs-h3`        | 1.15rem   | 18.4  | Drawer title, step title                                   |
| `--fs-lg`        | 1.05rem   | 16.8  | Emphasized body, large button                              |
| `--fs-base`      | 1.0rem    | 16    | Body                                                       |
| `--fs-sm`        | 0.92rem   | 14.7  | Secondary body, card body copy                             |
| `--fs-label`     | 0.85rem   | 13.6  | Chips, buttons-small, meta labels                          |
| `--fs-min`       | 0.8rem    | 12.8  | **HARD FLOOR** — abbrs, counts, eyebrow labels, mono tags  |

- Weights: 400 body, 600 emphasis/labels, 700 sub-headings, 800 headings/titles, 900 the gate display
  number and grade letters only.
- Eyebrow / section-kicker labels: `--fs-min`, weight 700, `letter-spacing: 0.06em`, `text-transform:
  uppercase`, color `--text-dim`.
- Mono (`--mono`) is for: race abbr, tier tags, scores (`86/100`), the privacy badge, and code-ish
  metadata. Never for running prose.
- Line-height: 1.5 body, 1.25 dense rows/chips, 1.2 headings.

**No ellipsis truncation** (house rule). Titles, names, and metadata wrap (`overflow-wrap: anywhere`)
or are dropped — never `text-overflow: ellipsis`.

---

## 4. Spacing, radius, sizing

### 4.1 Spacing scale (4px base)

```css
--sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px; --sp-4: 16px;
--sp-5: 22px; --sp-6: 30px; --sp-7: 40px; --sp-8: 56px;
```

Card padding `--sp-4`→`--sp-5`; grid gaps `--sp-4`; section rhythm `--sp-6`→`--sp-7`; inline chip gap
`--sp-2`. Page gutter `26px` via `.wrap` (`max-width: 1180px`).

### 4.2 Radius

```css
--radius-sm: 6px;   /* icon tiles, small inner wells          */
--radius:    8px;   /* buttons, chips-as-buttons, inputs       */
--radius-lg: 14px;  /* cards, panels                           */
--radius-xl: 22px;  /* gate splash cards, pill containers      */
--radius-pill: 999px;
```

### 4.3 Minimum interactive / icon sizes (house rule: ≥ 36px on desktop)

```css
--ico-sm:  36px;  /* HARD FLOOR for any meaningful icon/portrait */
--ico-md:  44px;  /* build-card hero, unit-card icon              */
--ico-lg:  56px;  /* hero pick portrait                           */
--ico-xl:  64px;  /* race-card / gate icon                        */
--hit-min: 44px;  /* min touch target for primary controls       */
```

Decorative inline glyphs (a `+` between unit icons, a dot) are exempt; anything a user reads or clicks
is not.

---

## 5. Elevation, shadow, motion

### 5.1 Shadow

```css
--shadow-1: 0 4px 14px rgba(0,0,0,0.30);  /* button / chip lift            */
--shadow-2: 0 8px 26px rgba(0,0,0,0.40);  /* card hover                    */
--shadow-3: 0 10px 40px rgba(0,0,0,0.45); /* drawer / modal / gate card    */
--shadow-drawer: -12px 0 40px rgba(0,0,0,0.50);
```

Elevation is communicated **first** by surface step (§2.1), shadow is the secondary cue. A race card's
hover glow uses `--race-glow` *in addition to* `--shadow-2`.

### 5.2 Motion

```css
--dur-fast: 0.12s;  /* hovers, selection toggles  */
--dur:      0.18s;  /* drawer/popover open, fades */
--ease:     cubic-bezier(0.2, 0.6, 0.2, 1);
```

- Hover lift: `transform: translateY(-2px|-3px|-4px)` (chip / card / gate-card).
- Press: `transform: translateY(1px)`.
- All transitions must collapse under `prefers-reduced-motion: reduce` (already enforced globally).

---

## 6. Component specs

Every component below is defined once in `proto.css`. Page-level CSS may **only** position/lay out
these components, not re-skin them (§10).

### 6.1 Buttons (`.btn` + variants)

- Base `.btn`: `--surface-2` fill, `--border-2` edge, `--text`, `--fs-label`→`--fs-sm`, weight 600,
  `--radius`, padding `12px 22px`, `--hit-min` min-height. Hover → `--surface-3`. Press → `translateY(1px)`.
- `.btn-primary`: gradient `--accent-strong`→`--accent-deep`, border `--accent`, `--text-on-accent`,
  `--shadow-1`. **This is the only place the accent gradient appears as a fill.**
- `.btn-gold`: gradient `--gold`→`--gold-deep`, `--gold-ink`. Reserved for the marquee CTA (Build
  Finder "Show me my build", "Compare to a pro").
- `.btn-ghost`: transparent fill, `--border-2` edge, `--text-muted`; hover fills `--surface`.
- `.btn-lg`: padding `15px 30px`, `--fs-lg`.
- `[disabled]`: `opacity: .45; cursor: not-allowed`.
- Buttons never take a race color. (A "Watch pro" button inside a race-themed drawer is still
  `--accent`/ghost — the race identity is carried by the drawer header, not the button.)

### 6.2 Segmented control (`.seg`) — band switcher

- Track `--bg-deep`, `--border`, pill radius, 3px inner padding.
- Buttons: transparent, `--text-muted`, `--fs-label`, weight 600. Active (`.on`) → `--accent` fill,
  `--text-on-accent`. `aria-pressed` mirrors `.on`.
- Each button may carry a small (20px is allowed here as a decorative leading glyph paired with a text
  label — the label is the source of truth).

### 6.3 Chips / pills (`.pill`, `.chip`)

Two families:

- **`.pill`** — static label (difficulty, army, matchup, race tag). Radius pill, `--fs-min`→`--fs-label`,
  weight 600, `--surface-2` bg, `--text-muted`, `--border`. Variants:
  - `.pill-race` — `--race-soft` bg, `--race-ink` text, `--race` 40%-alpha border. **Always contains the
    race name or abbr as text.**
  - `.pill-good` / `.pill-warn` / `.pill-bad` — `--ok/--warn/--bad` family, used for fit/diff markers
    ("✓ all 3 units", "~ 2/3 units"). The glyph (✓/~/✕) is redundant with the color.
  - `.pill-dim` — `--text-dim`, for de-emphasized matchup codes.
- **`.chip`** — *interactive* filter (race filter, opener/army filters). Button semantics,
  `--surface` bg, `--border`, `--text-muted`; hover → `--border-2`/`--text`. Active (`.on`) uses the
  **race color of that chip** as a tinted fill (`color-mix(--race 22%)`) with white text — this is a
  legitimate race-as-data use (the chip *is* the race). `aria-pressed` required.

### 6.4 Cards

- **Build card (`.card`)** — race-themed. Body `--race-bg`, header `--race-head`, `--race-bd` edge,
  `--radius-lg`, full-perimeter border (no single-edge stripe). Header carries the hero icon-frame, the
  build title (`--fs-h2`-ish 1.02rem/800), and the race abbr + matchup in `--race`/mono. Hover on the
  header lightens via `color-mix(--race-head, --race-bd-hi)`. The race theme is the *only* place a race
  color washes a surface, and it is always bound to a card whose content is that race.
- **Neutral card (`.p-card`, close-match `.close-card`)** — `--surface`, `--border-2`, `--radius-lg`.
  Hover border → `--accent` (chrome), lift `--shadow-2`. No race wash.
- **Gate splash card (`.gate-card`)** — `--radius-xl`, gradient `--surface`→`#1b1f31`, `--border-2`.
  The two paths ("new" / "experienced") use `--accent` and `--race-U`-derived edges respectively as
  *wayfinding* accents (not race data) — acceptable because they are decorative path identity, kept to
  the inner glow + the "go" link, never a single hard edge stripe.

### 6.5 Icon frame (`.ico-frame`, `.ico`) — the canonical race-data carrier

- `.ico` — raw tile: `--radius-sm`, `--border`, `--bg-deep` fill, `object-fit: cover`.
- `.ico-frame` — bordered portrait: 2px border in `--race-bd` (resolves neutral `--border-2` when no
  `data-race`), `--radius-sm`→7px, `--bg-deep` backing. **This is the primary, approved way race color
  attaches to an icon.** Minimum render size `--ico-sm` (36px).
- All icons load `/assets/wc3icons/<id>.jpg` and must carry `onerror` graceful hide (never a broken-image
  box). Decorative icons get empty `alt=""`; meaningful ones get real alt text.

### 6.6 Drawer (`.drawer`, `.drawer-back`)

- Right-side sheet, `width: min(470px, 96vw)`, `--bg` fill, `--border-2` left edge, `--shadow-drawer`.
- `role="dialog" aria-modal="true"`; Escape closes; backdrop `rgba(8,10,18,0.6)` click-closes.
- `.drawer-top` is elevation `--surface-4`-adjacent with a `--border` bottom divider; carries the race
  theme via `data-race` (header icon-frame + race name). `.drawer-foot` actions are chrome buttons.
- Body sections use the eyebrow label style (`.dsec`).

### 6.7 Badges

- **Grade badge (`.grade-badge`)** — square, `--radius`→14px depending on size; the **letter** in weight
  900 colored by `--grade-*`; fill = grade color at ~13% alpha; border = grade color at ~40% alpha.
  Sizes: chip-inline 34px, drawer-overview 62px. The letter is mandatory; color is the accelerator.
- **Result badge** — inline `WIN` (`--ok`) / `LOSS` (`--bad`) text, weight 700. Text is the truth; color
  is redundant.
- **"Added by you" / count badges** — gold mono micro-label (`--gold`, `--fs-min`) — sparing.

### 6.8 Steps (Build Finder) (`.step`, `.step-num`)

- `.step-num`: 30px circle, `--surface-2`/`--border-2`, weight 800. Completed (`.done`) → `--accent`
  fill (chrome, not race), white text.
- Step titles `--fs-h3`/800; hints `--fs-sm`/`--text-dim`.

### 6.9 Tech-path tier rows (`.tier-row`, `.bd-tier`)

- Tag column: mono, weight 800, `--fs-label`, colored by `--tier-*`, fixed width.
- Text column: `--fs-sm`/`--text`. A vertical connector uses `--border-2` (a *structural* line down the
  middle of the list, not a single-edge accent stripe on a card).

### 6.10 Replay rows (`.rep`, `.brep`, `.mchip`)

- Row: `--border` top divider, `--fs-label` "vs" line + `--fs-min` meta line in `--text-dim`.
- Play button: `--ico-sm`-ish 30–32px square, `--surface-2`/`--border`, hover border `--accent`.
- `.mchip` (your-replay chip): race-themed pill (`--race-bg`/`--race-bd`), carries the player's hero
  icon-frame + the grade badge (or the gold "compare" CTA glyph). Race theme here = the *player's* race
  = legitimate data binding.

---

## 7. The "compare to a pro" report (drawer body)

- 9 category cards in a 2-col grid (`.cats`), each: icon glyph + category label (`--fs-label`/700) +
  grade badge (right) + finding line (`--fs-sm`/`--text-muted`, wraps).
- The you-vs-pro header uses two `.slot`s with a neutral `VS`. **No comparison pill-column** (house
  rule): do not add a third column of "you · 6s sooner" pills. Deltas, when shown, color the winning
  value and append a tiny inline delta — they never get their own column.

---

## 8. Layout & responsive

- `.wrap`: `max-width: 1180px`, centered, `26px` gutter.
- Grids use `repeat(auto-fill, minmax(N, 1fr))`; every grid child gets `min-width: 0` to prevent blowout.
- Breakpoints: 860px (race grid 4→2), 820px (best-fit body 2→1), 760px (topbar wraps), 520px (race grid
  2→1), 440px (category grid 2→1).
- Topbar is `position: sticky; top: 0; z-index: 40`. Drawer/backdrop `z-index: 60/61`.

---

## 9. Accessibility (enforced)

1. Focus-visible ring: `2px solid --accent`, `2px` offset, on every interactive element. Already global.
2. Min font `--fs-min` (0.8rem); min meaningful icon/target `--ico-sm` (36px) / `--hit-min` (44px).
3. Color is never the sole signal — race (abbr/icon), grade (letter), result (WIN/LOSS), difficulty
   (word) all carry text.
4. Body text ≥ 4.5:1 on its surface; `--text-dim` only for non-essential meta.
5. `aria-pressed` on toggles (chips, seg, step picks); `role="dialog"`/`aria-modal` on the drawer;
   `aria-label` on icon-only controls (close ×, play ▶).
6. `prefers-reduced-motion: reduce` zeroes transitions/animations.
7. Broken icons hide gracefully (`onerror`), never leaving a meaning-bearing gap.

---

## 10. Enforcement — forbidden in page-level `<style>` blocks

Page CSS lays out and composes; it does not re-skin the system. The following are **violations**:

- ❌ Hard-coded hex colors that duplicate a token (`#4488FF`, `#212538`, `rgba(255,255,255,0.1)`…).
  Use the variable. The only literal-color exception is the tiny `.chip-{h,o,e,u}.on { --c: … }` race
  map, which *is* the race-data binding.
- ❌ Using `--accent` (or its hex) to mean "Human", or any `--race-H` value as a generic UI accent.
  Chrome and Human must stay visibly different.
- ❌ Identifying a race/grade/result/difficulty by **color alone** (no text/icon).
- ❌ **Single-edge color stripes** of any width on any edge (no `border-left: 3px solid var(--race)`
  accents). Borders are full-perimeter; structural list connectors are centered, not edge-hugging.
- ❌ **Ellipsis truncation** (`text-overflow: ellipsis`, `-webkit-line-clamp` that hides meaning).
  Wrap or omit.
- ❌ **Comparison pill-columns** (a dedicated column of "you · Xs sooner" chips). Color the winning value
  + tiny inline delta instead.
- ❌ Fonts below `0.8rem` or meaningful icons/targets below `36px`.
- ❌ Re-declaring component look (buttons, chips, cards, drawers, badges) in page CSS. Extend via a
  modifier class added in `proto.css`, not a parallel definition.
- ❌ Gold used as a generic highlight (reserve it: best-fit, compare CTA, proto banner).
- ❌ `setTimeout`-driven animation of game-ish state (not relevant here, but keep motion declarative/CSS).

---

## 11. What changes vs. the current `proto.css`

| Area              | Now                                  | New                                                            |
|-------------------|--------------------------------------|---------------------------------------------------------------|
| Chrome accent     | `#4488FF` (== Human)                 | `--accent: #5B8DEF` (distinct cool blue)                      |
| Race-H            | conflated with accent                | `--race-H: #4488FF`, **data-only**, never chrome             |
| Surfaces          | 3 steps                              | 5 steps (`--bg-deep`…`--surface-4`) for real dark elevation  |
| Race text         | raw `--race` (sometimes low-contrast)| add `--race-ink` lightened variant for readable race text     |
| Grades            | inline literals in JS                | tokenized `--grade-a…f`; B-blue shifted off Human blue        |
| States            | ad-hoc `#6ee7a8` etc. in pages       | tokenized `--ok/--warn/--bad` (+ soft/edge)                   |
| Type/space        | implicit                             | explicit `--fs-*` / `--sp-*` scales with the 0.8rem floor     |
| Motion            | scattered durations                  | `--dur*` / `--ease` tokens                                    |
| Enforcement       | none                                 | §10 forbidden-list, page CSS = layout only                    |

Phase 2: implement these tokens in `proto.css`, migrate the three pages to reference them, and remove
duplicated literals from each page's `<style>` block.
```

---

## 12. Build Order — the one canonical look (sacred)

**Mandate:** *anywhere* the proto renders a build order, tech path, build steps, or tier composition,
it renders it **the way the viewer does** — same anatomy, same tokens, same signatures. The viewer's
`BuildOrderRenderer` + the `--bo-*` palette in `main.css` are the source of truth; this section ports
them into the proto so the two never drift. There is exactly **one** Build Order look on the whole site.

### 12.0 What the viewer's BO looks and feels like (study notes)

A per-player **column** on a near-black navy background. Down the column runs a stream of compact
**action rows**, oldest at top. Each row is a tiny unit/building icon with its **gold/lumber cost
printed in a strip welded under the icon**, an action label ("Build Altar of Storms", "Train Grunt",
"2× Peon"), and — when supply changed — a right-aligned mono **SUPPLY pill** ("5/11", upkeep-tinted).
Worker rows carry a small **GOLD** (amber) or **LUMBER** (green) tag. Supply buildings finishing show a
teal **"+10 supply"** badge. Heroes are not rows — they are **highlighted cards** with a player-color
portrait ring, a "Lv 1"/"TAVERN" badge, and a strip of **skill-ability icons** (each with a level
number; learned = white ring, just-leveled = gold ring, untrained = dimmed). Tier transitions render a
**"TIER 2 COMPLETE 4:33"** divider, immediately followed by a **TIER 2 SUMMARY** block — labelled rows
of HEROES (round portrait + Lv), ARMY (square unit icon + ×N), and UPGRADES (icon + level badge,
red=attack / blue=defense / purple=ability). Upgrades and research are full-width **gradient bars**
(attack red, defense blue, ability purple) with a category badge. Above the column sits the compact
**summary card** (heroes with 1st/2nd ordinals + skill builds, key units, ✔/✘ Expo marker, ATK/DEF/RES
upgrade rows). It is dense but calm — a broadcast lower-third for an economy, read top-to-bottom.

### 12.1 `--bo-*` token sub-palette (add to `proto.css :root`)

Mirrors the viewer's `--bo-*` block verbatim where it exists, and reconciles with the proto's own
tokens. **The BO surface is intentionally its own near-black navy** — darker than `--bg-deep` — so a BO
panel reads as "a viewer instrument embedded in the page," exactly as in the app. Add as a labelled
group so it's obvious these are the viewer-faithful values:

```css
/* ── Build Order palette (faithful to the viewer's main.css --bo-*) ── */
--bo-bg:          #0F1923;  /* BO panel backdrop — deliberately darker than --bg-deep        */
--bo-card-bg:     #1A2332;  /* hero card / summary card / upgrade-bar base                   */
--bo-row-hover:   #1C2836;  /* action-row hover                                              */
--bo-header-bg:   #141D29;  /* column header / sticky ACTION·SUPPLY bar                       */
--bo-border:      rgba(48,54,61,0.4);  /* row divider (hairline, full-width — never an edge stripe) */
--bo-border-solid:#21262D;  /* icon tile border                                             */
--bo-supply-bg:   rgba(0,0,0,0.55);    /* supply pill / cost-strip fill                       */

--bo-gold:        #FFD700;  /* gold cost / "GOLD" worker tag  (data only)                   */
--bo-lumber:      #44DD88;  /* lumber cost / "LUMBER" worker tag (data only; == --lumber)    */
--bo-food:        #58A6FF;  /* food / supply-building accent                                 */
--bo-tavern:      #9B6DFF;  /* shop / tavern frame                                          */
--bo-accent:      #F0B232;  /* hero/level highlight, group-count, parchment-gold BO accent   */

--bo-text:        #C9D1D9;  /* BO body text                                                 */
--bo-text-muted:  #8B949E;  /* BO secondary                                                 */
--bo-text-dim:    #6E7681;  /* BO labels / counts                                           */

--bo-tier1:       #FFFFFF;  /* T1 white  (== --tier-1)                                       */
--bo-tier2:       #21A5E3;  /* T2 cyan   (== --tier-2)                                       */
--bo-tier3:       #FFFF33;  /* T3 yellow (== --tier-3)                                       */

/* completion / upkeep semantics (kept inside the BO so they match the app exactly) */
--bo-supply-ok:   #E8F0FF;  /* upkeep none (≤50 food)   */
--bo-supply-low:  #FF8C00;  /* low upkeep  (51–80)      */
--bo-supply-high: #FF4444;  /* high upkeep (>80)        */
--bo-complete:    #4ECDC4;  /* "+N supply" / building-complete teal */

--bo-mono:        var(--mono);  /* costs, supply, counts — same mono as the rest of the proto */
```

Reconciliation notes for Phase 2:
- `--bo-lumber` **==** `--lumber` and `--bo-tier1/2/3` **==** `--tier-1/2/3`. Keep them as separate
  named aliases (don't collapse) so the BO block stays a self-contained, viewer-faithful unit, but they
  must resolve to the same hex — if one drifts, fix it.
- `--bo-mono` aliases `--mono` (the proto already standardizes on `'Consolas','Cascadia Mono'`).
- The BO's resource amber `--bo-gold #FFD700` is the **in-game gold** color and is brighter than the
  achievement `--gold #FFD24D`. They are different on purpose (one is a cost readout, one is a UI
  flourish). Do not unify them.

### 12.2 Component anatomy (class names the proto uses)

All BO components are **`bo-`-prefixed**, defined once in `proto.css` §"Build Order", and reused
everywhere. Sizes respect the house floors *except the dense action-row mini-icons*, which are a
**documented dense-data exception** (see 12.2.1). Never below 0.8rem text elsewhere.

#### 12.2.1 BO action row — `.bo-row`
The atom. `display:grid; grid-template-columns: 1fr 44px;` (label flexes, supply pill fixed), `min-height
28–32px`, hairline `--bo-border` bottom divider, hover `--bo-row-hover`.
- **Icon + cost overlay** — `.bo-icon-wrap` (32px wide column): a `.bo-row-icon` (**28×28**, `--radius-sm`,
  2px `--bo-border-solid` frame) with a `.bo-icon-cost` strip **welded to its bottom edge** (flattened
  bottom corners on the icon, `--bo-supply-bg` fill, `--bo-mono` 9px). Gold number `--bo-gold`, a dim
  `/` separator, lumber number `--bo-lumber`.
  > **Dense-data exception (logged):** the viewer's BO icon is 28px and its cost strip is 9px — both
  > below the 36px / 0.8rem floors. This is an *intentional* exception for the dense economic readout
  > (it mirrors the in-game command-card density and is what users expect from the viewer). It is the
  > **only** sanctioned sub-floor element; it never applies to interactive controls or to any other
  > surface. Keep contrast high (white/amber/green on near-black) so it stays readable.
- **Label** — `.bo-row-desc > .bo-row-text`: `--bo-text`, 13px, verb + name ("Build …", "Train …",
  "2× Peon"). A leading **group-count** `.bo-unit-count` ("2×") is `--bo-accent`, weight 800. First
  appearance of a unit may append small 18px attack/armor `.bo-row-type-icon`s.
- **Supply pill** — `.bo-row-supply` (right cell): stacked mono, `--bo-supply-bg` fill, 1px hairline,
  `--radius-sm`. `.bo-supply-nums` = used `/` cap. Upkeep tint via `.bo-upkeep-none|low|high`
  (`--bo-supply-ok|low|high`), optional `.bo-supply-upkeep` "low"/"high" sublabel. Only render when
  supply changed.

#### 12.2.2 Worker / resource tag — `.bo-assign-tag`
Inline pill on a worker row. `.tag-gold` (amber, `--bo-gold`), `.tag-lumber` (green, `--bo-lumber`),
`.tag-build` (blue, `--bo-food`). 10px, weight 800, uppercase, low-alpha fill + matching hairline.
Carries the word ("GOLD"/"LUMBER"/"BUILD") — color is the accelerator, text is the truth.
> The viewer additionally puts a 3px colored `border-left` on worker rows. In the **proto this is a
> forbidden single-edge stripe (§10)** — do **not** port it. The tag pill alone carries the meaning.

#### 12.2.3 Completion badge — `.bo-supply-badge`
Teal ( `--bo-complete` ) inline pill, "+N supply", on a supply-building-complete row
(`.bo-row.supply-complete-row`, low-alpha teal background). Hero-training-complete uses the same
shape in `--bo-accent`.

#### 12.2.4 Hero row card — `.bo-hero-card` (training) / `.bo-hero-level-card` (level-up)
A **highlighted card**, not a row. `--bo-card-bg`, `--radius-sm`, `min-height 42–56px`. Ownership is a
**player-color portrait ring** (`.bo-hero-portrait` 46px round-rect / `.bo-level-portrait` 34px circle)
— *not* a stripe. A `.bo-hero-badge` shows **"Lv N"** (player-color fill) or **"TAVERN"** (`--bo-tavern`).
Then the **skill strip** `.bo-skill` × up to 4:
- `.bo-skill-icon` 22px (28px in the larger training card), `--radius-sm`.
- `.bo-skill-level` — overlaid bottom-right level number (mono, dark chip).
- States: `.learned` → white ring; `.active` (just leveled) → `--bo-accent` gold ring + gold number;
  `.dimmed` → 0.55 opacity, untrained.

#### 12.2.5 Tier-complete divider — `.bo-tier-complete-card`
Full-width divider: tier icon + **"TIER N COMPLETE"** label + right-aligned `--bo-mono` timestamp.
Tinted per tier (`.tier-2` cyan-leaning, `.tier-3` yellow-leaning header band). Immediately wraps the
tier summary (12.2.6).

#### 12.2.6 Tier summary block — `.bo-army-summary`
A labelled composition card (`--bo-card-bg`, `--bo-border`, `max-width ~380px`). Optional
`.bo-summary-header` ("TIER 2 SUMMARY" / "FINAL COMPOSITION"). Then `.bo-summary-section`s, each a
`68px 1fr` grid of `.bo-summary-label` + `.bo-summary-items`:
- **HEROES** — `.bo-summary-hero`: round `.bo-summary-icon.hero` (gold ring) + `.bo-summary-hero-label`
  ("Lv5" / "Training…").
- **ARMY** — `.bo-summary-unit`: square `.bo-summary-icon` + `.bo-army-count` ("×6").
- **UPGRADES** — `.bo-summary-upgrade.atk|def|ability`: icon + `.bo-upgrade-badge` level
  (atk red `#f08080`, def blue `#7ab8f5`, ability shows its name).

#### 12.2.7 Upgrade / research bar — `.bo-research-bar`
Full-width gradient bar (`min-height 32px`): `.bo-attack-upgrade` (red gradient), `.bo-defense-upgrade`
(blue), `.bo-ability-research` (purple). Icon-with-cost + a category badge (`.bo-research-badge.atk|def`
"ATK 2"/"DEF 1", or `.bo-research-label` "RESEARCH") + name.
> The viewer draws these with a 4px colored `border-left`. In the proto, render the category instead via
> the **gradient fill + the badge** (both already present) — **no left stripe** (§10).

#### 12.2.8 Build summary card — `.bo-summary-card` (the compact pro card)
The homepage `buildCard()` look, ported faithfully. Header (build name + matchup pills, race-watermark)
over BO-toned sections divided by hairlines:
- **Heroes** — `.bo-sc-hero`: portrait (43–44px) with a **1st/2nd/3rd ordinal** badge
  (`.bo-sc-hero-ord`) + a 2-col grid `.bo-sc-skills` of `.bo-skill`-style icons (level badge; ult gets a
  bronze ring `.bo-skill-ult`; untaken dimmed). Uses the **same skill-icon component** as 12.2.4.
- **Units** — `.bo-sc-key-unit`: enlarged key-unit portraits (≥36px) + short label.
- **Expo marker** — `.bo-expo-marker.expanded` ("✔ Expo", `--ok`) / `.no-expo` ("✘ No Expo", `--text-dim`).
- **Upgrades** — `.bo-sc-upgrade.atk|def|res`: icon + level, red/blue/purple, mirroring 12.2.6.
- **Matchup pills** — `.bo-sc-matchup` tinted by **opponent** race color (`--opp-color` from
  `raceColor(opp)`), always "vs {ABBR}" text (race-as-data, §1).

### 12.3 Where each proto BO surface maps onto these

One look, three surfaces — none invents its own rows:
- **Pro build cards** (homepage `index.html` grid) → the **Build summary card** (12.2.8). Heroes +
  skill builds, key units, Expo marker, ATK/DEF/RES rows, opponent-tinted matchup pills.
- **Build Finder "best fit" / partial-fit alternatives** (`learn.html`) → the **Build summary card**
  (12.2.8) for the matched build, and the **tier summary block** (12.2.6) / **tier-complete dividers**
  (12.2.5) for its tech path. The fit markers stay the §6.3 `.pill-good/warn` family; the *build content*
  is BO components.
- **Build-detail drawer** (any page) → the full vertical **action-row stream** (12.2.1) with worker
  tags (12.2.2), completion badges (12.2.3), **hero cards** (12.2.4), **upgrade/research bars** (12.2.7),
  and **tier-complete dividers + summaries** (12.2.5/6) — i.e. a faithful single-column viewer BO.
- The **experienced "compare to a pro"** report (§7) is unchanged, but any build-step / tech-path it
  shows uses these BO components, not ad-hoc rows.

### 12.4 Enforcement

Added to the §10 forbidden-list (and binding):
- ❌ Rendering any tech path, build step, tier composition, hero skill build, or upgrade list with
  **ad-hoc rows/markup**. Use the `.bo-*` components in 12.2. One BO look everywhere.
- ❌ Porting the viewer's BO **single-edge stripes** (worker `border-left`, upgrade-bar `border-left`,
  tier-section accents). The proto expresses the same meaning with tag pills, gradient fills, and badges
  (§10 still applies inside the BO).
- ✅ The 28px action-row icon + 9px cost strip is the **one** sanctioned sub-floor element (12.2.1);
  nothing else may go below the floors.
- ✅ Resource colors (`--bo-gold`, `--bo-lumber`) and tier colors are **data**, always paired with text
  (the cost number, the "GOLD/LUMBER" word, the "T1/T2/T3" label) — never a bare colored dot.
