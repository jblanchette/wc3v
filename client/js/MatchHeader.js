// Replay-derived strings (player names, hero names, unit/upgrade
// displayNames, itemIds) reach this file via the parsed wc3v JSON.
// Everything that flows into innerHTML must go through these helpers
// — see Security.js. Same conventions as BuildOrderRenderer.
const _mhEsc  = (s) => Security.escapeHtml(Security.sanitizeUserText(s));
const _mhAttr = (s) => Security.escapeAttr(Security.sanitizeUserText(s));
const _mhIcon = (id) => /^[A-Za-z0-9_\-]{1,32}$/.test(String(id == null ? '' : id)) ? id : '';

const MatchHeader = class {
  constructor (viewer) {
    this.viewer = viewer;
    this.boData = new BuildOrderData();
    this.el = document.getElementById('match-header');
  }

  render () {
    if (!this.el) return;

    this.renderMapInfo();
    this.renderMatchup();

    this.el.style.display = '';
  }

  cleanMapName (raw) {
    return raw
      .replace(/\.w3[xm]$/i, '')           // strip extension
      .replace(/_/g, ' ')                    // underscores to spaces
      .replace(/[-\s]v\d+[-.]?\d*/gi, '')    // strip version suffixes like -v2-0, v1.3
      .replace(/\s+\d+$/, '')                // strip trailing numbers
      .replace(/([a-z])([A-Z])/g, '$1 $2')  // camelCase to spaces
      .trim();
  }

  renderMapInfo () {
    const nameEl = document.getElementById('map-name-overlay');
    if (!nameEl) return;
    const raw = (this.viewer.mapInfo && this.viewer.mapInfo.name) || this.viewer.mapName || '';
    // textContent assignment — no escape needed, but cap length and
    // strip control/bidi chars so a malicious map name can't pretend to
    // be UI text.
    nameEl.textContent = Security.sanitizeUserText(this.cleanMapName(raw), { maxLen: 64 });
  }

  // Live dominance badge update — driven by DominanceBar.update() each time
  // the displayed score changes. `color` is a CSS var token (bracket color).
  setDominance (playerId, text, color) {
    if (!this.el) return;
    const pid = String(playerId == null ? '' : playerId).replace(/\D/g, '');
    if (!pid) return;
    const el = this.el.querySelector('.mh-dominance[data-player-id="' + pid + '"]');
    if (!el) return;
    el.textContent = text;
    el.style.color = color;
    el.hidden = false;
  }

  renderMatchup () {
    const { buildOrderPlayers } = this.viewer;
    if (!buildOrderPlayers || buildOrderPlayers.length < 2) return;

    const leftEl = this.el.querySelector('.mh-player-left');
    const rightEl = this.el.querySelector('.mh-player-right');

    leftEl.innerHTML = this.renderPlayerCard(this.boData.processBuildOrderData(buildOrderPlayers[0]), buildOrderPlayers[0]);
    rightEl.innerHTML = this.renderPlayerCard(this.boData.processBuildOrderData(buildOrderPlayers[1]), buildOrderPlayers[1]);
  }

  _sectionToggle (uid, sectionKey, label, extraToggleClass) {
    // uid is already restricted to [A-Za-z0-9_] by callers (see uid=
    // displayName.replace(/\W/g, '')) so toggleId/contentId are safe to
    // interpolate into JS string context. label is the only free-text
    // input; escape for HTML body context.
    const toggleId = `mh-${sectionKey}-toggle-${uid}`;
    const contentId = `mh-${sectionKey}-content-${uid}`;
    const cls = `mh-section-toggle ${extraToggleClass || ''}`.trim();
    const toggle = `<div class="${cls}" id="${toggleId}" onclick="document.getElementById('${contentId}').classList.toggle('mh-hidden');this.classList.toggle('mh-open')">${_mhEsc(label)}</div>`;
    const contentOpen = `<div class="mh-section-content mh-hidden" id="${contentId}">`;
    return { toggle, contentOpen, contentClose: '</div>' };
  }

  renderPlayerCard (boData, player) {
    const { race, raceInfo, displayName, rawDisplayName, playerColor, tierProduction, tier2Time, tier3Time, hasExpansion, finalSnapshot } = boData;
    // Strip non-word chars then cap — produces a safe DOM id slug.
    const uid = String(displayName == null ? '' : displayName).replace(/\W/g, '').slice(0, 32) || 'p';
    // The header shows the official pro name (like everywhere else), but —
    // and this is the ONE place in the UI that does this — when the player
    // logged in under a different handle we expose the raw replay name in a
    // hover tooltip. See PlayerNames.js.
    const showRawTip = rawDisplayName && rawDisplayName !== displayName;
    const nameTitleAttr = showRawTip ? ` title="${_mhAttr(rawDisplayName)}"` : '';

    // Build name from build context (if this player's slot has a matching build)
    const ctxBySlot = this.viewer.buildContextBySlot;
    const ctx = (ctxBySlot && player) ? ctxBySlot[String(player.playerId)] : null;
    const buildLabel = (ctx && ctx.name) ? ctx.name : 'Off Meta';
    const buildNameHtml = `<div class="mh-build-name">${_mhEsc(buildLabel)}</div>`;

    const raceIconId = _mhIcon(BuildOrderData.CONFIG.raceStarterIcons[race] || '');
    // Dominance badge — hidden until DominanceBar pushes live scores into it
    // via setDominance() (1v1 + dominance.available only). playerId is
    // numeric-ish from the parser; sanitize to digits for the attribute.
    const domPid = String(player && player.playerId != null ? player.playerId : '').replace(/\D/g, '');
    const domBadge = `<span class="mh-dominance" data-player-id="${domPid}" title="Dominance (50 = even)" hidden></span>`;
    let html = `<div class="mh-player-header">
      <div class="mh-player-header-text">
        <div class="mh-player-name"${nameTitleAttr} style="color:${_mhAttr(playerColor)}">${_mhEsc(displayName)}</div>${buildNameHtml}
      </div>
      ${domBadge}
      <img class="mh-race-icon-lg" src="/assets/wc3icons/${raceIconId}.jpg" title="${_mhAttr(raceInfo.label)}" style="border-color:${_mhAttr(raceInfo.accent)}" />
    </div>`;

    // Hero + Upgrade inline row (always visible)
    const { heroes } = tierProduction;
    html += '<div class="mh-hero-upgrades">';

    if (heroes && heroes.length) {
      html += '<div class="mh-heroes">';
      heroes.forEach(hero => {
        let spellsHtml = '';
        if (hero.spellList && hero.spellList.length) {
          hero.spellList.forEach(spell => {
            const learned = hero.learnedSkills && hero.learnedSkills[spell.itemId];
            if (!learned || learned.level === 0) return;
            const lvl = Number(learned.level) || 0;
            spellsHtml += `<span class="mh-spell" title="${_mhAttr(spell.displayName)} Lv${lvl}">
              <img class="mh-spell-icon" src="/assets/wc3icons/${_mhIcon(spell.itemId)}.jpg" /><span class="mh-spell-level">${lvl}</span></span>`;
          });
        }

        const heroLvl = Number(hero.level) || 0;
        html += `<div class="mh-hero">
          <div class="mh-hero-portrait-wrap">
            <img class="mh-hero-portrait" src="/assets/wc3icons/${_mhIcon(hero.itemId)}.jpg" title="${_mhAttr(hero.displayName)}" />
            <span class="mh-hero-level">${heroLvl}</span>
          </div>
          <div class="mh-hero-spells">${spellsHtml}</div>
        </div>`;
      });
      html += '</div>';
      html += '<div class="mh-hu-divider"></div>';
    }

    {
      html += '<div class="mh-upgrades-inline">';
      const maxTier = tier3Time !== Infinity ? 3 : tier2Time !== Infinity ? 2 : 1;
      const expoHtml = hasExpansion
        ? `<span class="mh-expansion-marker mh-expanded" title="Expanded">✔ Expo</span>`
        : `<span class="mh-expansion-marker mh-no-expo" title="No expansion">✘ No Expo</span>`;
      html += `<div class="mh-status-compact">${expoHtml}<span class="mh-tier-max t${maxTier}">T${maxTier}</span></div>`;

      if (finalSnapshot) {
        const upgrades = finalSnapshot.upgrades;
        const hasAtk = upgrades && Object.keys(upgrades.attack).length > 0;
        const hasDef = upgrades && Object.keys(upgrades.defense).length > 0;
        const hasRes = upgrades && upgrades.researched.length > 0;
        if (hasAtk || hasDef || hasRes) {
          let rowHtml = '';
          if (hasAtk) {
            let atkBadges = '';
            Object.values(upgrades.attack).forEach(upg => {
              const iconId = _mhIcon(upg.icon);
              const iconSrc = iconId ? `/assets/wc3icons/${iconId}.jpg` : '';
              const upgLvl = Number(upg.level) || 0;
              atkBadges += `<span class="mh-info-badge atk" title="${_mhAttr(upg.displayName)} ${upgLvl}"><img class="mh-info-icon" src="${iconSrc}" onerror="this.style.display='none'" /><span class="mh-upgrade-level">${upgLvl}</span></span>`;
            });
            rowHtml += `<span class="mh-info-segment"><span class="mh-info-label">ATK</span>${atkBadges}</span>`;
          }
          if (hasDef) {
            let defBadges = '';
            Object.values(upgrades.defense).forEach(upg => {
              const iconId = _mhIcon(upg.icon);
              const iconSrc = iconId ? `/assets/wc3icons/${iconId}.jpg` : '';
              const upgLvl = Number(upg.level) || 0;
              defBadges += `<span class="mh-info-badge def" title="${_mhAttr(upg.displayName)} ${upgLvl}"><img class="mh-info-icon" src="${iconSrc}" onerror="this.style.display='none'" /><span class="mh-upgrade-level">${upgLvl}</span></span>`;
            });
            rowHtml += `<span class="mh-info-segment"><span class="mh-info-label">DEF</span>${defBadges}</span>`;
          }
          if (hasRes) {
            let resBadges = '';
            upgrades.researched.forEach(r => {
              const iconId = _mhIcon(r.icon || r.itemId);
              const iconSrc = iconId ? `/assets/wc3icons/${iconId}.jpg` : '';
              const rLvl = Number(r.level) || 0;
              const lvl = rLvl > 1 ? ` ${rLvl}` : '';
              resBadges += `<span class="mh-info-upgrade"><img class="mh-info-icon" src="${iconSrc}" title="${_mhAttr(r.displayName)}${lvl}" onerror="this.style.display='none'" /></span>`;
            });
            rowHtml += `<span class="mh-info-segment"><span class="mh-info-label">RES</span>${resBadges}</span>`;
          }
          html += `<div class="mh-info-row">${rowHtml}</div>`;
        }

        const atkSet = {};
        const defSet = {};
        const { tierProd } = tierProduction;
        [1, 2, 3].forEach(t => {
          if (tierProd[t] && tierProd[t].units) {
            tierProd[t].units.forEach(u => {
              if (u.attackType && ATTACK_TYPES[u.attackType]) atkSet[u.attackType] = 1;
              if (u.armorType && ARMOR_TYPES[u.armorType]) defSet[u.armorType] = 1;
            });
          }
        });

        // ATTACK_TYPES / ARMOR_TYPES are trusted constant tables, but
        // escape defensively so this stays safe if their shape changes.
        let typeLine = '';
        const atkIcons = Object.keys(atkSet).map(k => `<img class="mh-info-icon" src="${_mhAttr(ATTACK_TYPES[k].icon)}" title="${_mhAttr(ATTACK_TYPES[k].label)} attack" />`).join('');
        if (atkIcons) typeLine += `<span class="mh-info-segment"><span class="mh-info-label">ATK</span>${atkIcons}</span>`;
        const defIcons = Object.keys(defSet).map(k => `<img class="mh-info-icon" src="${_mhAttr(ARMOR_TYPES[k].icon)}" title="${_mhAttr(ARMOR_TYPES[k].label)} armor" />`).join('');
        if (defIcons) typeLine += `<span class="mh-info-segment"><span class="mh-info-label">DEF</span>${defIcons}</span>`;
        if (typeLine) html += `<div class="mh-info-row">${typeLine}</div>`;
      }
      html += '</div>';
    }

    html += '</div>';

    // 3. ARMY & ITEMS — collapsible
    {
      const sec = this._sectionToggle(uid, 'unit', 'Army & Items', 'mh-unit-toggle');
      html += sec.toggle + sec.contentOpen;

      // Army composition
      html += '<div class="mh-subsection-label">Army</div>';
      html += '<div class="mh-unit-flat">';
      if (finalSnapshot && finalSnapshot.army && finalSnapshot.army.length) {
        finalSnapshot.army.forEach(u => {
          const c = Number(u.count) || 0;
          const countBadge = c > 1 ? `<span class="mh-unit-count">${c}</span>` : '';
          html += `<span class="mh-icon-wrap">
            <span class="mh-portrait-wrap"><img class="mh-tech-icon" src="/assets/wc3icons/${_mhIcon(u.itemId)}.jpg" title="${_mhAttr(u.displayName)}" />${countBadge}</span>
          </span>`;
        });
      } else {
        html += '<span class="mh-tier-empty">— No units</span>';
      }
      html += '</div>';

      // Item summary
      const itemStream = player.itemStream;
      if (itemStream && (itemStream.purchases.length || itemStream.uses.length)) {
        html += '<div class="mh-subsection-label">Items</div>';
        html += '<div class="mh-item-summary">';

        if (itemStream.purchases.length) {
          html += '<div class="mh-item-row">';
          itemStream.purchases.forEach(p => {
            const c = Number(p.count) || 0;
            const goldSpent = Number(p.goldSpent) || 0;
            const countBadge = c > 1 ? `<span class="mh-unit-count">${c}</span>` : '';
            const goldTip = goldSpent ? ` (${goldSpent}g)` : '';
            html += `<span class="mh-icon-wrap">
              <span class="mh-portrait-wrap mh-item-portrait"><img class="mh-tech-icon" src="/assets/wc3icons/${_mhIcon(p.itemId)}.jpg" title="${_mhAttr(p.displayName)} x${c}${goldTip}" onerror="this.parentElement.parentElement.style.display='none'" />${countBadge}</span>
            </span>`;
          });
          html += '</div>';
        }

        // Total gold spent on items
        const totalGold = itemStream.purchases.reduce((sum, p) => sum + (Number(p.goldSpent) || 0), 0);
        if (totalGold > 0) {
          html += `<div class="mh-item-gold-total"><span class="mh-cost-gold-icon"></span>${totalGold}g spent on items</div>`;
        }

        html += '</div>';
      }

      // Mercenary hires
      const mercEvents = (player.eventStream || []).filter(e => e.key === 'hireMercenary');
      if (mercEvents.length) {
        html += '<div class="mh-subsection-label">Mercenaries</div>';
        html += '<div class="mh-unit-flat">';
        // Group by unit type
        const mercCounts = {};
        mercEvents.forEach(e => {
          const id = e.unit.itemId;
          if (!mercCounts[id]) mercCounts[id] = { itemId: id, displayName: e.unit.displayName, count: 0, goldSpent: 0 };
          mercCounts[id].count++;
          mercCounts[id].goldSpent += e.goldCost || 0;
        });
        Object.values(mercCounts).forEach(m => {
          const c = Number(m.count) || 0;
          const goldSpent = Number(m.goldSpent) || 0;
          const countBadge = c > 1 ? `<span class="mh-unit-count">${c}</span>` : '';
          const goldTip = goldSpent ? ` (${goldSpent}g)` : '';
          html += `<span class="mh-icon-wrap">
            <span class="mh-portrait-wrap mh-merc-portrait"><img class="mh-tech-icon" src="/assets/wc3icons/${_mhIcon(m.itemId)}.jpg" title="${_mhAttr(m.displayName)} x${c}${goldTip}" onerror="this.parentElement.parentElement.style.display='none'" />${countBadge}</span>
          </span>`;
        });
        html += '</div>';
      }

      html += sec.contentClose;
    }

    // Base Layout button — opens the same placement viewer modal as the
    // build-order panel's Base button. playerId is coerced to a number to
    // keep this inline-handler interpolation safe. Hidden on mobile, where
    // the modal's canvas + 3D renderer are never set up.
    const pid = Number(player && player.playerId);
    if (Number.isFinite(pid) && !this.viewer.mobileMode) {
      html += `<div class="mh-base-btn" onclick="wc3v.showPlacementViewer(${pid})" title="View base layout">Base Layout</div>`;
    }

    return html;
  }

  updateLayoutMode (mode) {
    // no-op — toolbar removed, map name overlay hidden via CSS in static-bo mode
  }
};

window.MatchHeader = MatchHeader;
