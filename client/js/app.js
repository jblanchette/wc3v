const mapInputField = "input-map-file";

const Wc3vViewer = class {
  constructor () {
    this.canvas = null;
    this.ctx = null;

    this.mapData = null;
    this.mapImage = null;

    this.focusPlayer = null;
    this.renderUnitIndex = null;
  }

  load () {
    const filename = document.getElementById(mapInputField).value;
    console.log('1 loading wc3v replay: ', filename);

    this.loadFile(filename);
  }

  loadFile (filename) {
    const self = this;
    const req = new XMLHttpRequest();

    req.addEventListener("load", (res) => {
      try {
        const { target } = res;
        const jsonData = JSON.parse(target.responseText);
        
        self.mapData = jsonData;
        // setup the map units
        self.setup();
      } catch (e) {
        console.error("Error loading wc3v replay: ", e);

        reject(e);
      }
    });

    const url = `http://localhost:8080/replays/${filename}`;

    req.open("GET", url);
    req.send();
  }

  loadMapFile () {
    const self = this;
    const { mapName } = this.mapData.replay.meta.meta;

    return new Promise((resolve, reject) => {
      self.mapImage = new Image();   // Create new img element
      self.mapImage.src = './maps/ConcealedHill/map.jpg'; // Set source path

      self.mapImage.addEventListener('load', () => {
        resolve();
      }, false);
      
    });
  }

  setup () {
    const self = this;
    const playerKeys = Object.keys(this.mapData.players);
    const { canvas, ctx } = this;

    this.focusPlayer = this.mapData.players[playerKeys[0]];

    this.canvas = document.getElementById("main-canvas");
    this.ctx = this.canvas.getContext("2d");

    this.selectRenderUnit(this.focusPlayer.units.findIndex(unit => {
      return unit.path.length;
    }));

    // finishes the setup promise
    return this.loadMapFile().then(() => {
      self.render();
    })
  }

  selectRenderUnit (unitIndex) {
    this.renderUnitIndex = unitIndex;
  }

  renderUnitList () {
    const unitList = document.getElementById("unit-list");

    // clear the list
    unitList.innerHTML = "";

    this.focusPlayer.units.forEach((unit, index) => {
      if (!unit.path.length) {
        return;
      }

      const listItem = document.createElement("li");
      listItem.innerHTML = `<a onClick="wc3v.selectRenderUnit('${index}'); wc3v.render()">${unit.displayName}</a>`;

      unitList.append(listItem);
    });
  }

  clearCanvas () {
    const { ctx, canvas } = this;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  renderMapBackground () {
    const { ctx } = this;
    const middleX = (800 / 2);
    const middleY = (600 / 2);

    const mapX = (middleX - (this.mapImage.width / 2));
    const mapY = (middleY - (this.mapImage.height / 2));
    
    ctx.drawImage(this.mapImage, mapX, mapY);
  }

  renderSelectedUnit () {
    const { ctx } = this;
    const unit = this.focusPlayer.units[this.renderUnitIndex];

    const viewWidth = this.mapImage.width;
    const viewHeight = this.mapImage.height;

    const middleX = (800 / 2);
    const middleY = (600 / 2);

    const drawPath = unit.path;

    const viewXRange = [-(viewWidth / 2), (viewWidth / 2)];
    const viewYRange = [-(viewHeight / 2), (viewHeight / 2)];

    const xExtent = [-5200, 5200];
    const yExtent = [-6400, 6400];

    const xScale = d3.scaleLinear()
      .domain(xExtent)
      .range(viewXRange);

    const yScale = d3.scaleLinear()
      .domain(yExtent)
      .range(viewYRange);

    let penDown = false;

    ctx.strokeStyle = "#00FFFF";
    ctx.beginPath();
    ctx.moveTo(middleX, middleY);

    /*
    * wc3 coordinates are setup so ( 0 , 0 ) is in the center.
    * depending on the map - ( 0 , 0 ) is likely the center of map.

    * our draw points are translated by ( middleX, middleY ) so all coordinate values
    * start at the center of our draw region
    */

    drawPath.forEach(position => {
      const { x, y } = position;
      const drawX = xScale(-x) + middleX;
      const drawY = yScale(y) + middleY;

      if (!penDown) {
        ctx.moveTo(drawX, drawY);
        penDown = true;
      }

      ctx.lineTo(drawX, drawY);
    });

    ctx.stroke();
    ctx.strokeStyle = "#000000";
  }

  render () {
    console.log("rendering scene");

    this.renderUnitList();

    this.clearCanvas();
    this.renderMapBackground();
    this.renderSelectedUnit();
  }
};

window.wc3v = new Wc3vViewer();
