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

  const MODULES = [
    { key: 'session', label: 'Session score', hint: 'Wins, losses and streak for this sitting' },
    { key: 'verdict', label: 'Last game', hint: 'Result, opponent and key timings' },
    { key: 'h2h', label: 'Head to head', hint: 'Your all-time record against that opponent' },
    { key: 'moments', label: 'Key moments', hint: 'The biggest beats of the game, with timestamps' },
    { key: 'build', label: 'Build order', hint: 'Your opening, first twelve steps' }
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
      scale: '1'
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
    const overlayQuery = () => {
      const parts = [];
      const mods = prefs.modules;
      if (mods && mods.length !== window.OverlayRender.ALL_MODULES.length) {
        parts.push(`modules=${mods.join(',')}`);
      }
      if (prefs.theme !== 'carved') parts.push(`theme=${prefs.theme}`);
      if (prefs.scale !== '1') parts.push(`scale=${prefs.scale}`);
      return parts.length ? `&${parts.join('&')}` : '';
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
      const on = activeModules();
      for (const m of MODULES) {
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
        mods.appendChild(label);
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
      copy.addEventListener('click', async () => {
        try {
          const info = await deps.invoke('overlay_info');
          await navigator.clipboard.writeText(info.url + overlayQuery());
          copy.textContent = 'Copied — paste it into OBS';
          setTimeout(() => { copy.textContent = 'Copy OBS Browser Source URL'; }, 4000);
          deps.log('OBS URL copied. Add a Browser Source, suggested 460×640.', 'ok');
        } catch (e) {
          deps.log(`overlay URL unavailable: ${deps.errText(e)}`, 'err');
        }
      });
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
      setup.appendChild(node('p', 'hint',
        'Only games detected while WC3V is running count toward the session ' +
        'score — clicking through your history never changes what is on stream.'));
      right.appendChild(setup);

      renderPreview();
    };

    return { build, renderPreview };
  };
})();
