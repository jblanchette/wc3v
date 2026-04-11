const DisplayModes = {
  neutralCamp: 0
};

// Representative icons for WC3 random item drops (Y{class}I{level})
// class: i=Any, j=Permanent, k=Charged, o=Powerup
const RANDOM_ITEM_ICONS = {
  // Charged items (k) — scrolls, wands, potions with charges
  'YkI1': 'phea',   // Lv1: Potion of Healing
  'YkI2': 'pman',   // Lv2: Potion of Mana
  'YkI3': 'rej3',   // Lv3: Replenishment Potion
  'YkI4': 'shas',   // Lv4: Scroll of Speed
  'YkI5': 'pinv',   // Lv5: Potion of Invulnerability
  'YkI6': 'ankh',   // Lv6: Ankh of Reincarnation
  // Permanent items (j) — stat items, orbs, armor
  'YjI1': 'rde1',   // Lv1: Ring of Protection +2
  'YjI2': 'rst1',   // Lv2: Gauntlets of Strength +3
  'YjI3': 'rlif',   // Lv3: Ring of Regeneration
  'YjI4': 'ofir',   // Lv4: Orb of Fire
  'YjI5': 'ckng',   // Lv5: Crown of Kings
  'YjI6': 'modt',   // Lv6: Medallion of Courage
  // Any items (i) — can be any class
  'YiI1': 'phea',   // Lv1
  'YiI2': 'rde1',   // Lv2
  'YiI3': 'rej3',   // Lv3
  'YiI4': 'ofir',   // Lv4
  'YiI5': 'ckng',   // Lv5
  'YiI6': 'modt',   // Lv6
  // Powerup items (o) — tomes, runes
  'YoI1': 'tpow',   // Lv1
  'YoI2': 'tpow',   // Lv2
  'YoI3': 'tpow',   // Lv3
};

const boxDesignSize = {
  width: 260,
  height: 320
};

