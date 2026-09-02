// The first-run screen. Once, on a machine that has never been set up.
//
// Four steps, one panel, a rail across the top that says where you are:
//
//   1 Welcome    what the app is, what stays on this machine, and the one
//                thing that has to be ticked: the privacy policy and terms.
//   2 Folders    the replay folder tree (js/folders.js), the same one
//                Settings shows. Open a row to see what is in it.
//   3 You        which player you are, chosen from the seats in your most
//                recent games (js/identity-picker.js), plus W3Champions.
//   4 History    only new games from here on, or also read what is on disk.
//
// Every choice can be changed in Settings afterwards, so nothing here is a
// decision anybody is stuck with. There is no Skip. Each step has a default
// that works, Next always works once step 1 is ticked, and the screen is
// four clicks long. A skip button used to sit beside Start; what it did was
// leave the W3Champions marker unwritten and the name unset, which is also
// what clicking through with nothing changed does, minus the acceptance.
//
// ── The acceptance ──────────────────────────────────────────────────────────
//
// The app sends an anonymous usage count by default and, if switched on,
// your battle tag to W3Champions. That is enough that a privacy notice has
// to be in front of the person, and a recorded acknowledgement is cheap. It
// writes a marker file with the effective dates of the two pages through
// `accept_terms`, so the fact is on disk rather than in a checkbox.
//
// ── The W3Champions row ─────────────────────────────────────────────────────
//
// It ships checked, because it is what most people want and an opt-in nobody
// ever sees is an opt-in nobody gets. What makes that acceptable is that it is
// stated in front of the person, in the same breath: what it sends, what it
// never sends, and where the switch lives afterwards.
//
// The checkbox is not the setting. It writes through `set_w3c_enabled`, the
// same command Settings uses, and w3c.rs refuses every request until its marker
// file exists.

