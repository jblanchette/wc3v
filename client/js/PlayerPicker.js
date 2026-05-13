(function () {
// PlayerPicker — modal that asks the user "Which player are you?" and
// returns the chosen slot. Used in two places:
//   1. Post-upload, before navigation, so the IDB record is tagged with the
//      correct userSlot before any compare runs.
//   2. From the compare screen via "Switch player", to swap between players
//      in the same replay (e.g., when the auto-pick chose the opponent).
//
// Pure data input: takes the parsed wc3v JSON (or a list of {slot, name, race,
// heroName, heroItemId}) and resolves with the chosen slot string.

const RACE_LABEL = { H: 'Human', O: 'Orc', E: 'Night Elf', U: 'Undead', R: 'Random' };
const RACE_BADGE = { H: 'HU', O: 'ORC', E: 'NE', U: 'UD', R: '?' };

const heroRaceFromItemId = (itemId) => {
  if (!itemId) return null;
  const c = String(itemId).charAt(0);
  if (c === 'H' || c === 'O' || c === 'E' || c === 'U' || c === 'N') return c;
  return null;
};

// Walk the parsed wc3v JSON to find the first race-compatible hero per slot.
// Returns an array of { slot, name, race, heroName, heroItemId }.
const buildPlayerCards = (parsed) => {
  const cards = [];
  if (!parsed || !parsed.players) return cards;
  const replayPlayers = (parsed.replay && parsed.replay.players) || {};
  for (const slot of Object.keys(parsed.players)) {
    const p = parsed.players[slot];
    if (!p || p.isNeutralPlayer) continue;
    const slotNum = parseInt(slot, 10);
    if (slotNum >= 24) continue;
    const replayP = replayPlayers[slot] || {};
    const race = p.race || replayP.raceDetected || 'R';
    // Show the official pro name (PlayerNames.js) — the picker only needs
    // a label; the raw replay handle is surfaced in the match header.
    const name = PlayerNames.canonical(replayP.name) || `Player ${slot}`;
    let heroName = null, heroItemId = null;
    for (const ev of (p.eventStream || [])) {
      // Tavern heroes are emitted as 'makeTavernHero' (not 'addUnit') because
      // server-side addPlayerUnit is called with ignoreEvent=true. Treat both.
      const isHeroEvent = ev.unit && (
        (ev.key === 'addUnit' && ev.unit.isHero) ||
        ev.key === 'makeTavernHero'
      );
      if (!isHeroEvent) continue;
      const heroRace = heroRaceFromItemId(ev.unit.itemId);
      if (heroRace && heroRace !== 'N' && race && heroRace !== race) continue;
      heroName = ev.unit.displayName || null;
      heroItemId = ev.unit.itemId || null;
      break;
    }
    cards.push({ slot: String(slot), name, race, heroName, heroItemId });
  }
  cards.sort((a, b) => parseInt(a.slot, 10) - parseInt(b.slot, 10));
  return cards;
};

// Aliases into client/js/Security.js. Replay-derived player + hero names
// also flow through sanitizeUserText for control-char and length defense.
const escapeHtml = Security.escapeHtml;
const escapeAttr = Security.escapeAttr;
const safePlayerName = (s) => Security.escapeHtml(Security.sanitizeUserText(s, { maxLen: 40 }));

const PlayerPicker = class {
  // open({ parsed, headline, currentSlot }) → Promise<slot|null>
  // - parsed: full wc3v JSON; OR pass {cards:[...]} directly to skip extraction
  // - headline: top-of-modal text ("Which player are you?")
  // - currentSlot: pre-highlight a slot (used for "Switch player")
  // Resolves with the chosen slot string, or null if the user closed without
  // picking. The picker is NOT dismissable except by clicking a player card
  // OR (when allowCancel=true) by Esc/backdrop.
  static open ({ parsed, cards, headline, subhead, currentSlot = null, allowCancel = true } = {}) {
    return new Promise((resolve) => {
      const list = (Array.isArray(cards) && cards.length) ? cards : buildPlayerCards(parsed);
      if (!list.length) { resolve(null); return; }

      const root = document.createElement('div');
      root.className = 'pp-modal';
      root.innerHTML = `
        <div class="pp-backdrop"></div>
        <div class="pp-card" role="dialog" aria-modal="true" aria-labelledby="pp-title">
          <div class="pp-head">
            <h2 class="pp-title" id="pp-title">${escapeHtml(headline || 'Which player are you?')}</h2>
            ${subhead ? `<div class="pp-sub">${escapeHtml(subhead)}</div>` : ''}
            ${allowCancel ? `<button class="pp-close" type="button" aria-label="Close">×</button>` : ''}
          </div>
          <div class="pp-grid">
            ${list.map(c => {
              const heroIcon = c.heroItemId ? `/assets/wc3icons/${encodeURIComponent(c.heroItemId)}.jpg` : '';
              const isCurrent = currentSlot != null && String(currentSlot) === String(c.slot);
              return `
                <button class="pp-player ${isCurrent ? 'pp-player-current' : ''}" data-slot="${escapeAttr(c.slot)}" type="button">
                  <div class="pp-player-top">
                    <span class="pp-race-badge race-${escapeAttr(c.race)}">${escapeHtml(RACE_BADGE[c.race] || c.race || '?')}</span>
                    <span class="pp-player-name">${safePlayerName(c.name || '?')}</span>
                  </div>
                  <div class="pp-player-mid">
                    ${heroIcon ? `<img class="pp-hero-portrait" src="${escapeAttr(heroIcon)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"/>` : '<div class="pp-hero-portrait pp-hero-blank"></div>'}
                    <div class="pp-hero-meta">
                      <div class="pp-hero-race">${escapeHtml(RACE_LABEL[c.race] || c.race || 'Unknown')}</div>
                      <div class="pp-hero-name">${safePlayerName(c.heroName || 'No hero detected')}</div>
                    </div>
                  </div>
                  ${isCurrent ? '<div class="pp-current-tag">Current pick</div>' : '<div class="pp-pick-tag">Pick this player</div>'}
                </button>
              `;
            }).join('')}
          </div>
          <div class="pp-foot">
            ${allowCancel ? '<span class="pp-foot-hint">You can change this later from the compare screen.</span>' : '<span class="pp-foot-hint">You must pick a player to continue.</span>'}
          </div>
        </div>
      `;
      document.body.appendChild(root);

      const cleanup = () => {
        try { root.remove(); } catch (e) {}
        document.removeEventListener('keydown', onKey);
      };
      const finish = (slot) => { cleanup(); resolve(slot); };

      root.querySelectorAll('.pp-player').forEach(btn => {
        btn.addEventListener('click', () => finish(btn.dataset.slot));
      });
      const close = root.querySelector('.pp-close');
      if (close) close.addEventListener('click', () => finish(null));
      const backdrop = root.querySelector('.pp-backdrop');
      if (backdrop && allowCancel) backdrop.addEventListener('click', () => finish(null));
      const onKey = (e) => { if (e.key === 'Escape' && allowCancel) finish(null); };
      document.addEventListener('keydown', onKey);
    });
  }
};

if (typeof window !== 'undefined') {
  window.PlayerPicker = PlayerPicker;
  window.PlayerPicker.buildCards = buildPlayerCards;
}
})();
