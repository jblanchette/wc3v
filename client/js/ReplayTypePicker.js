(function () {
// ReplayTypePicker — modal that asks the user, immediately after a parsed
// upload lands in IndexedDB, whether the replay is THEIR game (default,
// gets graded against pros) or a PRO REPLAY they're adding to the Pro
// Builds grid (so future uploads of their own games can be compared
// against it).
//
// Resolves with 'game' or 'reference' (the internal field name for the
// "this is a pro replay" branch is kept for compatibility). Closing the
// modal without a choice resolves with 'game' — that's the safe default.

const escapeHtml = Security.escapeHtml;

const ReplayTypePicker = class {
  static open ({ filename } = {}) {
    return new Promise((resolve) => {
      const root = document.createElement('div');
      root.className = 'rtp-modal';
      const fnLine = filename
        ? `<div class="rtp-filename">${escapeHtml(filename)}</div>`
        : '';
      root.innerHTML = `
        <div class="rtp-backdrop"></div>
        <div class="rtp-card" role="dialog" aria-modal="true" aria-labelledby="rtp-title">
          <div class="rtp-head">
            <h2 class="rtp-title" id="rtp-title">What is this replay?</h2>
            ${fnLine}
            <p class="rtp-sub">You can change this later from the replay's card.</p>
          </div>
          <div class="rtp-options">
            <button class="rtp-option rtp-option-game" type="button" data-choice="game">
              <div class="rtp-option-icon" aria-hidden="true">▶</div>
              <div class="rtp-option-body">
                <div class="rtp-option-title">It's my game</div>
                <div class="rtp-option-desc">
                  Goes into Your replays. You can compare it to a pro to
                  get a graded breakdown of your build, tech, macro, and
                  hero play.
                </div>
              </div>
              <div class="rtp-option-tag rtp-option-tag-default">Default</div>
            </button>
            <button class="rtp-option rtp-option-ref" type="button" data-choice="reference">
              <div class="rtp-option-icon" aria-hidden="true">★</div>
              <div class="rtp-option-body">
                <div class="rtp-option-title">It's a pro replay</div>
                <div class="rtp-option-desc">
                  Adds it to the Pro Builds grid alongside the curated
                  ones. Your future uploads can be graded against it —
                  drop in a Happy or Moon ladder game and your play
                  gets compared to theirs.
                </div>
              </div>
              <div class="rtp-option-tag rtp-option-tag-new">New</div>
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(root);

      const cleanup = () => {
        try { root.remove(); } catch {}
        document.removeEventListener('keydown', onKey);
      };
      const finish = (choice) => { cleanup(); resolve(choice); };

      root.querySelectorAll('.rtp-option').forEach(btn => {
        btn.addEventListener('click', () => finish(btn.dataset.choice));
      });
      const onKey = (e) => {
        // Esc/Enter pick the safe default. Tab nav handled by browser.
        if (e.key === 'Escape') finish('game');
        if (e.key === 'Enter') finish('game');
      };
      document.addEventListener('keydown', onKey);
    });
  }
};

if (typeof window !== 'undefined') window.ReplayTypePicker = ReplayTypePicker;
})();
