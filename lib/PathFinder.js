const rbush = require('rbush');
const d3 = require("d3");

const astar = require("../helpers/astar");

const PathFinder = class {
  constructor () {
    this.pathCache = {};

    this.cacheHitCount = 0;
    this.cacheMissCount = 0;

    this.timers = [];
  }

  setup (gridData) {
    const { doo, wpm, mapData } = gridData;
    const { bounds, gridSize } = mapData;

    const { mapWidth, mapHeight } = wpm;
    const { grid } = doo;

    const tree = new rbush();

    grid.forEach(item => {
      tree.insert({
        minX: item.x,
        minY: item.y,
        maxX: item.x + 1,
        maxY: item.y + 1
      });
    });

    const pathGrid = [],
          metaGrid = [];

    let c = 0;

    const cameraBox = {
      left:   bounds.map[0][0],
      right:  bounds.map[0][1],
      top:    bounds.map[1][0],
      bottom: bounds.map[1][1]
    };

    const realMapHeight = Math.abs(cameraBox.top) + Math.abs(cameraBox.bottom);
    const realMapWidth = Math.abs(cameraBox.left) + Math.abs(cameraBox.right);

    const gridResolution = 16;
    const tileSize = gridResolution;
    const halfTileSize = tileSize / 2;

    const pathGridHeight = (realMapHeight / gridResolution);
    const pathGridWidth = (realMapWidth / gridResolution);

    console.log("map bounds data: ", bounds, cameraBox);
    console.log("real mh: ", realMapHeight);
    console.log("real mw: ", realMapWidth);

    console.log("path gh:", pathGridHeight);
    console.log("path gw:", pathGridWidth);

    for (let row = 0; row <= pathGridWidth; row++) {
      pathGrid.push([]);
      metaGrid.push([]);

      for (let col = 0; col <= pathGridHeight; col++) {

        const gridPosition = this.getAdjustedGridPosition(row, col, cameraBox);
        const gridX = gridPosition.row;
        const gridY = gridPosition.col;

        const gridHitBox = {
          minX: gridX,
          minY: gridY,
          maxX: gridX + tileSize,
          maxY: gridY + tileSize
        };

        const gridTile = {
          row,
          col,
          drawX: gridX,
          drawY: gridY,
          weight: 10 //tree.collides(gridHitBox) ? 0 : 100
        };

        if (col == 0 && row == 0) {
          console.log("first grid tile: ", gridTile);
        }


        if (col == pathGridHeight - 1 && row == pathGridWidth - 1) {
          console.log("last grid tile: ", gridTile);
        }

        pathGrid[row][col] = gridTile.weight;
        metaGrid[row][col] = gridTile;

      }
    }

    const astarGraph = new astar.Graph(pathGrid);

    this.grid = {
      bounds,
      gridSize,
      gridResolution,
      tileSize,
      mapWidth, 
      mapHeight,
      astarGraph,
      cameraBox,

      pathGridHeight,
      pathGridWidth,
      realMapWidth,
      realMapHeight,

      pathing: pathGrid,
      meta: metaGrid
    };
  }

  getAdjustedGridPosition (x, y, cameraBox = null, tileSize = 16) {
    cameraBox = cameraBox || this.grid.cameraBox;
    tileSize = tileSize || this.grid.tileSize;

    // row = (tile size * grid X) + camera left
    // 

    return {
      col: Math.floor(((tileSize * y) + cameraBox.bottom) * -1),
      row: Math.floor(((tileSize * x) + cameraBox.left))
    };
  }

  getGridFromPosition (x, y) {
    const { cameraBox, tileSize, pathGridHeight, pathGridWidth } = this.grid;

    const halfGridHeight = pathGridHeight / 2;
    const halfGridWidth = pathGridWidth / 2;

    const gridRow = (x  / tileSize);
    const gridCol = (y  / tileSize);

    const adjustedGridRow = Math.floor(gridRow + halfGridWidth);
    const adjustedGridCol = Math.floor(gridCol + halfGridHeight);

    console.log("path debug: ", x, y);
    console.log("grid c,r: ", gridCol, gridRow);
    console.log("adj c,r: ", adjustedGridCol, adjustedGridRow);

    return {
      row: adjustedGridRow,
      col: adjustedGridCol
    };
  }

  findPath (startX, startY, endX, endY) {
    const { tileSize, astarGraph, gridResolution, cameraBox, meta } = this.grid;

    const gridStart = this.getGridFromPosition(startX, startY);
    const gridEnd = this.getGridFromPosition(endX, endY);

    console.logger(`finding path: (${startX}, ${startY}) -> (${endX}, ${endY})`);

    console.logger(`grid start: (${gridStart.col}, ${gridStart.row})`);
    console.logger(`grid end: (${gridEnd.col}, ${gridEnd.row})`);

    const startNode = astarGraph.grid[gridStart.row][gridStart.col];
    const endNode = astarGraph.grid[gridEnd.row][gridEnd.col];

    const cacheKey = `${startNode}-${endNode}`;

    if (this.pathCache[cacheKey]) {
      this.cacheHitCount += 1;
      return this.pathCache[cacheKey];
    }

    this.cacheMissCount += 1;

    const hrstart = new Date();
    const path = astar.astar.search(astarGraph, startNode, endNode);
    const hrend = new Date();

    this.timers.push((hrend - hrstart));

    const halfTileSize = tileSize / 2;

    console.log("made a path of len: ", path.length);

    path.forEach(node => {
      console.log(node.toString());
    })

    console.log("----");

    const worldPath = path.map(item => {
      const metaNode = meta[item.x][item.y];

      if (!metaNode) {
        console.log("start: ", startX, startY);
        console.log("bad pos (col, row): ", item.y, item.x);

        throw new Error("can't find path meta node");
      }

      return {
        x: metaNode.drawX,
        y: metaNode.drawY,
        gridRow: item.x,
        gridCol: item.y
      };
    });

    this.pathCache[cacheKey] = worldPath;
    return worldPath;
  }
}; 

module.exports = PathFinder;
