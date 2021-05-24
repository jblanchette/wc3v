const DisplayModes = {
  neutralCamp: 0
};

const boxDesignSize = {
  width: 200,
  height: 160
};

const formatGameTime = (millis) => {
  var minutes = Math.floor(millis / 60000);
  var seconds = ((millis % 60000) / 1000).toFixed(0);
  return minutes + ":" + (seconds < 10 ? '0' : '') + seconds;
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

    const { offsetX, offsetY } = e;

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

    let teamClaimStr = '';

    if (rawGroup.claimers) {
      if (rawGroup.claimState == 0) {
        teamClaimStr = `<b>Team:</b> UNCLAIMED`;
      } else if (rawGroup.claimState == 1) {
        teamClaimStr = `<b>Team:</b> CONTESTED`;
      } else {

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
            <div>
              <b>Team:</b> <span class="camp-spot-square" style="background-color: ${teamColor}"></span>
            </div>

            <div>
              <b>Players:</b> ${playerClaimStr}
            </div>
          `;  
        })
        
      }
    }

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

    const renderStr = `
     <div class="camp-spot-circle ${spotColor}">
      <span>${rawGroup.totalLevel}</span>
     </div>

     <h3>Camp Data</h3>
     <div class="game-display-box-content">
       ${teamClaimStr}

       <div>
        <b>Order Taken:</b> #${rawGroup.order || 'N/A'}
       </div>
       <div>
        <b>Claim Time:</b> ${formatGameTime(rawGroup.claimTime)}
       </div>

       <div>
        <b>Neutral Count:</b> ${rawGroup.units.length}
       </div>

       <div class="game-xp">
         <span><b>Experience Gained:</b></span>
         <ul>
          ${xpGainedStr}
         </ul>
       </div>
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
