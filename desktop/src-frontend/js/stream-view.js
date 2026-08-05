// Stream screen — everything about getting WC3V onto a broadcast.
//
// The overlay is served by a loopback HTTP server (127.0.0.1 only, token on
// every route, GET only) because an OBS Browser Source is a separate Chromium
// process and cannot see this window's state any other way.
//
// Two rules this screen exists to satisfy:
//
//   1. Nobody should configure an overlay blind. The preview here renders from
//      the SAME overlay.css and overlay-render.js the Browser Source loads, so
//      what is on this screen is what goes on stream.
//   2. The overlay URL carries the access token, so it goes to the clipboard
//      and NEVER to the DOM or the log — this window may be on camera.

(function () {
  'use strict';

  const el = (id) => document.getElementById(id);

  // Each panel is also a source in its own right. Streamers compose two or
  // three small sources they can place independently far more often than they
  // use one tall card, so every panel carries its own URL and its own
  // suggested size — the size is the thing nobody can guess from the UI.
  const MODULES = [
    { key: 'session', label: 'Session score', hint: 'Wins, losses and streak for this sitting', size: '300 × 90' },
    { key: 'verdict', label: 'Last game', hint: 'Result, opponent, the one-line read and key timings', size: '460 × 260' },
    { key: 'h2h', label: 'Head to head', hint: 'Your all-time record against that opponent', size: '360 × 90' },
    { key: 'moments', label: 'Key moments', hint: 'The biggest beats of the game, with timestamps', size: '460 × 260' },
    { key: 'build', label: 'Build order', hint: 'Your opening, first twelve steps', size: '360 × 400' }
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
      modules: null,   // null = all of them
      theme: 'carved',
      scale: '1',
      // Post-game reveal: show up when a game lands, hold, then get out of the
      // way. Off by default — an overlay that vanishes is a surprise, and a
      // surprise on a live stream is a bug report.
      reveal: false,
      hold: 20
    };

    try {
      const saved = JSON.parse(localStorage.getItem('wc3v-overlay-prefs') || 'null');
      if (saved) Object.assign(prefs, saved);
    } catch (e) { /* corrupt prefs just mean defaults */ }

    const savePrefs = () => {
      try { localStorage.setItem('wc3v-overlay-prefs', JSON.stringify(prefs)); } catch (e) {}
    };

    const activeModules = () =>
      prefs.modules || window.OverlayRender.ALL_MODULES.slice();

    // The query string the OBS URL needs. `modules` is only added when the
    // user has actually narrowed it, so the default URL stays short and an
    // older pasted URL keeps meaning "everything".
    //
    // `only` overrides the panel selection for a single-panel source, so
    // copying one panel's URL never disturbs the composed one.
    const overlayQuery = (only) => {
      const parts = [];
      const mods = only ? [only] : prefs.modules;
      if (mods && mods.length !== window.OverlayRender.ALL_MODULES.length) {
        parts.push(`modules=${mods.join(',')}`);
      }
      if (prefs.theme !== 'carved') parts.push(`theme=${prefs.theme}`);
      if (prefs.scale !== '1') parts.push(`scale=${prefs.scale}`);
      if (prefs.reveal) parts.push(`reveal=${prefs.hold}`);
      return parts.length ? `&${parts.join('&')}` : '';
    };

    // The URL carries the access token, so it goes to the clipboard and never
    // to the DOM, the log or a tooltip — this window may be on camera.
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

    const renderPreview = () => {
      const host = el('overlay-preview');
      if (!host) return;
      host.dataset.theme = prefs.theme;
      host.style.fontSize = `${16 * parseFloat(prefs.scale)}px`;
      window.OverlayRender.render(host, deps.overlayState.previewState(), activeModules());
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

    const build = () => {
      const host = el('stream-body');
      host.innerHTML = '';

      // Two columns, each its own scroller: the preview on the left at full
      // width (it is the point of the screen), the controls stacked on the
      // right. The view itself never scrolls — the fold rule.
      const left = node('div', 'col scroll');
      const right = node('div', 'col scroll');
      host.appendChild(left);
      host.appendChild(right);

      // ── What's on screen ────────────────────────────────────────────────
      const preview = node('section', 'panel');
      preview.appendChild(node('h2', null, 'What viewers will see'));
      preview.appendChild(node('p', 'lead',
        'This is the real overlay, drawn by the same code the Browser Source ' +
        'runs. Size and colour here are what OBS gets.'));
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
          ? 'test game pushed to OBS — it is labelled as a preview on the overlay'
          : 'overlay back to your real games', 'ok');
        build();
      });
      demoRow.appendChild(demo);
      preview.appendChild(demoRow);
      preview.appendChild(node('p', 'hint',
        'Lets you place and size the source in OBS before you play. The overlay ' +
        'labels it, so it can never be mistaken for a real result.'));
      left.appendChild(preview);

      // ── Panels ──────────────────────────────────────────────────────────
      const mods = node('section', 'panel');
      mods.appendChild(node('h2', null, 'Panels'));
      mods.appendChild(node('p', 'lead',
        'Tick what belongs on the card above — or take any one panel on its ' +
        'own URL and place it wherever you like in OBS.'));
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
        text.appendChild(node('span', 'hint', m.hint));
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
      revealText.appendChild(node('span', 'hint',
        'Slides in when the replay lands, holds, then hides again'));
      revealLabel.appendChild(revealText);
      look.appendChild(revealLabel);

      if (prefs.reveal) {
        look.appendChild(segmented(HOLDS, String(prefs.hold), (k) => {
          prefs.hold = parseInt(k, 10); savePrefs(); build();
        }));
        look.appendChild(node('p', 'hint',
          'While it is hidden the source is still connected — nothing to ' +
          'refresh, and the next game brings it back on its own.'));
      }
      right.appendChild(look);

      // ── Connect ─────────────────────────────────────────────────────────
      const setup = node('section', 'panel');
      setup.appendChild(node('h2', null, 'Put it in OBS'));
      setup.appendChild(node('p', 'lead',
        'Add a Browser Source and paste the URL. It updates itself the moment a ' +
        'game finishes — no refresh, no interaction.'));
      setup.appendChild(node('p', 'lead',
        'The URL contains your access token. Paste it straight into OBS and keep ' +
        'it off stream; that is why it is never displayed here.'));

      const row = node('div', 'row');
      const copy = node('button', 'btn btn-primary', 'Copy OBS Browser Source URL');
      copy.type = 'button';
      copy.addEventListener('click', () => copyUrl(copy, null,
        'OBS URL copied. Add a Browser Source, suggested 460×640.'));
      row.appendChild(copy);

      const player = node('button', 'btn', 'Open the player view');
      player.type = 'button';
      player.title = 'An ordinary window for a second monitor';
      player.addEventListener('click', () =>
        deps.invoke('open_player_view')
          .catch(e => deps.log(`player view failed: ${deps.errText(e)}`, 'err')));
      row.appendChild(player);
      setup.appendChild(row);
      setup.appendChild(node('p', 'hint', 'Suggested source size: 460 × 640.'));

      // The two OBS settings that decide whether this works, stated where the
      // URL is copied rather than in a document nobody opens. Both are real
      // failures we would otherwise get bug reports for: a source that unloads
      // between scenes drops the live connection, and a background left on the
      // page shows a black box on the stream.
      setup.appendChild(node('h3', 'setup-h', 'Two settings in the source'));
      const checks = node('ul', 'obs-checks');
      const check = (text, why) => {
        const li = node('li');
        li.appendChild(node('span', 'obs-check-k', text));
        li.appendChild(node('span', 'hint', why));
        checks.appendChild(li);
      };
      check('Leave “Shutdown source when not visible” OFF',
        'It unloads the page whenever the scene is not live, which drops the ' +
        'connection that keeps this updating.');
      check('“Refresh browser when scene becomes active” is safe either way',
        'The overlay reloads its whole state on load, so a refresh costs nothing.');
      setup.appendChild(checks);

      setup.appendChild(node('p', 'hint',
        'Nothing else to configure — the page is transparent on its own, so ' +
        'there is no custom CSS to paste.'));
      setup.appendChild(node('p', 'hint',
        'Only games detected while WC3V is running count toward the session ' +
        'score — clicking through your history never changes what is on stream.'));

      // Why this is safe to have on a stream at all. Worth stating: every
      // other WC3 overlay reads the game's memory or sniffs its packets, and
      // viewers have learned to be suspicious of both.
      setup.appendChild(node('p', 'hint',
        'Everything here is read from the replay Warcraft III already saved, ' +
        'after the game has ended — nothing is read from the running game, so ' +
        'nothing on screen can help anyone snipe you mid-match.'));
      right.appendChild(setup);

      renderPreview();
    };

    return { build, renderPreview };
  };
})();
