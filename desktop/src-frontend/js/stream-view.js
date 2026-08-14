// Stream screen: getting WC3V onto a broadcast.
//
// A loopback HTTP server serves the overlay (127.0.0.1 only, token on every
// route, GET only), because an OBS Browser Source is a separate Chromium
// process and cannot see this window's state any other way.
//
// Three rules this screen exists to satisfy:
//
//   1. The first thing on it is how to get it into OBS. Everything else on
//      this screen is a preference; that is the step without which none of it
//      is on anyone's stream.
//   2. Nobody configures an overlay blind. The preview here renders from the
//      same overlay.css and overlay-render.js the Browser Source loads, so
//      what is on this screen is what goes on stream.
//   3. The overlay URL carries the access token, so it goes to the clipboard
//      and never to the DOM or the log. This window may be on camera.
//
// Two overlays ship, and they are set up separately: your own stream, and a
// caster's scoreboard for a match between two other people. They are a MODE
// switch rather than two panels down one column, because nobody is doing both
// at once and the scoreboard used to sit below the fold of a scroller with its
// own copy button below that.

(function () {
  'use strict';

  const el = (id) => document.getElementById(id);

  // Every panel is also a source in its own right. Streamers compose two or
  // three small sources they can place independently far more often than they
  // use one tall card, so each carries its own URL and suggested size. The
  // size is the part nobody can guess from the UI.
  //
  // `scout` is the live match card. The key stays as it was when the panel was
  // only a pre-game scouting report: shell.html drops module names it does not
  // recognise, so renaming it would silently blank the panel in every OBS
  // source already pointed at this app. Same rule keeps `report`.
  const MODULES = [
    { key: 'scout', label: 'Live match', size: '380 × 260' },
    { key: 'session', label: 'Session score', size: '300 × 130' },
    { key: 'verdict', label: 'Last game', size: '460 × 150' },
    { key: 'report', label: 'This game', size: '380 × 170' },
    { key: 'momentum', label: 'The game', size: '380 × 190' },
    { key: 'h2h', label: 'Head to head', size: '360 × 80' },
    { key: 'moments', label: 'Key moments', size: '440 × 170' },
    { key: 'build', label: 'Build order', size: '360 × 400' }
  ];

  // What the card is, as three choices instead of eight checkboxes. Full and
  // Slim are the two shapes people actually want, and Custom is where the
  // per-panel list lives for anyone who wants to compose their own.
  const LAYOUTS = [
    { key: 'full', label: 'Full' },
    { key: 'strip', label: 'Slim' },
    { key: 'custom', label: 'Custom' }
  ];

  // The slim strip: what is still true between games. Same two modules the full
  // card collapses to when a reveal hold expires.
  const STRIP_MODULES = ['scout', 'session'];

  // The card's three states over a night, in the order they happen. Derived
  // here rather than published: the stepper is a control on this screen, it
  // touches no payload, it only subtracts from the state that is already there.
  const PREVIEW_STATES = [
    { key: 'idle', label: 'Waiting' },
    { key: 'live', label: 'During a game' },
    { key: 'post', label: 'After a game' }
  ];

  // Three themes, and they differ in FORM rather than hue (see overlay.css).
  // `slate` was a fourth and is gone from here on purpose: it was a re-tint of
  // carved, which is a decision that costs a streamer time and gives them
  // nothing. Its rules stay in the stylesheet so URLs copied while it was
  // offered keep rendering as they did.
  const THEMES = [
    { key: 'carved', label: 'Carved' },
    { key: 'etched', label: 'Etched' },
    { key: 'parchment', label: 'Parchment' }
  ];

  const SCALES = [
    { key: '0.85', label: 'Small' },
    { key: '1', label: 'Normal' },
    { key: '1.25', label: 'Large' }
  ];

  const SHOW = [
    { key: 'always', label: 'Always' },
    { key: 'post', label: 'After a game' }
  ];

  const HOLDS = [
    { key: '15', label: '15s' },
    { key: '20', label: '20s' },
    { key: '30', label: '30s' },
    { key: '60', label: '60s' }
  ];

  const node = (tag, className, text) => {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  };

  window.createStreamView = (deps) => {
    // deps: invoke, log, errText, overlayState
    const prefs = {
      // 'full' | 'strip' | 'custom'. Full is the starting position, not a
      // decision baked in: the other two are one click away.
      layout: 'full',
      modules: null,   // the custom selection; null = all of them
      theme: 'carved',
      scale: '1',
      // Post-game reveal: show up when a game lands, hold, then collapse to
      // the strip. Off by default, because an overlay that changes shape is a
      // surprise, and a surprise on a live stream is a bug report.
      reveal: false,
      hold: 20
    };

    try {
      const saved = JSON.parse(localStorage.getItem('wc3v-overlay-prefs') || 'null');
      if (saved) {
        // Prefs written before the layout control existed carry only a module
        // list. A narrowed one was somebody composing their own card, so it
        // becomes Custom; the absence of one meant "everything", which is now
        // the curated Full card.
        if (!saved.layout) saved.layout = saved.modules ? 'custom' : 'full';
        Object.assign(prefs, saved);
        // A saved `slate` still renders, but it is no longer in the picker, so
        // leaving it selected would show a control with nothing lit.
        if (!THEMES.some(t => t.key === prefs.theme)) prefs.theme = 'carved';
      }
    } catch (e) { /* corrupt prefs just mean defaults */ }

    const savePrefs = () => {
      try { localStorage.setItem('wc3v-overlay-prefs', JSON.stringify(prefs)); } catch (e) {}
    };

    // 'player' | 'cast'. Which overlay this screen is setting up.
    let mode = 'player';

    // Which of the three card states the preview is showing.
    let previewAt = 'live';

    const activeModules = () => {
      if (prefs.layout === 'strip') return STRIP_MODULES.slice();
      if (prefs.layout === 'custom') {
        return prefs.modules || window.OverlayRender.ALL_MODULES.slice();
      }
      return window.OverlayRender.DEFAULT_MODULES.slice();
    };

    // The query string the OBS URL needs. `modules` is omitted only when the
    // selection IS all eight, so an older pasted URL with no param keeps
    // meaning "everything" while a newly copied one names the curated set.
    //
    // `only` overrides the panel selection for a single-panel source, so
    // copying one panel's URL never disturbs the composed one.
    const overlayQuery = (only) => {
      const parts = [];
      const mods = only ? [only] : activeModules();
      if (mods.length !== window.OverlayRender.ALL_MODULES.length) {
        parts.push(`modules=${mods.join(',')}`);
      }
      if (prefs.theme !== 'carved') parts.push(`theme=${prefs.theme}`);
      if (prefs.scale !== '1') parts.push(`scale=${prefs.scale}`);
      if (prefs.reveal) parts.push(`reveal=${prefs.hold}`);
      return parts.length ? `&${parts.join('&')}` : '';
    };

    // The URL carries the access token, so it goes to the clipboard and never
    // to the DOM, the log or a tooltip. This window may be on camera.
    const copyUrl = async (btn, only, note) => {
      const was = btn.textContent;
      try {
        const info = await deps.invoke('overlay_info');
        await navigator.clipboard.writeText(info.url + overlayQuery(only));
        btn.textContent = 'Copied';
        setTimeout(() => { btn.textContent = was; }, 4000);
        deps.log(note, 'ok');
      } catch (e) {
        deps.log(`overlay URL unavailable: ${deps.errText(e)}`, 'err');
      }
    };

    // Same rule as above: the token goes to the clipboard and nowhere else.
    const copyCastUrl = async (btn) => {
      const was = btn.textContent;
      try {
        const info = await deps.invoke('overlay_info');
        await navigator.clipboard.writeText(info.url.replace('/overlay?', '/cast?'));
        btn.textContent = 'Copied';
        setTimeout(() => { btn.textContent = was; }, 4000);
        deps.log('casting overlay URL copied, add it as a Browser Source', 'ok');
      } catch (e) {
        deps.log(`overlay URL unavailable: ${deps.errText(e)}`, 'err');
      }
    };

    // The state the preview draws, for whichever of the three the stepper is
    // on. Nothing here publishes.
    //
    // A state the real payload cannot supply falls back to the stand-in game,
    // because somebody placing a source in OBS at three in the afternoon is not
    // in a game and has no live block to aim at. The fallback keeps the `demo`
    // flag, which is what puts the "not a real game" band across the card.
    const previewPayload = () => {
      const live = deps.overlayState.previewState();
      if (previewAt === 'idle') return { ...live, scout: null, game: null };
      if (previewAt === 'live') {
        return live.scout
          ? { ...live }
          : { ...live, scout: deps.overlayState.demoPreview().scout, demo: true };
      }
      // After a game. The live block comes off, or the renderer would treat
      // this as a match still in progress and hide the result.
      return live.game
        ? { ...live, scout: null }
        : { ...deps.overlayState.demoPreview(), scout: null };
    };

    const renderPreview = () => {
      const host = el('overlay-preview');
      if (host) {
        host.dataset.theme = prefs.theme;
        host.style.fontSize = `${16 * parseFloat(prefs.scale)}px`;
        window.OverlayRender.render(host, previewPayload(), activeModules());
      }

      // The casting page is a separate Browser Source with a separate renderer,
      // so it gets its own preview off the same published state. The live one,
      // not the subtracted one: the player card's preview states are a control
      // on this screen and say nothing about what the caster's page is showing.
      const cast = el('cast-preview');
      if (cast && window.CastRender) {
        cast.dataset.theme = prefs.theme;
        window.CastRender.render(cast, deps.overlayState.previewState(), null);
      }
    };

    const segmented = (items, current, onPick) => {
      const seg = node('div', 'seg');
      for (const item of items) {
        const b = node('button', 'seg-btn' + (item.key === current ? ' is-on' : ''), item.label);
        b.type = 'button';
        b.addEventListener('click', () => onPick(item.key));
        seg.appendChild(b);
      }
      return seg;
    };

    // A named setting: label left, control right, one row. The Look panel used
    // to put every label on its own line above its buttons, which spent a third
    // of the panel's height on four words.
    const control = (label, items, current, onPick) => {
      const row = node('div', 'ctl');
      row.appendChild(node('span', 'ctl-k', label));
      row.appendChild(segmented(items, current, onPick));
      return row;
    };

    const panel = (title) => {
      const p = node('section', 'panel');
      p.appendChild(node('h2', null, title));
      return p;
    };

    // ── OBS setup ───────────────────────────────────────────────────────────
    //
    // First panel on the screen. The URL is a credential and the shutdown
    // setting is a real failure mode, so both stay here where the URL gets
    // copied. Everything else that used to sit under this was explanation.
    const obsPanel = () => {
      const p = panel('OBS setup');

      const row = node('div', 'row');
      const copy = node('button', 'btn btn-primary', 'Copy Browser Source URL');
      copy.type = 'button';
      copy.addEventListener('click', () => copyUrl(copy, null,
        'OBS URL copied. Add a Browser Source, suggested 460×560.'));
      row.appendChild(copy);

      const player = node('button', 'btn', 'Open the player view');
      player.type = 'button';
      player.title = 'An ordinary window for a second monitor';
      player.addEventListener('click', () =>
        deps.invoke('open_player_view')
          .catch(e => deps.log(`player view failed: ${deps.errText(e)}`, 'err')));
      row.appendChild(player);
      p.appendChild(row);

      p.appendChild(node('p', 'hint',
        'In OBS: Sources, add Browser, paste the URL, size 460 × 560.'));
      p.appendChild(node('p', 'hint',
        'Turn off “Shutdown source when not visible”, or the overlay stops ' +
        'updating whenever the scene is not live.'));
      p.appendChild(node('p', 'hint',
        'The URL contains your access token. Keep it off stream.'));
      return p;
    };

    // ── Card ────────────────────────────────────────────────────────────────
    //
    // Layout and Look were two panels asking one question, which is what the
    // card looks like. The per-panel checkbox list is still one click in, under
    // Custom, because composing a card is the decision almost nobody wants to
    // make first.
    const cardPanel = () => {
      const p = panel('Card');

      p.appendChild(control('Panels', LAYOUTS, prefs.layout, (k) => {
        prefs.layout = k;
        savePrefs();
        build();
      }));

      if (prefs.layout === 'custom') {
        const on = activeModules();
        const list = node('div', 'mod-list');
        for (const m of MODULES) {
          const row = node('div', 'panel-row');
          const label = node('label', 'check');
          const box = document.createElement('input');
          box.type = 'checkbox';
          box.checked = on.indexOf(m.key) !== -1;
          box.addEventListener('change', () => {
            const next = window.OverlayRender.ALL_MODULES.filter(k =>
              k === m.key ? box.checked : activeModules().indexOf(k) !== -1);
            // Everything off leaves a blank source and no way back from OBS.
            if (!next.length) { box.checked = true; return; }
            prefs.modules = next;
            savePrefs();
            renderPreview();
          });
          label.appendChild(box);
          const text = node('span');
          text.appendChild(node('span', null, m.label));
          text.appendChild(node('span', 'hint', m.size));
          label.appendChild(text);
          row.appendChild(label);

          const solo = node('button', 'btn btn-sm', 'Copy URL');
          solo.type = 'button';
          solo.title = `A Browser Source showing only ${m.label.toLowerCase()}`;
          solo.addEventListener('click', () => copyUrl(solo, m.key,
            `${m.label} URL copied. Add a Browser Source, suggested ${m.size}.`));
          row.appendChild(solo);
          list.appendChild(row);
        }
        p.appendChild(list);
      }

      p.appendChild(control('Theme', THEMES, prefs.theme, (k) => {
        prefs.theme = k; savePrefs(); build();
      }));
      p.appendChild(control('Size', SCALES, prefs.scale, (k) => {
        prefs.scale = k; savePrefs(); build();
      }));

      // The reveal, as a two-way choice rather than a checkbox with a hidden
      // consequence. On, the card holds after a game and then collapses to the
      // slim strip instead of vanishing.
      p.appendChild(control('Show', SHOW, prefs.reveal ? 'post' : 'always', (k) => {
        prefs.reveal = k === 'post';
        savePrefs();
        build();
      }));
      if (prefs.reveal) {
        p.appendChild(control('Hold for', HOLDS, String(prefs.hold), (k) => {
          prefs.hold = parseInt(k, 10); savePrefs(); build();
        }));
        p.appendChild(node('p', 'hint',
          'Then it collapses to the live match and your session score. A ' +
          'single-panel source hides instead.'));
      }
      return p;
    };

    // ── Preview ─────────────────────────────────────────────────────────────
    const previewPanel = () => {
      const p = panel('Preview');

      // The card is three different objects over a night and the streamer has
      // to be able to place a source against all three. With a reveal hold set,
      // the full one is on screen for twenty seconds a game.
      p.appendChild(segmented(PREVIEW_STATES, previewAt, (k) => {
        previewAt = k;
        build();
      }));

      const stage = node('div', 'preview-stage');
      const root = node('div');
      root.id = 'overlay-preview';
      stage.appendChild(root);
      p.appendChild(stage);

      const row = node('div', 'row');
      const demo = node('button', 'btn', deps.overlayState.isDemo
        ? 'Back to the real game' : 'Send a test game to OBS');
      demo.type = 'button';
      demo.addEventListener('click', async () => {
        if (deps.overlayState.isDemo) await deps.overlayState.publish();
        else await deps.overlayState.publishDemo();
        deps.log(deps.overlayState.isDemo
          ? 'test game pushed to OBS, labelled as a preview on the overlay'
          : 'overlay back to your real games', 'ok');
        build();
      });
      row.appendChild(demo);
      p.appendChild(row);
      return p;
    };

    // ── Casting ─────────────────────────────────────────────────────────────
    //
    // The caster's control surface, and the one part of this app that is not
    // derived from a replay. A series score needs ordered games and a running
    // total, which free tags cannot express, and a caster changes the names
    // between matches anyway. So it is typed here and published live: every
    // change is on screen before they let go of the mouse.
    //
    // It drives a SECOND overlay page (/cast). The player overlay is one
    // person's session said as "you"; a broadcast is two strangers said as
    // neither, and bending one into the other would have meant a mode flag
    // through every module in overlay-render.js.
    const RACE_PICK = [
      { key: '', label: '—' },
      { key: 'H', label: 'HU' },
      { key: 'O', label: 'OC' },
      { key: 'U', label: 'UD' },
      { key: 'E', label: 'NE' },
      { key: 'R', label: 'RD' }
    ];

    const cur = () => deps.overlayState.cast || {
      event: '', round: '', badge: '', a: { name: '', race: '' }, b: { name: '', race: '' },
      scoreA: 0, scoreB: 0
    };
    const commit = (patch) => {
      deps.overlayState.setCast({ ...cur(), ...patch });
      renderPreview();
    };

    const field = (label, value, placeholder, onChange) => {
      const wrap = node('label', 'field');
      wrap.appendChild(node('span', 'field-label', label));
      const input = document.createElement('input');
      input.type = 'text';
      input.value = value || '';
      input.placeholder = placeholder;
      input.addEventListener('change', () => onChange(input.value.trim()));
      wrap.appendChild(input);
      return wrap;
    };

    const castSetupPanel = () => {
      const p = panel('OBS setup');

      const row = node('div', 'row');
      const copy = node('button', 'btn btn-primary', 'Copy Browser Source URL');
      copy.type = 'button';
      copy.addEventListener('click', () => copyCastUrl(copy));
      row.appendChild(copy);

      const clear = node('button', 'btn', 'Clear the scoreboard');
      clear.type = 'button';
      clear.title = 'Take the scoreboard off the broadcast';
      clear.addEventListener('click', () => {
        deps.overlayState.setCast(null);
        build();
      });
      row.appendChild(clear);
      p.appendChild(row);

      p.appendChild(node('p', 'hint',
        'In OBS: Sources, add Browser, paste the URL, size 480 × 220.'));
      p.appendChild(node('p', 'hint',
        'A separate source from your own card. The URL contains your access ' +
        'token. Keep it off stream.'));
      return p;
    };

    const castPreviewPanel = () => {
      const p = panel('Preview');
      const stage = node('div', 'preview-stage cast-stage');
      const root = node('div');
      root.id = 'cast-preview';
      root.dataset.view = 'panel';
      stage.appendChild(root);
      p.appendChild(stage);
      // The scoreboard draws nothing until it has something to say, which is
      // correct on a broadcast and reads as a broken panel here.
      const c = deps.overlayState.cast;
      const empty = !c || (!c.event && !c.round && !c.badge &&
        !(c.a && c.a.name) && !(c.b && c.b.name));
      if (empty) p.appendChild(node('p', 'hint', 'Fill in the scoreboard to see it.'));
      return p;
    };

    const scoreboardPanel = () => {
      const p = panel('Scoreboard');

      const head = node('div', 'cast-head');
      head.appendChild(field('Event', cur().event, 'WC3L Season 18', v => commit({ event: v })));
      head.appendChild(field('Round', cur().round, 'Grand final', v => commit({ round: v })));
      head.appendChild(field('Badge', cur().badge, 'Random hero', v => commit({ badge: v })));
      p.appendChild(head);

      // One side of the scoreboard.
      const side = (which) => {
        const c = cur();
        const who = (which === 'a' ? c.a : c.b) || { name: '', race: '' };
        const scoreKey = which === 'a' ? 'scoreA' : 'scoreB';

        const box = node('div', 'cast-side');
        box.appendChild(field('Player', who.name, 'name', (v) =>
          commit({ [which]: { ...who, name: v } })));

        const races = node('div', 'seg');
        for (const r of RACE_PICK) {
          const b = node('button', 'seg-btn' + (r.key === (who.race || '') ? ' is-on' : ''), r.label);
          b.type = 'button';
          if (r.key) b.dataset.race = r.key;
          b.addEventListener('click', () => {
            commit({ [which]: { ...who, race: r.key } });
            build();
          });
          races.appendChild(b);
        }
        box.appendChild(races);

        const score = node('div', 'cast-score');
        const step = (delta, label) => {
          const b = node('button', 'btn btn-sm', label);
          b.type = 'button';
          b.addEventListener('click', () => {
            // Never below zero. A negative series score is not a state a
            // scoreboard can be in, and a caster fat-fingering minus twice
            // should not have to fix it.
            commit({ [scoreKey]: Math.max(0, (cur()[scoreKey] || 0) + delta) });
            build();
          });
          return b;
        };
        score.appendChild(step(-1, '−'));
        score.appendChild(node('span', 'cast-n', String(c[scoreKey] || 0)));
        score.appendChild(step(1, '+'));
        box.appendChild(score);
        return box;
      };

      const sides = node('div', 'cast-sides');
      sides.appendChild(side('a'));
      sides.appendChild(node('span', 'cast-v', 'v'));
      sides.appendChild(side('b'));
      p.appendChild(sides);

      p.appendChild(node('p', 'hint',
        'The stat bar under it follows whichever game finished last.'));
      return p;
    };

    const build = () => {
      const host = el('stream-body');
      host.innerHTML = '';
      host.dataset.mode = mode;

      // Which overlay is being set up. A mode rather than two panels down one
      // column: the scoreboard used to be below the fold of a scroller with its
      // own copy button below that, which is the worst place on the screen for
      // a control whose whole point is that it is live.
      const modes = node('div', 'stream-modes');
      modes.appendChild(segmented(
        [{ key: 'player', label: 'Your stream' }, { key: 'cast', label: 'Casting a match' }],
        mode,
        (k) => { mode = k; build(); }
      ));
      host.appendChild(modes);

      // Two columns, each its own scroller. The view frame never scrolls, per
      // the fold rule.
      const left = node('div', 'col scroll');
      const right = node('div', 'col scroll');
      host.appendChild(left);
      host.appendChild(right);

      if (mode === 'cast') {
        left.appendChild(castSetupPanel());
        left.appendChild(castPreviewPanel());
        right.appendChild(scoreboardPanel());
      } else {
        left.appendChild(previewPanel());
        right.appendChild(obsPanel());
        right.appendChild(cardPanel());
      }

      renderPreview();
    };

    return { build, renderPreview };
  };
})();
