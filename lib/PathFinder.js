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
    const treeSize = 32;

    grid.forEach(item => {
      const scaledSize = treeSize;

      tree.insert({
        minX: item.x - scaledSize,
        minY: item.y - scaledSize,
        maxX: item.x + scaledSize,
        maxY: item.y + scaledSize
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

    const gridResolution = 256;
    const tileSize = gridResolution;
    const halfTileSize = tileSize / 2;

    const pathGridHeight = (realMapHeight / gridResolution);
    const pathGridWidth = (realMapWidth / gridResolution);

    console.logger("pathing grid resolution: ", gridResolution);
    console.logger("path grid - (ph, pw)", `(${pathGridHeight},${pathGridWidth})`);

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

        let spotWeight = tree.collides(gridHitBox) ? 0 : 10;

        if (col === 0 || row === 0 || col === pathGridHeight || row === pathGridWidth) {
          // dont allow anything out of the grid...
          spotWeight = 0;
        }

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

      maxGridRow: metaGrid.length,
      maxGridCol: metaGrid[0].length,

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

  clipX (x) {
    const { cameraBox } = this.grid;

    if (x < cameraBox.left) {
      console.logger("WARN", "clipping start X");
      x = cameraBox.left;
    }

    if (x > cameraBox.right) {
      console.logger("WARN", "clipping start X");
      x = cameraBox.right;
    }

    return x;
  }

  clipY (y) {
    const { cameraBox } = this.grid;

    if (y > cameraBox.top) {
      console.logger("WARN", "clipping start Y");
      y = cameraBox.top;
    }

    if (y < cameraBox.bottom) {
      console.logger("WARN", "clipping start Y");
      y = cameraBox.bottom;
    }

    return y;
  }

  verifySpot (astarGraph, row, col) {
    try {
      if (!astarGraph.grid[row] || !astarGraph.grid[row][col]) {
        return false;
      }
      return true;
    } catch (e) {
      console.logger("bad grid e?", e);
      return false;
    }
  }

  findPath (startX, startY, endX, endY) {
    const {
      tileSize, 
      astarGraph, 
      gridResolution, 
      cameraBox, 
      meta,
      maxGridCol,
      maxGridRow
    } = this.grid;

    if (isNaN(startY) && !isNaN(endY)) {
      console.logger("WARN", "NAN starting Y detected, recovering to end Y");
      startY = endY;
    }

    if (isNaN(startX) && !isNaN(endX)) {
      console.logger("WARN", "NAN starting X detected, recovering to end X");
      startX = endX;
    }

    startX = this.clipX(startX);
    startY = this.clipY(startY);

    endX = this.clipX(endX);
    endY = this.clipY(endY);
  
    const gridStart = this.getGridFromPosition(startX, startY);
    const gridEnd = this.getGridFromPosition(endX, endY);

    if (gridStart.row > maxGridRow || gridEnd.row > maxGridRow 
      || gridStart.col > maxGridCol || gridEnd.col > maxGridCol) {
      console.logger("error pathing to: ", startX, startY, endX, endY);
      console.logger("gird start: ", gridStart, "grid end: ", gridEnd);

      console.logger("grid rows: ", meta.length);
      console.logger("grid cols: ", meta[0].length);

      console.logger("max grid rows: ", maxGridRow);
      console.logger("max grid cols: ", maxGridCol);

      return [];
    }

    if (!this.verifySpot(astarGraph, gridStart.row, gridStart.col) ||
        !this.verifySpot(astarGraph, gridEnd.row, gridEnd.col)) {
      console.logger("grid spot missing: ", gridStart, gridEnd);
      return [];
    }

    const startNode = astarGraph.grid[gridStart.row][gridStart.col];
    const endNode = astarGraph.grid[gridEnd.row][gridEnd.col];

    const hrstart = new Date();
    const searchOptions = {
      closest: true,
      heuristic: astar.astar.heuristics.diagonal
    };

    const path = astar.astar.search(astarGraph, startNode, endNode, searchOptions);
    const hrend = new Date();

    this.timers.push((hrend - hrstart));

    const worldPath = path.map(item => {
      const metaNode = meta[item.x][item.y];

      if (!metaNode) {
        console.logger("start: ", startX, startY);
        console.logger("bad pos (col, row): ", item.y, item.x);

        return [];
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
