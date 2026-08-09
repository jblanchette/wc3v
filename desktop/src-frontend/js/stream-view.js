// Stream screen: getting WC3V onto a broadcast.
//
// A loopback HTTP server serves the overlay (127.0.0.1 only, token on every
// route, GET only), because an OBS Browser Source is a separate Chromium
// process and cannot see this window's state any other way.
//
// Two rules this screen exists to satisfy:
//
//   1. Nobody configures an overlay blind. The preview here renders from the
//      same overlay.css and overlay-render.js the Browser Source loads, so
//      what is on this screen is what goes on stream.
//   2. The overlay URL carries the access token, so it goes to the clipboard
//      and never to the DOM or the log. This window may be on camera.

(function () {
  'use strict';

  const el = (id) => document.getElementById(id);

  // Every panel is also a source in its own right. Streamers compose two or
  // three small sources they can place independently far more often than they
  // use one tall card, so each carries its own URL and suggested size. The
  // size is the part nobody can guess from the UI.
  const MODULES = [
    { key: 'scout', label: 'Scouting', size: '380 × 240' },
    { key: 'session', label: 'Session score', size: '300 × 110' },
    { key: 'verdict', label: 'Last game', size: '460 × 150' },
    // Key stays `report` after the grades became three numbers: shell.html
    // drops module names it does not recognise, so renaming it would silently
    // blank the panel in every OBS source already pointed at this app.
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
    { key: 'full', label: 'Full card' },
    { key: 'strip', label: 'Slim strip' },
    { key: 'custom', label: 'Custom' }
  ];

  // The slim strip: what is still true between games. Same two modules the full
  // card collapses to when a reveal hold expires.
  const STRIP_MODULES = ['scout', 'session'];

  // The preview's three states, derived here rather than published. A card that
  // collapses has to be inspectable without playing three games to see it.
  const PREVIEW_STATES = [
    { key: 'post', label: 'After a game' },
    { key: 'between', label: 'Between games' },
    { key: 'idle', label: 'Idle' }
  ];

  const THEMES = [
    { key: 'carved', label: 'Carved' },
    { key: 'slate', label: 'Slate' }
  ];

  const SCALES = [
    { key: '0.85', label: 'Small' },
    { key: '1', label: 'Normal' },
    { key: '1.25', label: 'Large' }
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
      }
    } catch (e) { /* corrupt prefs just mean defaults */ }

    const savePrefs = () => {
      try { localStorage.setItem('wc3v-overlay-prefs', JSON.stringify(prefs)); } catch (e) {}
    };

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

    // Which of the three states the preview is showing. Local to this screen:
    // it publishes nothing and touches no payload, it just subtracts from the
    // state that is already there.
    let previewAt = 'post';

    const renderPreview = () => {
      const live = deps.overlayState.previewState();
      // Between games there is no finished game to show; idle is that with
      // nobody on the other side of the ladder either. Both land on the same
      // phase, because both ARE the strip.
      const state = previewAt === 'post' ? live
        : previewAt === 'between' ? { ...live, game: null }
          : { ...live, game: null, scout: null };

      const host = el('overlay-preview');
      if (host) {
        host.dataset.theme = prefs.theme;
        host.dataset.phase = previewAt === 'post' ? 'post' : 'idle';
        host.style.fontSize = `${16 * parseFloat(prefs.scale)}px`;
        window.OverlayRender.render(host, state, activeModules());
      }

      // The casting page is a separate Browser Source with a separate renderer,
      // so it gets its own preview off the same published state. The live one,
      // not the subtracted one: the player card's preview states are a control
      // on this screen and say nothing about what the caster's page is showing.
      const cast = el('cast-preview');
      if (cast && window.CastRender) {
        cast.dataset.theme = prefs.theme;
        window.CastRender.render(cast, live, null);
      }
    };

    const segmented = (items, current, onPick) => {
      const row = node('div', 'row');
      for (const item of items) {
        const b = node('button', 'btn btn-sm' + (item.key === current ? ' is-on' : ''), item.label);
        b.type = 'button';
        b.addEventListener('click', () => onPick(item.key));
        row.appendChild(b);
      }
      return row;
    };

    // ── The Casting panel ─────────────────────────────────────────────────
    //
    // Two names with their races, an event line, a format badge and a score
    // that goes up and down. Every change publishes immediately, because the
    // whole point of a caster's control is that the change is on screen before
    // they let go of the mouse.
    const RACE_PICK = [
      { key: '', label: '—' },
      { key: 'H', label: 'HU' },
      { key: 'O', label: 'OC' },
      { key: 'U', label: 'UD' },
      { key: 'E', label: 'NE' },
      { key: 'R', label: 'RD' }
    ];

    const castPanel = () => {
      const panel = node('section', 'panel');
      panel.appendChild(node('h2', null, 'Casting'));

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

      // Nobody configures an overlay blind. This renders from cast-render.js,
      // the same file the Browser Source is served, for the same reason the
      // panel preview above does: a preview drawn by different code can lie.
      const stage = node('div', 'preview-stage cast-stage');
      const castRoot = node('div');
      castRoot.id = 'cast-preview';
      castRoot.dataset.view = 'panel';
      stage.appendChild(castRoot);
      panel.appendChild(stage);

      const head = node('div', 'cast-head');
      head.appendChild(field('Event', cur().event, 'WC3L Season 18', v => commit({ event: v })));
      head.appendChild(field('Round', cur().round, 'Grand final', v => commit({ round: v })));
      head.appendChild(field('Badge', cur().badge, 'Random hero', v => commit({ badge: v })));
      panel.appendChild(head);

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
      panel.appendChild(sides);

      const row = node('div', 'row');
      const copy = node('button', 'btn btn-primary', 'Copy casting overlay URL');
      copy.type = 'button';
      copy.addEventListener('click', () => copyCastUrl(copy));
      row.appendChild(copy);

      const clear = node('button', 'btn', 'Clear');
      clear.type = 'button';
      clear.title = 'Take the scoreboard off the broadcast';
      clear.addEventListener('click', () => {
        deps.overlayState.setCast(null);
        build();
      });
      row.appendChild(clear);
      panel.appendChild(row);

      panel.appendChild(node('p', 'hint',
        'A separate Browser Source from the panels below. Suggested size 480 × 220.'));
      return panel;
    };

    // Same rule as the player overlay's URL: the token goes to the clipboard
    // and never to the DOM, the log or a tooltip. This window may be on camera.
    const copyCastUrl = async (btn) => {
      const was = btn.textContent;
      try {
        const info = await deps.invoke('overlay_info');
        const url = info.url.replace('/overlay?', '/cast?');
        await navigator.clipboard.writeText(url);
        btn.textContent = 'Copied';
        setTimeout(() => { btn.textContent = was; }, 4000);
        deps.log('casting overlay URL copied, add it as a Browser Source', 'ok');
      } catch (e) {
        deps.log(`overlay URL unavailable: ${deps.errText(e)}`, 'err');
      }
    };

    const build = () => {
      const host = el('stream-body');
      host.innerHTML = '';

      // Two columns, each its own scroller. The preview goes left at full
      // width, since it is the point of the screen, and the controls stack on
      // the right. The view itself never scrolls, per the fold rule.
      const left = node('div', 'col scroll');
      const right = node('div', 'col scroll');
      host.appendChild(left);
      host.appendChild(right);

      // ── Preview ─────────────────────────────────────────────────────────
      const preview = node('section', 'panel');
      preview.appendChild(node('h2', null, 'What viewers see'));

      // The card is three different objects over a session, and the full one
      // is the rarest: with a reveal hold set it is on screen for twenty
      // seconds a game and the strip is on screen for the rest of the night.
      // Stepping the states here is the only way to place a source against
      // what it will actually look like most of the time.
      preview.appendChild(segmented(PREVIEW_STATES, previewAt, (k) => {
        previewAt = k;
        build();
      }));

      const stage = node('div', 'preview-stage');
      const root = node('div');
      root.id = 'overlay-preview';
      stage.appendChild(root);
      preview.appendChild(stage);

      const demoRow = node('div', 'row');
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
      demoRow.appendChild(demo);
      preview.appendChild(demoRow);
      left.appendChild(preview);

      // ── Casting ─────────────────────────────────────────────────────────
      //
      // The caster's control surface, and the one part of this app that is not
      // derived from a replay. A series score needs ordered games and a running
      // total, which free tags cannot express, and a caster changes the names
      // between matches anyway. So it is typed here and published live.
      //
      // It drives a SECOND overlay page (/cast), not this one. The player
      // overlay is one person's session said as "you"; a broadcast is two
      // strangers said as neither, and bending one into the other would have
      // meant a mode flag through every module in overlay-render.js.
      left.appendChild(castPanel());

      // ── Layout ──────────────────────────────────────────────────────────
      //
      // Eight checkboxes made composing a card the first decision anybody had
      // to make, and it is the one almost nobody wants to make. Two shapes and
      // an escape hatch: the per-panel list still exists, one click in.
      const mods = node('section', 'panel');
      mods.appendChild(node('h2', null, 'Layout'));
      mods.appendChild(segmented(LAYOUTS, prefs.layout, (k) => {
        prefs.layout = k;
        savePrefs();
        build();
      }));

      if (prefs.layout === 'full') {
        mods.appendChild(node('p', 'hint',
          'The last game, with the scouting strip and your session score. ' +
          'Key moments and the build order are in Custom.'));
      } else if (prefs.layout === 'strip') {
        mods.appendChild(node('p', 'hint',
          'Who you are about to play and today’s score. Nothing about ' +
          'the last game.'));
      } else {
        const on = activeModules();
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
          mods.appendChild(row);
        }
        mods.appendChild(node('p', 'hint',
          'These are the player panels, framed as you. Casting above is a ' +
          'separate source for two players.'));
      }
      right.appendChild(mods);

      // ── Look ────────────────────────────────────────────────────────────
      const look = node('section', 'panel');
      look.appendChild(node('h2', null, 'Look'));
      look.appendChild(node('p', 'lead', 'Theme'));
      look.appendChild(segmented(THEMES, prefs.theme, (k) => {
        prefs.theme = k; savePrefs(); build();
      }));
      look.appendChild(node('p', 'lead', 'Size'));
      look.appendChild(segmented(SCALES, prefs.scale, (k) => {
        prefs.scale = k; savePrefs(); build();
      }));

      // ── Post-game reveal ────────────────────────────────────────────────
      look.appendChild(node('p', 'lead', 'When to show it'));
      const revealLabel = node('label', 'check');
      const revealBox = document.createElement('input');
      revealBox.type = 'checkbox';
      revealBox.checked = !!prefs.reveal;
      revealBox.addEventListener('change', () => {
        prefs.reveal = revealBox.checked;
        savePrefs();
        build();
      });
      revealLabel.appendChild(revealBox);
      const revealText = node('span');
      revealText.appendChild(node('span', null, 'Only after a game'));
      revealLabel.appendChild(revealText);
      look.appendChild(revealLabel);

      if (prefs.reveal) {
        look.appendChild(segmented(HOLDS, String(prefs.hold), (k) => {
          prefs.hold = parseInt(k, 10); savePrefs(); build();
        }));
        look.appendChild(node('p', 'hint',
          'The full card holds for this long, then collapses to the score ' +
          'strip. A single-panel source hides instead.'));
      }
      right.appendChild(look);

      // ── Connect ─────────────────────────────────────────────────────────
      const setup = node('section', 'panel');
      setup.appendChild(node('h2', null, 'Put it in OBS'));

      const row = node('div', 'row');
      const copy = node('button', 'btn btn-primary', 'Copy OBS Browser Source URL');
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
      setup.appendChild(row);

      // The URL is a credential and the source setting is a real failure mode.
      // Both stay, where the URL gets copied, rather than in a document nobody
      // opens. Everything else that used to sit here was explanation.
      setup.appendChild(node('p', 'hint',
        'The URL contains your access token. Keep it off stream.'));
      setup.appendChild(node('p', 'hint', 'Suggested size: 460 × 560.'));
      setup.appendChild(node('p', 'hint',
        'Turn off “Shutdown source when not visible” in the source, or the ' +
        'overlay stops updating whenever the scene is not live.'));
      // One sentence, because the card now carries its own source line under
      // the Scouting heading and this used to say the same thing twice.
      setup.appendChild(node('p', 'hint',
        'Everything comes from finished replays, except Scouting, which is ' +
        'public W3Champions data about your opponent.'));
      right.appendChild(setup);

      renderPreview();
    };

    return { build, renderPreview };
  };
})();
