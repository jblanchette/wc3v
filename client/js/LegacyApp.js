
const LegacyApp = class {
  constructor () {
    this.focusPlayer = null;
    this.focusPlayerId = null;
    this.renderUnitIndex = null;
  }

  setupLinks (filename, url) {
    const rawLink = document.getElementById("raw-link");
    rawLink.onclick = (e) => {
      console.log("clicked...");

      const w = window.open('');
      w.document.title = `raw wc3v file - ${filename}`;
      w.document.write(`<html><body><pre>${ JSON.stringify(self.mapData, null, 4) }</pre></body></html>`);
    };
  }

  selectFocusPlayer (playerId) {
    this.focusPlayerId = playerId;
    this.focusPlayer = this.mapData.players[playerId];

    // sort units for display
    this.sortUnits();

    // select first unit with non-zero path length
    this.selectRenderUnit(this.focusPlayer.units.findIndex(unit => {
      return unit.path.length;
    }));
  }

  sortUnits () {
    // sort by: heroes, hero illusions, units

    this.focusPlayer.units = this.focusPlayer.units.sort((a, b) => {
      if (a.meta.hero && !b.meta.hero) {
        return 1;
      } else if (a.meta.hero && b.meta.hero) {
        if (a.displayName === b.displayName) {
          if (a.isIllusion && !b.isIllusion) {
            return -1;
          } else {
            return (a.isIllusion && b.isIllusion) ? 0 : 1;
          }
        }

        // sort by hero name when both are heroes
        return (a.displayName > b.displayName) - (a.displayName < b.displayName);
      } else {
        return -1;
      }
    }).reverse();
  }

  selectRenderUnit (unitIndex) {
    this.renderUnitIndex = unitIndex;
  }

  renderPlayerlist () {
    const self = this;
    const playerData = this.mapData.replay.players;

    const playerList = document.getElementById(domMap.playerListId);
    
    // clear the list
    playerList.innerHTML = "";
    playerList.addEventListener("change", (e) => {
      const { target } = e;
      const playerName = target.value;
      const playerIdList = Object.keys(this.mapData.players);

      // figure out which player id we just selected
      const selectedPlayerId = playerIdList.find(playerId => {
        const player = self.mapData.replay.players[playerId];

        return player.name === playerName;
      });

      self.selectFocusPlayer(selectedPlayerId);
      self.render();
    });

    
    // we mutate this list to put our selected player first
    let playerIdList = Object.keys(this.mapData.players);

    // put our focus player at the front
    const focusPlayerIndex = playerIdList.findIndex(playerId => {
      return playerId == self.focusPlayerId;
    });

    // delete the old list position, insert new id at the front
    playerIdList.splice(focusPlayerIndex, 1);
    playerIdList.unshift(this.focusPlayerId);

    playerIdList.forEach(playerId => {
      const optionItem = document.createElement("option");

      const player = playerData[playerId];

      if (!player) {
        console.error("unable to find player for: ", playerId);
        return;
      }

      optionItem.innerHTML = `${player.name}`;

      playerList.append(optionItem);
    });
  }

  renderUnitList () {
    const unitList = document.getElementById(domMap.unitListId);

    // clear the list
    unitList.innerHTML = "";

    this.focusPlayer.units.forEach((unit, index) => {
      if (!unit.path.length) {
        return;
      }

      const listItem = document.createElement("li");
      listItem.innerHTML = `<a onClick="wc3v.selectRenderUnit('${index}'); wc3v.render()">
        ${unit.displayName} ${unit.meta.hero ? "(H)" : ""} ${unit.isIllusion ? "(I)" : ""}
      </a>`;

      unitList.append(listItem);
    });
  }

  renderSelectedUnit () {
    const { ctx } = this;
    const unit = this.focusPlayer.units[this.renderUnitIndex];
    const drawPath = unit.path;

    // update the unit info dom section
    const unitInfo = document.getElementById(domMap.unitInfoId);
    unitInfo.innerHTML = `<ul>
      <li>${unit.displayName}</li>
      <li>${unit.level}</li>
    </ul>`;

    let penDown = false;

    ctx.strokeStyle = colorMap.unitPath;
    ctx.beginPath();
    ctx.moveTo(this.middleX, this.middleY);

    /*
    * wc3 coordinates are setup so ( 0 , 0 ) is in the center.
    * depending on the map - ( 0 , 0 ) is likely the center of map.

    * our draw points are translated by ( middleX, middleY ) so all coordinate values
    * start at the center of our draw region
    */

    drawPath.forEach(position => {
      const { x, y } = position;
      const drawX = this.xScale(x) + this.middleX;
      const drawY = this.yScale(y) + this.middleY;

      if (!penDown) {
        ctx.moveTo(drawX, drawY);
        penDown = true;
      }

      ctx.lineTo(drawX, drawY);
    });

    ctx.stroke();
    ctx.strokeStyle = colorMap.black;
  }

  renderBuildings () {
    const { ctx } = this;
    const buildings = this.focusPlayer.units.filter(unit => {
      return unit.isBuilding;
    });

    ctx.strokeStyle = colorMap.buildingOutline;

    buildings.forEach(building => {
      const { x, y } = building.lastPosition;
      const drawX = this.xScale(x) + this.middleX;
      const drawY = this.yScale(y) + this.middleY;

      ctx.strokeRect(drawX, drawY, 10, 10);
    });

    ctx.strokeStyle = colorMap.black;
  }

  render () {
    console.log("rendering scene");

    this.renderPlayerlist();
    this.renderUnitList();

    this.clearCanvas();
    this.renderMapBackground();
    this.renderBuildings();
    this.renderSelectedUnit();
  }
};

window.LegacyApp = LegacyApp;
