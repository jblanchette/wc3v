const rbush = require('rbush');
const d3 = require("d3");

const fs = require("fs");
const astar = require("../helpers/astar");

///
// config
////

const searchOptions = {
  closest: false,
  heuristic: astar.astar.heuristics.diagonal
};

const BLOCKED_SPOT_WEIGHT = 0;
const OPEN_SPOT_WEIGHT = 9;

const treeSize = 64;

const tileSize = 32;

////
// path finder
////

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

    // trees
    const dooGrid = doo.grid;
    // pathing tiles
    const wpmGrid = wpm.grid;

    const pathGrid = [],
          metaGrid = [];

    const cameraBox = {
      left:   bounds.map[0][0],
      right:  bounds.map[0][1],
      top:    bounds.map[1][0],
      bottom: bounds.map[1][1]
    };

    const tree = new rbush();
    

    dooGrid.forEach((item, index) => {
      if (item.flags !== 2) {
        // invisible non-solid tree
        return;
      }

      const treeX = parseFloat(item.x);
      const treeY = parseFloat(item.y);

      const scaledSize = (treeSize / 2) * parseFloat(item.zScale);

      tree.insert({
        minX: treeX - scaledSize,
        minY: treeY - scaledSize,
        maxX: treeX + scaledSize,
        maxY: treeY + scaledSize
      });
    });

    const offsets = {
      width:  (((gridSize.full[0] - gridSize.playable[0]) * 4) / 2),
      height: (((gridSize.full[1] - gridSize.playable[1]) * 4) / 2)
    };

    const pathGridHeight = wpmGrid.length;
    const pathGridWidth = wpmGrid[0].length;

    console.log("path grid - (ph, pw)", `(${pathGridHeight},${pathGridWidth})`);
    let blockedSpots = 0;

    for (let row = 0; row < pathGridWidth; row++) {
      pathGrid.push([]);
      metaGrid.push([]);

      for (let col = 0; col < pathGridHeight; col++) {
        
        const gridPosition = this.getAdjustedGridPosition(
          row + offsets.width, col + offsets.height, cameraBox, tileSize);
        const gridX = gridPosition.row;
        const gridY = gridPosition.col;

        const wpmData = wpmGrid[col][row];
        const { 
          NoWater, 
          NoWalk,
          NoFly,
          NoBuild,
          Blight
        } = wpmData;

        ////
        // a unit can walk on a square if:
        //  * the `NoWalk` flag is NOT set
        //  * the `NoBuild` flag is set (confusingly backwards, consider fixing)
        //  * the `NoWater` flag is set (checked below)
        ////

        const canWalk = (!NoWalk && NoBuild) || NoWater;

        const gridHitBox = {
          minX: gridX,
          minY: gridY,
          maxX: gridX + tileSize,
          maxY: gridY + tileSize
        };

        let spotWeight = !canWalk || tree.collides(gridHitBox) 
          ? BLOCKED_SPOT_WEIGHT : OPEN_SPOT_WEIGHT;

        if (spotWeight == BLOCKED_SPOT_WEIGHT) {
          blockedSpots++;
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

    console.log("spots: ", (pathGridHeight * pathGridWidth), "blocked: ", blockedSpots);

    // create the astar graph
    const astarGraph = new astar.Graph(pathGrid);

    // uncomment to debug grid
    // fs.writeFileSync(`${__dirname}/gridtest`, astarGraph.toString());

    this.grid = {
      bounds,
      gridSize,
      tileSize,
      mapWidth, 
      mapHeight,
      astarGraph,
      cameraBox,

      maxGridRow: metaGrid.length,
      maxGridCol: metaGrid[0].length,

      pathGridHeight,
      pathGridWidth,

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

  clipGridSpot (astarGraph, gridStart, gridEnd) {
    if (gridStart.row > astarGraph.grid.length - 1) {
      gridStart.row = astarGraph.grid.length - 1;
    } else if (gridStart.row < 0) {
      gridStart.row = 0;
    }

    if (gridEnd.row > astarGraph.grid.length - 1) {
      gridEnd.row = astarGraph.grid.length - 1;
    } else if (gridEnd.row < 0) {
      gridEnd.row = 0;
    }

    if (gridStart.col > astarGraph.grid[gridStart.row].length - 1) {
      gridStart.col = astarGraph.grid[gridStart.row].length - 1;
    } else if (gridStart.col < 0) {
      gridStart.col = 0;
    }

    if (gridEnd.col > astarGraph.grid[gridEnd.row].length - 1) {
      gridEnd.col = astarGraph.grid[gridEnd.row].length - 1;
    } else if (gridEnd.col < 0) {
      gridEnd.col = 0;
    }
  }

  findPath (startX, startY, endX, endY) {
    const {
      tileSize, 
      astarGraph,  
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
  
    let gridStart = this.getGridFromPosition(startX, startY);
    let gridEnd = this.getGridFromPosition(endX, endY);

    if (!this.verifySpot(astarGraph, gridStart.row, gridStart.col) ||
        !this.verifySpot(astarGraph, gridEnd.row, gridEnd.col)) {
      console.logger("grid spot missing, clipping: ", gridStart, gridEnd);
      console.logger("grid width: ", astarGraph.grid.length, "height: ", astarGraph.grid[0].length);
      this.clipGridSpot(astarGraph, gridStart, gridEnd);
      console.logger("clipped spot: ", gridStart, gridEnd);
    }

    const startNode = astarGraph.grid[gridStart.row][gridStart.col];
    const endNode = astarGraph.grid[gridEnd.row][gridEnd.col];

    const hrstart = new Date();
    const path = astar.astar.search(astarGraph, startNode, endNode, searchOptions);
    const hrend = new Date();

    this.timers.push((hrend - hrstart));

    const worldPath = path.map(item => {
      const metaNode = meta[item.x][item.y];

      if (!metaNode) {
        console.logger("WARNING - missing meta node start: ", startX, startY);
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
