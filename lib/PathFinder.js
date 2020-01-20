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
    const treeSize = 256;

    grid.forEach(item => {
      tree.insert({
        minX: item.x - (treeSize / 2),
        minY: item.y - (treeSize / 2),
        maxX: item.x + (treeSize / 2),
        maxY: item.y + (treeSize / 2)
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

    const gridResolution = 128;
    const tileSize = gridResolution;
    const halfTileSize = tileSize / 2;

    const pathGridHeight = (realMapHeight / gridResolution);
    const pathGridWidth = (realMapWidth / gridResolution);

    for (let row = 0; row <= pathGridWidth; row++) {
      pathGrid.push([]);
      metaGrid.push([]);

      for (let col = 0; col <= pathGridHeight; col++) {

        const gridPosition = this.getAdjustedGridPosition(row, col, cameraBox, tileSize);
        const gridX = gridPosition.row;
        const gridY = gridPosition.col;

        const gridHitBox = {
          minX: gridX,
          minY: gridY,
          maxX: gridX + tileSize,
          maxY: gridY + tileSize
        };

        const spotWeight = tree.collides(gridHitBox) ? 0 : 1;

        const gridTile = {
          row,
          col,
          drawX: gridX,
          drawY: gridY,
          weight: spotWeight
        };

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

  getAdjustedGridPosition (x, y, cameraBox = null, tileSize) {
    cameraBox = cameraBox || this.grid.cameraBox;
    tileSize = tileSize || this.grid.tileSize;

    // row = (tile size * grid X) + camera left
    // 

    return {
      col: Math.floor((tileSize * y) + cameraBox.bottom),
      row: Math.floor((tileSize * x) + cameraBox.left)
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

    return {
      row: adjustedGridRow,
      col: adjustedGridCol
    };
  }

  findPath (startX, startY, endX, endY) {
    const { tileSize, astarGraph, gridResolution, cameraBox, meta } = this.grid;

    if (isNaN(startX) && !isNaN(endX)) {
      console.logger("WARN", "NAN starting X detected, recovering to end X");
      startX = endX;
    }

    if (isNaN(startY) && !isNaN(endY)) {
      console.logger("WARN", "NAN starting Y detected, recovering to end Y");
      startY = endY;
    }

    if (startX < cameraBox.left) {
      console.logger("WARN", "clipping start X");
      startX = cameraBox.left;
    }

    if (startX > cameraBox.right) {
      console.logger("WARN", "clipping start X");
      startX = cameraBox.right;
    }

    if (startY > cameraBox.top) {
      console.logger("WARN", "clipping start Y");
      startY = cameraBox.top;
    }

    if (startY < cameraBox.bottom) {
      console.logger("WARN", "clipping start Y");
      startY = cameraBox.bottom;
    }

    const gridStart = this.getGridFromPosition(startX, startY);
    const gridEnd = this.getGridFromPosition(endX, endY);

    const startNode = astarGraph.grid[gridStart.row][gridStart.col];
    const endNode = astarGraph.grid[gridEnd.row][gridEnd.col];

    const hrstart = new Date();
    const searchOptions = {
      closest: false,
      heuristic: astar.astar.heuristics.diagonal
    };

    const path = astar.astar.search(astarGraph, startNode, endNode, searchOptions);
    const hrend = new Date();

    this.timers.push((hrend - hrstart));

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

    return worldPath;
  }
}; 

module.exports = PathFinder;