(function () {
  'use strict';

  const el = (id) => document.getElementById(id);

  // The effective dates of client/privacy.html and client/terms.html. Bump
  // when either page changes, so the marker says which text was accepted.
  const POLICY_VERSION = 'privacy:2026-08-31,terms:2026-05-06';

  const STEPS = ['welcome', 'folders', 'you', 'history'];

  window.createFirstRun = (deps) => {
    // deps: invoke, log, errText, folders, picker, startBackfill(),
    //       onW3cChange(on), onOnly1v1Set(), onDone()

    const sheet = () => el('setup-sheet');
    let step = 0;
    let pickerStarted = false;

    // Below this the whole run fits in a coffee break and the question is not
    // worth a row on the screen. Above it, hours of parsing are on the table
    // and the filter is offered pre-checked, with the count in front of the
    // person so the default is stated rather than sprung.
    const ONLY_1V1_SUGGEST_AT = 500;

    const total = () => deps.folders.list.reduce(
      (n, f) => n + (f.enabled ? (f.direct_count || 0) : 0), 0);

    // The count of replays the enabled folders hold, which is what the
    // backfill would read. Redrawn whenever the tree changes.
    const renderRoots = () => {
      const F = deps.folders;
      el('setup-roots').textContent = F.summary();
      const n = total();
      const hint = el('setup-history-hint');
      if (hint) {
        hint.textContent = n
          ? `${n.toLocaleString()} replay${n === 1 ? '' : 's'} in the folders you kept on. Runs in the background; you can play while it works.`
          : 'No replays found in the folders you kept on. New games still show up as you play them.';
      }
      const filterRow = el('setup-only1v1-row');
      if (filterRow) {
        filterRow.hidden = n < ONLY_1V1_SUGGEST_AT;
        if (!filterRow.hidden) {
          el('setup-only1v1-hint').textContent =
            `Reading all ${n.toLocaleString()} replays takes hours. This skips ` +
            'team, FFA and custom games; the switch stays in Settings.';
        }
      }
    };

    const show = (i) => {
      step = Math.max(0, Math.min(STEPS.length - 1, i));
      const id = STEPS[step];
      for (const s of STEPS) {
        const pane = el(`setup-step-${s}`);
        if (pane) pane.hidden = s !== id;
      }
      sheet().querySelectorAll('.wiz-step').forEach((b) => {
        const k = STEPS.indexOf(b.dataset.step);
        b.classList.toggle('is-active', k === step);
        b.classList.toggle('is-done', k < step);
        b.setAttribute('aria-current', k === step ? 'step' : 'false');
      });
      el('setup-back').hidden = step === 0;
      el('setup-next').hidden = step === STEPS.length - 1;
      el('setup-start').hidden = step !== STEPS.length - 1;
      syncNext();
      // Reading the recent headers takes a second or two, so it starts the
      // first time the step is reached rather than on Start.
      if (id === 'you' && !pickerStarted) {
        pickerStarted = true;
        deps.picker.refresh();
      }
      if (id === 'history') renderRoots();
      const body = sheet().querySelector('.sheet-body');
      if (body) body.scrollTop = 0;
    };

    // Step 1 cannot be left without the acknowledgement. Nothing else gates.
    const syncNext = () => {
      const gated = step === 0 && !el('setup-accept').checked;
      el('setup-next').disabled = gated;
      el('setup-next').title = gated ? 'Tick the box above first' : '';
    };

    const close = async () => {
      sheet().hidden = true;
      try {
        await deps.invoke('mark_setup_done');
      } catch (e) {
        // Failing to write the marker means this screen comes back next launch.
        // Annoying, not broken, and worth saying out loud rather than silently
        // looping somebody through setup every time they start the app.
        deps.log(`could not record that setup is done: ${deps.errText(e)}`, 'warn');
      }
      if (deps.onDone) deps.onDone();
    };

    const wire = () => {
      el('setup-accept').addEventListener('change', syncNext);
      sheet().querySelectorAll('[data-site-page]').forEach((b) => {
        b.addEventListener('click', async () => {
          try {
            await deps.invoke('open_site_page', { page: b.dataset.sitePage });
          } catch (e) {
            deps.log(`could not open that page: ${deps.errText(e)}`, 'err');
          }
        });
      });

      // The rail is clickable backwards. Forwards goes through Next, so the
      // acknowledgement cannot be walked around.
      sheet().querySelectorAll('.wiz-step').forEach((b) => {
        b.addEventListener('click', () => {
          const k = STEPS.indexOf(b.dataset.step);
          if (k <= step) show(k);
        });
      });

      el('setup-back').addEventListener('click', () => show(step - 1));
      el('setup-next').addEventListener('click', () => {
        if (el('setup-next').disabled) return;
        show(step + 1);
      });

      el('setup-folder').addEventListener('click', async () => {
        let dir;
        try {
          dir = await window.__TAURI__.dialog.open({ directory: true });
        } catch (e) {
          deps.log(`could not open the folder picker: ${deps.errText(e)}`, 'err');
          return;
        }
        if (!dir) return;
        await deps.folders.add(dir);
        renderRoots();
      });

      el('setup-start').addEventListener('click', async () => {
        el('setup-start').disabled = true;

        try {
          await deps.invoke('accept_terms', { version: POLICY_VERSION });
        } catch (e) {
          deps.log(`could not record the acceptance: ${deps.errText(e)}`, 'warn');
        }

        // The W3Champions switch, through the binary rather than around it.
        // Read back what Rust reports rather than what the box says, so a
        // refused write cannot leave the app polling a service it was told not
        // to touch.
        const wantW3c = el('setup-w3c').checked;
        try {
          const actual = await deps.invoke('set_w3c_enabled', { enabled: wantW3c });
          deps.onW3cChange(actual);
          if (actual) deps.log('W3Champions lookups on. Off any time in Settings.', 'ok');
        } catch (e) {
          deps.log(`could not change the W3Champions setting: ${deps.errText(e)}`, 'err');
        }

        // The 1v1 filter, only when its row was actually shown. On a small
        // library nothing is written and the default of reading everything
        // stands. Written before the backfill starts, because the backfill
        // reads the setting at the start of its run.
        const filterRow = el('setup-only1v1-row');
        if (filterRow && !filterRow.hidden) {
          try {
            await deps.invoke('set_only_1v1_enabled', { enabled: el('setup-only1v1').checked });
            if (deps.onOnly1v1Set) deps.onOnly1v1Set();
          } catch (e) {
            deps.log(`could not change the 1v1 filter: ${deps.errText(e)}`, 'err');
          }
        }

        // Backfill last, because it is the long-running one and everything
        // above it changes what it produces. The identity was set the moment
        // a card was clicked, so every game it reads has a seat to score from.
        if (el('setup-history-all').checked) deps.startBackfill();

        await close();
        el('setup-start').disabled = false;
      });
    };

    wire();

    return {
      // Shown only when the marker is absent. Anything that goes wrong reading
      // it counts as "already set up": a broken check must not put a setup
      // screen in front of an existing user.
      async maybeShow () {
        let done = true;
        try {
          done = await deps.invoke('setup_done');
        } catch (e) {
          deps.log(`could not check setup state: ${deps.errText(e)}`, 'warn');
        }
        if (done) return false;
        // The tree and the picker mount here rather than at boot, so a machine
        // that is already set up never builds a screen nobody will see.
        deps.folders.mount(el('setup-folders'), { compact: true });
        deps.picker.mount(el('setup-who'));
        renderRoots();
        show(0);
        sheet().hidden = false;
        el('setup-accept').focus();
        return true;
      },
      get open () { return !sheet().hidden; },
      renderRoots
    };
  };
})();
