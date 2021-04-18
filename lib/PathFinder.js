const rbush = require('rbush');
const d3 = require("d3");
const sizeOf = require("image-size");

const fs = require("fs"),
      os = require("os"),
      zlib = require('zlib');

const astar = require("../helpers/astar");
const GameScaler = require("../client/js/GameScaler");

///
// config
////

const searchOptions = {
  closest: false,
  heuristic: astar.astar.heuristics.diagonal
};

const BLOCKED_SPOT_WEIGHT = 0;
const OPEN_SPOT_WEIGHT = 15;

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

  setupScaler (mapData) {
    const {
      name,
      bounds
    } = mapData;
    const { map, camera } = bounds;

    const clientPath = os.platform() === "win32" ?
      `${__dirname}\\..\\client\\maps\\${name}\\map.jpg` :
      `${__dirname}/../client/maps/${name}/map.jpg`;

    const mapImage = sizeOf(clientPath);

    /*
      bound index selection - 
      not all camera grids are centered in the map grid,
      try to adjust so we show the lower ratio so enough
      of the actual map is shown
     */

    const xBoundIndex = (map[0][0] < camera[0][1]) ? 0 : 1;
    const yBoundIndex = (map[1][0] < camera[1][1]) ? 0 : 1;

    this.cameraRatio =  {
      x: (camera[0][xBoundIndex] / map[0][xBoundIndex]),
      y: (camera[1][yBoundIndex] / map[1][yBoundIndex]),
      xInverse: (map[0][xBoundIndex] / camera[0][xBoundIndex]),
      yInverse: (map[1][yBoundIndex] / camera[1][yBoundIndex])
    };

    const mapWidth = mapImage.width *   this.cameraRatio.x;
    const mapHeight = mapImage.height * this.cameraRatio.y;

    const canvas = {
      width: mapWidth,
      height: mapHeight
    };

    this.gameScaler.setup({ bounds: mapData.bounds }, mapImage, canvas, this.cameraRatio);
  }

  setup (gridData) {
    const { doo, wpm, mapData } = gridData;
    const { bounds, gridSize } = mapData;

    const { mapWidth, mapHeight } = wpm;

    this.gameScaler = new GameScaler();
    this.gameScaler.addDependency('_d3', d3);
    
    this.setupScaler(mapData);

    const { xScale, yScale, unitXScale, unitYScale, gridXScale, gridYScale, cameraRatio, middleX, middleY } = this.gameScaler;

    // trees
    const dooGrid = doo.grid;
    // pathing tiles
    let wpmGrid = wpm.grid;

    const isHorzFlipped = true;

    if (isHorzFlipped) {
      // horizontally flip the grid to match ours
      wpmGrid = wpmGrid.map(row => row.reverse());
    }

    let pathGrid = [],
          metaGrid = [];

    const cameraBox = this.getCameraBox(bounds);

    // the main rbush based detection grid
    const tree = new rbush();
    
    dooGrid.forEach((item, index) => {
      if (item.flags !== 2) {
        // normal tree only
        return;
      }

      const x = parseFloat(item.x);
      const y = parseFloat(item.y);

      tree.insert({
        minX: (x - treeSize),
        minY: (y - treeSize),
        maxX: (x + treeSize),
        maxY: (y + treeSize)
      });
    });

    const pathGridHeight = wpmGrid.length;
    const pathGridWidth = wpmGrid[0].length;

    console.logger("----------------------------------");
    console.logger("PATHFINDING SETUP");
    console.logger("----------------------------------");

    console.logger("pathfind grid - (ph, pw)", `(${pathGridHeight-1},${pathGridWidth-1})`);
    
    let blockedSpots = 0;

    for (let row = 0; row < pathGridWidth; row++) {
      pathGrid.push([]);
      metaGrid.push([]);

      for (let col = 0; col < pathGridHeight; col++) {
        const gridPosition = {
          x: gridXScale(row * tileSize),
          y: gridYScale(col * tileSize),
        };

        const gridX = gridPosition.x;
        const gridY = gridPosition.y;

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
        //  * the `NoWater` flag is set
        ////

        const canWalk = (!NoWalk && NoBuild) || NoWater || Blight;

        const gridHitBox = {
          minX: gridX,
          minY: gridY,
          maxX: gridX,
          maxY: gridY
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

    console.logger("first tile: ", metaGrid[0][0]);
    console.logger("last tile: ", metaGrid[pathGridWidth-1][pathGridHeight-1]);
    console.logger("path spots: ", (pathGridHeight * pathGridWidth), "spots blocked: ", blockedSpots);

    // create the astar graph
    const astarGraph = new astar.Graph(pathGrid);

    // uncomment to debug grid
    const gridPath = os.platform() === "win32" ?
      `${__dirname}\\..\\client\\maps\\${mapData.name}\\grid` :
      `${__dirname}/../client/maps/${mapData.name}/grid`;
  
    if (false || !fs.existsSync(gridPath)) {
      const gridData = astarGraph.toString();
      fs.writeFileSync(`${gridPath}`, gridData.replace(/15/g, "X"));
    }

    this.grid = {
      bounds,
      gridSize,
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

  getGridFromPosition (x, y) {
    const { gridXScale, gridYScale } = this.gameScaler;

    return {
      row: Math.floor(gridXScale.invert(x) / 32),
      col: Math.floor(gridYScale.invert(y) / 32)
    };
  }

  getCameraBox (bounds) {
    const cameraBox = {
      left:   bounds.map[0][0],
      right:  bounds.map[0][1],
      top:    bounds.map[1][0],
      bottom: bounds.map[1][1],
      innerBox: {
        left:   bounds.camera[0][0],
        right:  bounds.camera[0][1],
        top:    bounds.camera[1][0],
        bottom: bounds.camera[1][1]
      }
    };

    const gridSize = 128;
    const absCamera = {
      left: Math.abs(cameraBox.left),
      right: Math.abs(cameraBox.right),
      top: Math.abs(cameraBox.top),
      bottom: Math.abs(cameraBox.bottom)      
    };

    const totalWidth = (absCamera.left + absCamera.right);
    const totalHeight = (absCamera.top + absCamera.bottom);

    return cameraBox;
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

  zipGameFile (outputPath) {
    const gzip = zlib.createGzip();
    const inputFile = fs.createReadStream(outputPath);
    const outputFile = fs.createWriteStream(`${outputPath}.gz`, { autoClose: true });
    console.logger("writing gzipped file: ", `${outputPath}.gz`);
    
    inputFile.pipe(gzip)
      .on('error', (e) => {
        console.logger("file write error for: ", outputPath, e);
      })
      .pipe(outputFile)
      .on('error', (e) => {
        console.logger("file write error for: ", outputPath, e);
      })
      .on('finish', () => {
        try {
          fs.unlinkSync(outputPath);
        } catch (e) {
          // do nothing
        }
      });
  }

  findPath (startX, startY, endX, endY) {
    const {
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

    console.logger("finding path: ", startX, startY, endX, endY);
    console.logger("finding path: ", gridStart, gridEnd);

    if (!this.verifySpot(astarGraph, gridStart.row, gridStart.col) ||
        !this.verifySpot(astarGraph, gridEnd.row, gridEnd.col)) {
      console.logger("grid spot missing, clipping: ", gridStart, gridEnd);
      console.logger("grid width: ", astarGraph.grid.length, "height: ", astarGraph.grid[0].length);
      this.clipGridSpot(astarGraph, gridStart, gridEnd);
      console.logger("clipped spot: ", gridStart, gridEnd);
    }

    

    if (gridStart.row === gridEnd.row && gridStart.col === gridEnd.col) {
      console.logger("WARN - grid start and end are the same.");
      return {
        walkPath: [],
        isDifferentSpot: false
      };
    }

    const startNode = astarGraph.grid[gridStart.row][gridStart.col];
    const endNode = astarGraph.grid[gridEnd.row][gridEnd.col];

    console.logger("start node weight: ", startNode.weight);
    console.logger("end node: ", endNode.weight);

    if (startNode.weight === 0) {
      console.logger("WARN - starting on a blocked pathing spot.  probably stuck.");
    }

    if (endNode.weight === 0) {
      console.logger("WARN - ending on a blocked pathing spot.  probably stuck.");
    }

    const hrstart = new Date();
    const path = astar.astar.search(astarGraph, startNode, endNode, searchOptions);
    const hrend = new Date();

    this.timers.push((hrend - hrstart));

    const worldPath = path.map((item, ind) => {
      const metaNode = meta[item.x][item.y];

      if (!metaNode) {
        console.logger("WARNING - missing meta node start: ", startX, startY);
        console.logger("bad pos (col, row): ", item.y, item.x);

        return [];
      }

      if (metaNode.weight === BLOCKED_SPOT_WEIGHT) {
        console.log("WARN - adding a blocked spot to path ind: ", ind, "of", path.length);
      }

      return {
        x: metaNode.drawX,
        y: metaNode.drawY,
        weight: metaNode.weight,
        gridRow: item.x,
        gridCol: item.y
      };
    });
    
    if (!worldPath.length) {
      console.logger("ERROR - found broken path");
    }

    return {
      isDifferentSpot: true,
      walkPath: worldPath
    };
  }
}; 

module.exports = PathFinder;
