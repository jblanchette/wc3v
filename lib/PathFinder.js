const rbush = require('rbush');
const d3 = require("d3");
const sizeOf = require("image-size");

const fs = require("fs"),
      os = require("os"),
      zlib = require('zlib');

const astar = require("../helpers/astar");
const GameScaler = require("../client/js/GameScaler");

//const { createCanvas } = require("canvas");

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
    this.gameScaler = new GameScaler();
    this.gameScaler.addDependency('_d3', d3);
    this.gameScaler.setup(mapData);
  }

  setup (gridData) {
    const { doo, wpm, mapData } = gridData;
    const { bounds, gridSize } = mapData;

    const { mapWidth, mapHeight } = wpm;

    this.setupScaler(mapData);

    const { 
      xScale, 
      yScale, 
      unitXScale, 
      unitYScale, 
      gridXScale, 
      gridYScale, 
      cameraRatio, 
      middleX,
      middleY 
    } = this.gameScaler;

    // trees
    const dooGrid = doo.grid;
    // pathing tiles
    let wpmGrid = wpm.grid;

    let pathGrid = [],
        metaGrid = [];

    const cameraBox = this.getCameraBox(bounds);

    // the main rbush based detection grid
    const tree = new rbush();

    dooGrid.forEach((item, index) => {
      const x = parseFloat(item.position.x);
      const y = parseFloat(item.position.y);

      const newTree = {
        minX: x,//(x - treeSize),
        maxX: x + 128,// (x + treeSize),

        minY: y - 128,//(y + treeSize),
        maxY: y//(y - treeSize)
      };

      tree.insert(newTree);
    });

    const pathGridHeight = wpmGrid.length;
    const pathGridWidth = wpmGrid[0].length;

    console.logger("----------------------------------");
    console.logger("PATHFINDING SETUP");
    console.logger("----------------------------------");

    console.logger("pathfind grid - (ph, pw)", `(${pathGridHeight-1},${pathGridWidth-1})`);
    
    let rCol = 0;
    let blockedSpots = 0;

    for (let row = 0; row < pathGridWidth; row++) {
      pathGrid.push([]);
      metaGrid.push([]);

      rCol = pathGridHeight - 1;

      for (let col = 0; col < pathGridHeight; col++) {
        
        /* CONFUSING WARNING:

           the stupid grid is upside down and the coordinates
           get screwed up so we need the `rCol` (reverse col)
           for the grid and the regular `col` for the x/y

           just leave it like this and it works
        */

        const wpmData = wpmGrid[rCol][row];
        const reverseData = wpmGrid[col][row];
        const gridX = reverseData.x;
        const gridY = reverseData.y;

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

        // const flagTable = {
        //   'NoWalk':  0x02,  // 1=no walk  , 0=walk ok
        //   'NoFly':   0x04,  // 1=no fly   , 0=fly ok
        //   'NoBuild': 0x08,  // 1=no build , 0=build ok

        //   'Blight':  0x20,  // 1=blight   , 0=normal
        //   'NoWater': 0x40,  // 1=no water , 0=water
        //   'Unknown': 0x80   // 1=unknown  , 0=normal
        // };

        const canWalk = (!NoWalk && NoBuild) || NoWater || Blight;
        const gridHitBox = {
          minX: gridX,
          maxX: gridX + 32,

          minY: gridY - 32,
          maxY: gridY
        };

        const collisions = tree.search(gridHitBox);
        let spotWeight = !canWalk || collisions.length
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

        rCol--;
      }
    }

    console.logger("first tile: ", metaGrid[0][0]);
    console.logger("last tile: ", metaGrid[pathGridWidth-1][pathGridHeight-1]);
    console.logger("path spots: ", (pathGridHeight * pathGridWidth), "spots blocked: ", blockedSpots);

    // create the astar graph
    const astarGraph = new astar.Graph(pathGrid);

    // uncomment to debug grid
    const gridPath = os.platform() === "win32" ?
      `${__dirname}\\..\\client\\maps\\${mapData.name}\\grid-debug.jpg` :
      `${__dirname}/../client/maps/${mapData.name}/grid-debug.jpg`;
  
    //if (false || !fs.existsSync(gridPath)) {
      // const gridData = astarGraph.toString();
      // fs.writeFileSync(`${gridPath}`, gridData.replace(/15/g, "X"));
    //}

    // to debug path map turn this on
    // this.drawBackgroundMap(gridPath, wpm, metaGrid);

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

  drawBackgroundMap (gridPath, wpm, metaGrid) {
    const { gameScaler } = this;

    const canvas = createCanvas(gameScaler.mapImage.width, gameScaler.mapImage.height);
    const ctx = canvas.getContext('2d');

    // setup

    const { grid } = wpm;

    const gridTileSize = 16;
    const treeSize = 8;

    // drawing

    const tileSize = gameScaler.pixelsPerTile;

    const colors = {
      'empty': '#000',
      'grass': '#2c6818',
      'water': '#051459',
      'shallowwater': '#0A27A6',
      'ground': '#906739',
      'trees': '#013f01'
    };

    // black background
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, gameScaler.mapImage.width, gameScaler.mapImage.height);

    const { xScale, yScale, middleX, middleY, } = gameScaler;

    for (let row = 0; row < metaGrid.length; row++) {
    //for (let row = metaGrid.length - 1; row >= 0; row--) {
      for (let col = 0; col < metaGrid[row].length; col++) {
        const data = metaGrid[row][col];

        if (data.weight == 0) {
          const drawX = row * tileSize;
          const drawY = col * tileSize;

          ctx.fillStyle = '#ff0000';
          ctx.fillRect(drawX, drawY, tileSize, tileSize);

          continue;
        } 
      }
    }

    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(`${gridPath}`, buffer);
  }

  // Block an area on the pathfinding grid (e.g. when a building is placed).
  // footprintCells is the building's footprint in WPM grid cells.
  blockArea (worldX, worldY, footprintCells) {
    if (!this.grid) return;

    const { astarGraph, pathing, maxGridRow, maxGridCol } = this.grid;
    const center = this.getGridFromPosition(worldX, worldY);
    const halfFoot = Math.floor(footprintCells / 2);

    for (let r = center.row - halfFoot; r <= center.row + halfFoot; r++) {
      for (let c = center.col - halfFoot; c <= center.col + halfFoot; c++) {
        if (r < 0 || r >= maxGridRow || c < 0 || c >= maxGridCol) continue;
        pathing[r][c] = BLOCKED_SPOT_WEIGHT;
        if (astarGraph.grid[r] && astarGraph.grid[r][c]) {
          astarGraph.grid[r][c].weight = BLOCKED_SPOT_WEIGHT;
        }
      }
    }

    // clear path cache since the grid has changed
    this.pathCache = {};
  }

  // Unblock an area on the pathfinding grid (e.g. when a building is cancelled/destroyed).
  unblockArea (worldX, worldY, footprintCells) {
    if (!this.grid) return;

    const { astarGraph, pathing, maxGridRow, maxGridCol } = this.grid;
    const center = this.getGridFromPosition(worldX, worldY);
    const halfFoot = Math.floor(footprintCells / 2);

    for (let r = center.row - halfFoot; r <= center.row + halfFoot; r++) {
      for (let c = center.col - halfFoot; c <= center.col + halfFoot; c++) {
        if (r < 0 || r >= maxGridRow || c < 0 || c >= maxGridCol) continue;
        pathing[r][c] = OPEN_SPOT_WEIGHT;
        if (astarGraph.grid[r] && astarGraph.grid[r][c]) {
          astarGraph.grid[r][c].weight = OPEN_SPOT_WEIGHT;
        }
      }
    }

    this.pathCache = {};
  }

  // Find the nearest open (walkable) grid cell by spiraling outward from (row, col).
  findNearestOpen (graph, row, col) {
    const maxRow = graph.grid.length - 1;
    const maxCol = graph.grid[0].length - 1;

    for (let radius = 1; radius <= 10; radius++) {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue; // only ring edges
          const r = row + dr;
          const c = col + dc;
          if (r < 0 || r > maxRow || c < 0 || c > maxCol) continue;
          if (graph.grid[r][c].weight > 0) {
            return { row: r, col: c };
          }
        }
      }
    }
    return null;
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

    const targetGraph = astarGraph;

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

    console.logger("finding path pos: ", startX, startY, endX, endY);
    console.logger("finding path grid: ", gridStart, gridEnd);

    if (!this.verifySpot(targetGraph, gridStart.row, gridStart.col) ||
        !this.verifySpot(targetGraph, gridEnd.row, gridEnd.col)) {
      console.logger("grid spot missing, clipping: ", gridStart, gridEnd);
      console.logger("grid width: ", targetGraph.grid.length, "height: ", targetGraph.grid[0].length);
      this.clipGridSpot(targetGraph, gridStart, gridEnd);
      console.logger("clipped spot: ", gridStart, gridEnd);
    }

    if (gridStart.row === gridEnd.row && gridStart.col === gridEnd.col) {
      console.logger("WARN - grid start and end are the same.");
      return {
        walkPath: [],
        isDifferentSpot: false
      };
    }

    let startNode = targetGraph.grid[gridStart.row][gridStart.col];
    let endNode = targetGraph.grid[gridEnd.row][gridEnd.col];

    // if start or end is on a blocked cell, find nearest walkable neighbor
    if (startNode.weight === 0) {
      console.logger("WARN - starting on a blocked pathing spot, finding nearest open cell.");
      const open = this.findNearestOpen(targetGraph, gridStart.row, gridStart.col);
      if (open) {
        gridStart.row = open.row;
        gridStart.col = open.col;
        startNode = targetGraph.grid[open.row][open.col];
      }
    }

    if (endNode.weight === 0) {
      console.logger("WARN - ending on a blocked pathing spot, finding nearest open cell.");
      const open = this.findNearestOpen(targetGraph, gridEnd.row, gridEnd.col);
      if (open) {
        gridEnd.row = open.row;
        gridEnd.col = open.col;
        endNode = targetGraph.grid[open.row][open.col];
      }
    }

    const resolvedStart = startNode;
    const resolvedEnd = endNode;

    const cacheStr = `${resolvedStart.x}-${resolvedStart.y}|${resolvedEnd.x}-${resolvedEnd.y}`;

    if (this.pathCache[cacheStr]) {
      this.cacheHitCount++;

      return {
        isDifferentSpot: true,
        walkPath: this.pathCache[cacheStr].slice()
      };
    }

    const hrstart = new Date();
    const path = astar.astar.search(targetGraph, resolvedStart, resolvedEnd, searchOptions);
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

    this.cacheMissCount++;

    // Raw A* on the 32u grid is a staircase: ~16-41% longer than the real
    // path (units arrive late / look slow & spaced-out vs the replay) and it
    // zigzags around trees/walls (visible stutter). String-pull it down to
    // line-of-sight straight runs, then re-densify at a fixed spacing for
    // smooth, even client playback. Cache the PROCESSED path so cache hits
    // and misses return identical geometry.
    const processed = this.densifyPath(this.smoothPath(worldPath));

    if (!this.pathCache[cacheStr]) {
      this.pathCache[cacheStr] = processed;
    }

    return {
      isDifferentSpot: true,
      walkPath: processed.slice()
    };
  }

  // Check if a straight line between two grid cells is clear of obstacles.
  // Uses DDA (Digital Differential Analyzer) grid traversal.
  hasLineOfSight (pathing, fromRow, fromCol, toRow, toCol) {
    const maxRow = pathing.length - 1;
    const maxCol = pathing[0].length - 1;

    let dr = toRow - fromRow;
    let dc = toCol - fromCol;
    const steps = Math.max(Math.abs(dr), Math.abs(dc));

    if (steps === 0) return true;

    const rowStep = dr / steps;
    const colStep = dc / steps;

    let prevR = fromRow;
    let prevC = fromCol;

    for (let i = 1; i < steps; i++) {
      const r = Math.round(fromRow + rowStep * i);
      const c = Math.round(fromCol + colStep * i);

      if (r < 0 || r > maxRow || c < 0 || c > maxCol) return false;
      if (pathing[r][c] === BLOCKED_SPOT_WEIGHT) return false;

      // diagonal corner check: if we moved diagonally, both orthogonal
      // neighbors must be clear to prevent cutting through blocked corners
      if (r !== prevR && c !== prevC) {
        if (prevR >= 0 && prevR <= maxRow && c >= 0 && c <= maxCol &&
            pathing[prevR][c] === BLOCKED_SPOT_WEIGHT) return false;
        if (r >= 0 && r <= maxRow && prevC >= 0 && prevC <= maxCol &&
            pathing[r][prevC] === BLOCKED_SPOT_WEIGHT) return false;
      }

      prevR = r;
      prevC = c;
    }

    return true;
  }

  // Remove unnecessary intermediate waypoints from an A* path.
  // Keeps only nodes where direction must change due to obstacles.
  smoothPath (worldPath) {
    if (worldPath.length <= 2) return worldPath;

    const { pathing } = this.grid;
    const smoothed = [worldPath[0]];
    let anchor = 0;

    while (anchor < worldPath.length - 1) {
      let farthest = anchor + 1;

      // try to skip ahead to the farthest visible node from anchor
      for (let probe = anchor + 2; probe < worldPath.length; probe++) {
        const from = worldPath[anchor];
        const to = worldPath[probe];

        if (this.hasLineOfSight(pathing, from.gridRow, from.gridCol, to.gridRow, to.gridCol)) {
          farthest = probe;
        }
      }

      smoothed.push(worldPath[farthest]);
      anchor = farthest;
    }

    return smoothed;
  }

  // Re-densify a smoothed path by inserting intermediate points along long segments.
  // This gives the client frequent position records for smooth visual playback
  // while keeping the clean straight-line directions from smoothing.
  densifyPath (path) {
    if (path.length < 2) return path;

    const maxSegment = 64; // units between interpolated points
    const dense = [path[0]];

    for (let i = 1; i < path.length; i++) {
      const prev = path[i - 1];
      const curr = path[i];
      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > maxSegment) {
        const steps = Math.ceil(dist / maxSegment);
        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          dense.push({
            x: Math.round(prev.x + dx * t),
            y: Math.round(prev.y + dy * t),
            weight: prev.weight
          });
        }
      }

      dense.push(curr);
    }

    return dense;
  }

  logCacheStats () {
    const total = this.cacheHitCount + this.cacheMissCount;
    const hitRate = total > 0 ? ((this.cacheHitCount / total) * 100).toFixed(1) : 0;
    console.log("----------------------------------");
    console.log("PATHFINDING STATS");
    console.log("----------------------------------");
    console.log(`cache hits: ${this.cacheHitCount}, misses: ${this.cacheMissCount}, hit rate: ${hitRate}%`);
    if (this.timers.length) {
      const avgTime = (this.timers.reduce((a, b) => a + b, 0) / this.timers.length).toFixed(2);
      console.log(`avg pathfind time: ${avgTime}ms over ${this.timers.length} searches`);
    }
  }
};

module.exports = PathFinder;