const GameDisplayBox = class {
  constructor (teamColorMap, playerColorMap) {
    this.box = document.getElementById("game-display-box");
    this.mode = DisplayModes.neutralCamp;
    this.teamColorMap = teamColorMap;
    this.playerColorMap = playerColorMap;

    this.data = null;
    this.hoveredCampUuid = null;
  }

  setData (data, handlerFn) {
    this.data = handlerFn(data);
  }

  handleMouse (e, transform) {
    if (!this.data || !this.data.tree) {
      return;
    }

    if (!e || !transform) {
      return;
    }

    const { offsetX, offsetY, target } = e;

    if (offsetX === undefined || offsetY === undefined) {
      return;
    }

    // convert CSS pixels to canvas pixels, then inverse-transform to canvas-space
    const scaleX = target.width / (target.clientWidth || target.width);
    const scaleY = target.height / (target.clientHeight || target.height);
    const screenX = offsetX * scaleX;
    const screenY = offsetY * scaleY;
    const canvasX = (screenX - transform.x) / transform.k;
    const canvasY = (screenY - transform.y) / transform.k;

    const hitBox = {
      minX: canvasX,
      maxX: canvasX,
      minY: canvasY,
      maxY: canvasY
    };

    const searchHits = this.data.tree.search(hitBox);
    if (searchHits.length) {
      const searchHit = searchHits[0];
      const campUuid = searchHit.rawGroup.uuid;

      // same camp already shown, just update cursor
      if (this.hoveredCampUuid === campUuid) {
        document.body.style.cursor = 'pointer';
        return;
      }

      this.hoveredCampUuid = campUuid;
      document.body.style.cursor = 'pointer';

      // position the popup — keep within canvas bounds
      const drawBounds = target.getBoundingClientRect();
      const canvasW = drawBounds ? drawBounds.width : target.clientWidth;
      const canvasH = drawBounds ? drawBounds.height : target.clientHeight;
      const popW = boxDesignSize.width;
      const popH = boxDesignSize.height;
      const gap = 12;

      let popX = offsetX + gap;
      let popY = offsetY + gap;

      // flip horizontally if overflows right
      if (popX + popW > canvasW) {
        popX = offsetX - popW - gap;
      }
      // clamp to left edge
      if (popX < 0) {
        popX = gap;
      }

      // flip vertically if overflows bottom
      if (popY + popH > canvasH) {
        popY = offsetY - popH - gap;
      }
      // clamp to top edge
      if (popY < 0) {
        popY = gap;
      }

      this.box.style.left = `${popX}px`;
      this.box.style.top = `${popY}px`;

      try {
        this.render(searchHit);
      } catch (err) {
        this.box.innerHTML = '<div style="padding:10px;color:#e05555;">Render error</div>';
      }

      requestAnimationFrame(() => {
        this.box.classList.add('visible');
      });

      return;
    }

    // no hit
    if (this.hoveredCampUuid) {
      this.hoveredCampUuid = null;
      this.hide();
    }

    if (document.body.style.cursor === 'pointer') {
      document.body.style.cursor = 'default';
    }
  }

  render (item) {
    let renderContents = "";

    switch (this.mode) {
      case DisplayModes.neutralCamp:
        renderContents = GameDisplayBox.renderNeutralCamp(item, this.teamColorMap, this.playerColorMap);
      break;
      default:
        renderContents = "";
    }

    this.box.innerHTML = renderContents;
  }

  hide () {
    this.hoveredCampUuid = null;
    this.box.classList.remove('visible');
  }

  static getLevelClass (level) {
    if (level <= 5) return 'easy';
    if (level <= 8) return 'medium';
    return 'hard';
  }

  static getLevelColor (level) {
    if (level <= 5) return '#00c850';
    if (level <= 8) return '#ff8c00';
    return '#e02020';
  }

  static getDifficultyClass (totalLevel) {
    if (totalLevel <= 9) return 'green';
    if (totalLevel <= 19) return 'yellow';
    return 'red';
  }

  static titleCase (str) {
    return str.replace(/\b\w/g, c => c.toUpperCase());
  }

  static renderCreepList (units) {
    const sorted = units.slice().sort((a, b) => {
      const levelA = (a.balanceInfo && a.balanceInfo.level) || 0;
      const levelB = (b.balanceInfo && b.balanceInfo.level) || 0;
      return levelB - levelA;
    });

    const hidden = sorted.length > 5 ? sorted.length - 5 : 0;
    const visible = sorted.slice(0, 5);

    const rows = visible.map(unit => {
      const level = (unit.balanceInfo && unit.balanceInfo.level) || '?';
      const rawName = unit.displayName || unit.itemId || 'Unknown';
      const name = GameDisplayBox.titleCase(rawName);
      const levelClass = GameDisplayBox.getLevelClass(+level);
      const levelColor = GameDisplayBox.getLevelColor(+level);
      const itemId = unit.itemId || '';
      const hasDrops = unit.droppedItemSets && unit.droppedItemSets.length > 0;
      const dropClass = hasDrops ? ' camp-creep-has-drops' : '';
      const dropIndicator = hasDrops
        ? '<span class="camp-drop-indicator" title="Drops items">&#9679;</span>'
        : '';

      return `
        <li class="camp-creep-row${dropClass}">
          <span class="camp-creep-name-wrap">
            <img class="camp-creep-icon" src="/assets/wc3icons/${itemId}.jpg" onerror="this.style.display='none'" />
            <span class="camp-creep-name">${name}</span>
          </span>
          <span class="camp-creep-level ${levelClass}" style="border-left: 3px solid ${levelColor}">Lv ${level}${dropIndicator}</span>
        </li>
      `;
    }).join('');

    const moreStr = hidden > 0
      ? `<li class="camp-creep-more">+${hidden} more</li>`
      : '';

    return `<ul class="camp-creep-list">${rows}${moreStr}</ul>`;
  }

  static renderProgressBar (completionEstimate, contributions, teamColorMap) {
    const pct = Math.round((completionEstimate || 0) * 100);
    if (pct <= 0) return '';

    // build segments from contributions
    const teamIds = contributions ? Object.keys(contributions).filter(t => contributions[t] > 0.02) : [];
    let barInner = '';

    if (teamIds.length > 1) {
      const total = teamIds.reduce((s, t) => s + contributions[t], 0) || 1;
      const sorted = teamIds.sort((a, b) => contributions[b] - contributions[a]);
      barInner = sorted.map(tid => {
        const segPct = (contributions[tid] / total) * pct;
        const color = teamColorMap[tid] || '#888';
        return `<div class="camp-progress-seg" style="width:${segPct.toFixed(1)}%;background:${color}"></div>`;
      }).join('');
    } else {
      const color = teamIds.length ? (teamColorMap[teamIds[0]] || '#888') : '#6a7a90';
      barInner = `<div class="camp-progress-seg" style="width:${pct}%;background:${color}"></div>`;
    }

    return `
      <div class="camp-progress-wrap">
        <div class="camp-progress-track">${barInner}</div>
        <span class="camp-progress-label">${pct}%</span>
      </div>
    `;
  }

  static renderClaimInfo (rawGroup, teamColorMap, playerColorMap) {
    const { contributions, completionEstimate, uncontested } = rawGroup;
    const progressBar = GameDisplayBox.renderProgressBar(completionEstimate, contributions, teamColorMap);

    // state 0: untouched
    if (!rawGroup.claimers || rawGroup.claimState === 0) {
      return `
        <div class="camp-claim-info">
          <span class="camp-status-tag unclaimed">Untouched</span>
        </div>
      `;
    }

    // state 1: contested
    if (rawGroup.claimState === 1) {
      const timeStr = rawGroup.claimTime ? formatGameTime(rawGroup.claimTime) : '';

      return `
        <div class="camp-claim-info">
          <span class="camp-status-tag contested">Contested</span>
          ${progressBar}
          ${timeStr ? `<div class="camp-claim-row"><span>Time</span><span class="camp-claim-value">${timeStr}</span></div>` : ''}
        </div>
      `;
    }

    // state 2: cleared
    const playerSquares = [];
    const seenPlayers = new Set();
    const ownerTeamId = +rawGroup.claimOwnerId;

    if (rawGroup.claimers) {
      Object.keys(rawGroup.claimers).forEach(teamId => {
        if (+teamId !== ownerTeamId) return;
        const claimPlayers = rawGroup.claimers[teamId].players;
        if (!claimPlayers) return;
        Object.keys(claimPlayers).forEach(playerId => {
          if (seenPlayers.has(playerId)) return;
          seenPlayers.add(playerId);
          const color = playerColorMap[playerId];
          if (color) {
            playerSquares.push(`<span class="camp-spot-square" style="background-color: ${color}"></span>`);
          }
        });
      });
    }

    const orderStr = rawGroup.order ? `#${rawGroup.order}` : 'N/A';
    const timeStr = formatGameTime(rawGroup.claimTime);
    const uncontestedBadge = uncontested ? `<span class="camp-status-tag uncontested">Solo</span>` : '';

    return `
      <div class="camp-claim-info">
        <span class="camp-status-tag claimed">Cleared</span>
        ${uncontestedBadge}
        ${progressBar}
        <div class="camp-claim-row">
          <span>Order</span>
          <span class="camp-claim-value">${orderStr}</span>
        </div>
        <div class="camp-claim-row">
          <span>Time</span>
          <span class="camp-claim-value">${timeStr}</span>
        </div>
        <div class="camp-claim-row">
          <span>Cleared by</span>
          <span class="camp-claim-value">${playerSquares.join(' ')}</span>
        </div>
      </div>
    `;
  }

  static renderDropTable (units) {
    // collect all drops from all units, deduplicate by itemId
    const dropMap = {};
    (units || []).forEach(unit => {
      if (!unit.droppedItemSets) return;
      unit.droppedItemSets.forEach(drop => {
        if (!drop.itemId) return;
        const existing = dropMap[drop.itemId];
        if (!existing || drop.chance > existing.chance) {
          dropMap[drop.itemId] = drop;
        }
      });
    });

    const drops = Object.values(dropMap);
    if (!drops.length) return '';

    const icons = drops.slice(0, 8).map(drop => {
      const chanceStr = drop.chance < 100
        ? `<span class="camp-drop-chance">${drop.chance}%</span>`
        : '';
      const title = `${drop.displayName}${drop.chance < 100 ? ` (${drop.chance}%)` : ''}`;

      if (drop.isRandom) {
        const randomIcon = RANDOM_ITEM_ICONS[drop.itemId];
        return `
          <div class="camp-drop-icon-wrap camp-drop-random-wrap" title="${title}">
            ${randomIcon
              ? `<img class="camp-drop-icon camp-drop-random-icon" src="/assets/wc3icons/${randomIcon}.jpg" onerror="this.style.display='none'" />`
              : ''
            }
            <div class="camp-drop-random-label">${drop.displayName.replace('Random ', '')}</div>
            ${chanceStr}
          </div>
        `;
      }

      return `
        <div class="camp-drop-icon-wrap" title="${title}">
          <img class="camp-drop-icon" src="/assets/wc3icons/${drop.itemId}.jpg" onerror="this.parentElement.style.display='none'" />
          ${chanceStr}
        </div>
      `;
    }).join('');

    const moreStr = drops.length > 8 ? `<span class="camp-drop-more">+${drops.length - 8}</span>` : '';

    return `
      <div class="camp-drop-table">
        <span class="camp-drop-label">Potential Drops</span>
        <div class="camp-drop-list">${icons}${moreStr}</div>
      </div>
    `;
  }

  static renderNeutralCamp (camp, teamColorMap, playerColorMap) {
    const { rawGroup } = camp;

    const diffClass = GameDisplayBox.getDifficultyClass(rawGroup.totalLevel);
    const creepListStr = GameDisplayBox.renderCreepList(rawGroup.units);
    const dropTableStr = GameDisplayBox.renderDropTable(rawGroup.units);
    const claimInfoStr = GameDisplayBox.renderClaimInfo(rawGroup, teamColorMap, playerColorMap);

    return `
      <div class="camp-popup-header">
        <h3>Creep Camp</h3>
        <div class="camp-level-badge ${diffClass}">${rawGroup.totalLevel}</div>
      </div>
      ${creepListStr}
      ${dropTableStr}
      ${claimInfoStr}
    `;
  }

  static neutralCampHandler (gameScaler, transform) {
    const { xScale, yScale, middleX, middleY } = gameScaler;

    return (data) => {
      const groups = Object.values(data);
      const tree = new rbush();

      // store positions in canvas-space — handleMouse inverse-transforms mouse coords
      const groupBoxes = groups.reduce((acc, group) => {
        // use tight unitBounds for hover detection
        const b = group.unitBounds || group.bounds;

        const record = {
          rawGroup: group,

          minX: xScale(b.minX) + middleX,
          maxX: xScale(b.maxX) + middleX,

          minY: yScale(b.maxY) + middleY,
          maxY: yScale(b.minY) + middleY
        };

        acc.push(record);
        return acc;
      }, []);

      tree.load(groupBoxes);

      return {
        tree
      };
    };
  }
};

window.GameDisplayBox = GameDisplayBox;
