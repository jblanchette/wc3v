const DisplayModes = {
  neutralCamp: 0
};

const boxDesignSize = {
  width: 280,
  height: 260
};

const formatGameTime = (gameTime) => {
  const timerDate = new Date(Math.round(gameTime * 1000) / 1000);
  // ensure leading zero
  const gameSecondsPrefix = timerDate.getUTCSeconds() < 10 ? '0' : '';

  return `${timerDate.getUTCMinutes()}:${gameSecondsPrefix}${timerDate.getUTCSeconds()}`;
};

const GameDisplayBox = class {
  constructor (teamColorMap, playerColorMap) {
    this.box = document.getElementById("game-display-box");
    this.mode = DisplayModes.neutralCamp;
    this.teamColorMap = teamColorMap;
    this.playerColorMap = playerColorMap;

    this.data = null;
  }

  setData (data, handlerFn) {
    this.data = handlerFn(data);
  }
  
  handleMouse (e, type, transform) {
    if (transform.k != 1.0) {
      this.hide();
      return;
    }

    let { offsetX, offsetY, target } = e;
    const drawBounds = target.getBoundingClientRect();

    const hitBox = {
      minX: offsetX,
      maxX: offsetX,
      minY: offsetY,
      maxY: offsetY
    };

    const searchHits = this.data.tree.search(hitBox);
    if (searchHits.length) {
      //
      // we have a hit
      //

      // just use the first box hit
      const searchHit = searchHits[0];

      if (type == 'down') {

        // clipping if needed
        if (drawBounds) {
          const boxRight = (drawBounds.x + offsetX + boxDesignSize.width);
          const boxBottom = (drawBounds.y + offsetY + boxDesignSize.height);

          if (boxRight > drawBounds.right) {
            offsetX -= boxDesignSize.width;
          }

          if (boxBottom > drawBounds.bottom) {
            offsetY -= boxDesignSize.height;
          }
        }

        this.box.style.display = "block";
        this.box.style.left = `${offsetX}px`;
        this.box.style.top = `${offsetY}px`;

        this.render(searchHit);

        return;
      }

      if (type == 'move') {
        document.body.style.cursor = 'pointer';

        return;
      }
    } 
    
    //
    // no hit detected
    //

    if (type == 'move') {
      if (document.body.style.cursor == 'pointer') {
        document.body.style.cursor = 'default';
      }
    } else {
      this.hide();
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
    if (this.box.style.display != "none") {
      this.box.style.display = "none";  
    }
  }

  static renderContestedCamp (rawGroup, teamColorMap, playerColorMap) {
    let contestedClaimStr = '<h4>Camp contested or unfinished</h4>';

    Object.keys(rawGroup.claimers).forEach(teamId => {
      if (+rawGroup.claimOwnerId != +teamId) {
        return;
      }

      const claimPlayers = rawGroup.claimers[teamId].players;
      const teamColor = teamColorMap[teamId];

      contestedClaimStr += `
        <div class="game-stat">
          <span class="game-stat-title">Team:</span> 
          <span class="game-stat-text">
            <span class="camp-spot-square" style="background-color: ${teamColor}"></span>
          </span>
        </div>
      `;
    });

    return contestedClaimStr;
  }

  static renderClaimedCamp (rawGroup, teamColorMap, playerColorMap) {
    let teamClaimStr = '';

    Object.keys(rawGroup.claimers).forEach(teamId => {
      if (+rawGroup.claimOwnerId != +teamId) {
        return;
      }

      const claimPlayers = rawGroup.claimers[teamId].players;
      const teamColor = teamColorMap[teamId];

      let playerClaimStr = '';
      
      // loop each player in the claim
      Object.keys(claimPlayers).forEach(playerId => {
        const playerColor = playerColorMap[playerId];

        const heroes = claimPlayers[playerId].units.filter(unit => {
          return unit.meta.hero;
        }) || [];

        playerClaimStr += `
          <span class="camp-spot-square" style="background-color: ${playerColor}"></span>
        `;
      });

      teamClaimStr += `
        <div class="game-stat">
          <span class="game-stat-title">Team:</span> 
          <span class="game-stat-text">
            <span class="camp-spot-square" style="background-color: ${teamColor}"></span>
          </span>
        </div>

        <div class="game-stat">
          <span class="game-stat-title">Players:</span>
          <span class="game-stat-text">${playerClaimStr}</span>
        </div>
      `;  
    });

    return teamClaimStr;
  }

  static renderTeamClaims (rawGroup, teamColorMap, playerColorMap) {
    if (!rawGroup.claimers) {
      return '';
    }

    switch (rawGroup.claimState) {
      case 0:
        return `<h4>Camp left unclaimed</h4>`;
      case 1:
        // Contested camp - show which teams were involved      
        return GameDisplayBox.renderContestedCamp(rawGroup, teamColorMap, playerColorMap);
      default:
        // Claimed camp - show full team and player info
        return GameDisplayBox.renderClaimedCamp(rawGroup, teamColorMap, playerColorMap);
    }
  }

  static renderTeamStats(rawGroup, teamColorMap, playerColorMap) {
    // if (rawGroup.claimState <= 1) {
    //   return '';
    // }

    let xpGainedStr = '';

    if (rawGroup.heroStats) {
      Object.keys(rawGroup.heroStats).forEach(uuid => {
        const heroStat = rawGroup.heroStats[uuid];
        const { displayName, total } = heroStat;

        const startingXp = rawGroup.xpSnapshot[uuid] || 0;

        xpGainedStr += `
          <li><b>${displayName}:</b> +${total} (${startingXp}->${(startingXp + total)})</li>
        `;
      });
    } else {
      xpGainedStr = `<li>N/A</li>`;
    }

    let totalClaimTimeStr = '';

    if (rawGroup.claimers) {
      Object.keys(rawGroup.claimers).forEach(playerId => {
        const playerColor = playerColorMap[playerId];
        const playerTotal = formatGameTime(rawGroup.claimers[playerId].timeClaimed);

        totalClaimTimeStr += `${playerTotal} <span class="camp-spot-square" style="background-color: ${playerColor}"></span> `;
      });
    }

    return `
      <div class="game-stat">
        <span class="game-stat-title">Order Taken:</span> 
        <span class="game-stat-text">#${rawGroup.order || 'N/A'}</span>
      </div>

      <div class="game-stat">
        <span class="game-stat-title">Claim Time:</span> 
        <span class="game-stat-text">${formatGameTime(rawGroup.claimTime)}</span>
      </div>

      <div class="game-stat">
        <span class="game-stat-title">Total Time Claimed:</span> 
        <span class="game-stat-text">${totalClaimTimeStr}</span>
      </div>

      <div class="game-stat">
        <span class="game-stat-title">Neutral Count:</span> 
        <span class="game-stat-text">${rawGroup.units.length}</span>
      </div>

      <div class="game-xp">
        <span class="game-xp-title">
          <b>Experience Gained:</b>
        </span>

        <ul>
          ${xpGainedStr}
        </ul>
      </div>
    `;
  }

  static renderNeutralCamp (camp, teamColorMap, playerColorMap) {
    const { rawGroup } = camp;

    const levelMap = {
      9:  'green',
      19: 'yellow',
      20: 'red'
    };

    const spotColorKey = Object.keys(levelMap).find(levelMapMin => {
      return (rawGroup.totalLevel <= levelMapMin);
    }) || 20;

    const spotColor = levelMap[spotColorKey]; 

    //
    // drawing
    //

    // aggregated stats for team and player claims
    const teamClaimStr = GameDisplayBox.renderTeamClaims(rawGroup, teamColorMap, playerColorMap);

    // individual stats about the claims if not contested
    const teamStatsStr = GameDisplayBox.renderTeamStats(rawGroup, teamColorMap, playerColorMap);

    const renderStr = `
      <div class="game-display-box-content">
        <div class="game-display-box-header">
          <h3>Camp Data</h3>

          <div class="camp-spot-circle ${spotColor}">
            <span>${rawGroup.totalLevel}</span>
          </div>
        </div>

        ${teamClaimStr}
        ${teamStatsStr}
      </div>
    `;

    return renderStr;
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
