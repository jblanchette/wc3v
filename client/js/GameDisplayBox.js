const DisplayModes = {
  neutralCamp: 0
};

const boxDesignSize = {
  width: 300,
  height: 200
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

    if (transform.k != 1.0) {
      this.hoveredCampUuid = null;
      this.hide();
      return;
    }

    const { offsetX, offsetY, target } = e;

    if (offsetX === undefined || offsetY === undefined) {
      return;
    }

    // convert CSS pixels to canvas pixels when canvas is CSS-scaled
    const scaleX = target.width / (target.clientWidth || target.width);
    const scaleY = target.height / (target.clientHeight || target.height);
    const canvasX = offsetX * scaleX;
    const canvasY = offsetY * scaleY;

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

      // position the popup
      const drawBounds = target.getBoundingClientRect();
      let popX = offsetX + 12;
      let popY = offsetY + 12;

      if (drawBounds) {
        if (drawBounds.x + popX + boxDesignSize.width > drawBounds.right) {
          popX = offsetX - boxDesignSize.width - 12;
        }
        if (drawBounds.y + popY + boxDesignSize.height > drawBounds.bottom) {
          popY = offsetY - boxDesignSize.height - 12;
        }
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

    const rows = sorted.map(unit => {
      const level = (unit.balanceInfo && unit.balanceInfo.level) || '?';
      const rawName = unit.displayName || unit.itemId || 'Unknown';
      const name = GameDisplayBox.titleCase(rawName);
      const levelClass = GameDisplayBox.getLevelClass(+level);
      const levelColor = GameDisplayBox.getLevelColor(+level);
      const itemId = unit.itemId || '';

      return `
        <li class="camp-creep-row">
          <span class="camp-creep-name-wrap">
            <img class="camp-creep-icon" src="/assets/wc3icons/${itemId}.jpg" onerror="this.style.display='none'" />
            <span class="camp-creep-name">${name}</span>
          </span>
          <span class="camp-creep-level ${levelClass}" style="border-left: 3px solid ${levelColor}">Lv ${level}</span>
        </li>
      `;
    }).join('');

    return `<ul class="camp-creep-list">${rows}</ul>`;
  }

  static renderClaimInfo (rawGroup, teamColorMap, playerColorMap) {
    if (!rawGroup.claimers || rawGroup.claimState === 0) {
      return `
        <div class="camp-claim-info">
          <span class="camp-status-tag unclaimed">Unclaimed</span>
        </div>
      `;
    }

    if (rawGroup.claimState === 1) {
      return `
        <div class="camp-claim-info">
          <span class="camp-status-tag contested">Contested</span>
        </div>
      `;
    }

    // claimed — collect unique player colors for the owning team only
    const playerSquares = [];
    const seenPlayers = new Set();
    const ownerTeamId = +rawGroup.claimOwnerId;

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

    const orderStr = rawGroup.order ? `#${rawGroup.order}` : 'N/A';
    const timeStr = formatGameTime(rawGroup.claimTime);

    return `
      <div class="camp-claim-info">
        <span class="camp-status-tag claimed">Claimed</span>
        <div class="camp-claim-row">
          <span>Order</span>
          <span class="camp-claim-value">${orderStr}</span>
        </div>
        <div class="camp-claim-row">
          <span>Time</span>
          <span class="camp-claim-value">${timeStr}</span>
        </div>
        <div class="camp-claim-row">
          <span>Claimed by</span>
          <span class="camp-claim-value">${playerSquares.join(' ')}</span>
        </div>
      </div>
    `;
  }

  static renderNeutralCamp (camp, teamColorMap, playerColorMap) {
    const { rawGroup } = camp;

    const diffClass = GameDisplayBox.getDifficultyClass(rawGroup.totalLevel);
    const creepListStr = GameDisplayBox.renderCreepList(rawGroup.units);
    const claimInfoStr = GameDisplayBox.renderClaimInfo(rawGroup, teamColorMap, playerColorMap);

    return `
      <div class="camp-popup-header">
        <h3>Creep Camp</h3>
        <div class="camp-level-badge ${diffClass}">${rawGroup.totalLevel}</div>
      </div>
      ${creepListStr}
      ${claimInfoStr}
    `;
  }

  static neutralCampHandler (gameScaler, transform) {
    const { xScale, yScale, middleX, middleY } = gameScaler;

    return (data) => {
      const groups = Object.values(data);
      const tree = new rbush();

      const groupBoxes = groups.reduce((acc, group) => {
        const { bounds } = group;

        const record = {
          rawGroup: group,

          minX: ((xScale(bounds.minX) + middleX) * transform.k) + transform.x,
          maxX: ((xScale(bounds.maxX) + middleX) * transform.k) + transform.x,

          minY: ((yScale(bounds.maxY) + middleY) * transform.k) + transform.y,
          maxY: ((yScale(bounds.minY) + middleY) * transform.k) + transform.y
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
