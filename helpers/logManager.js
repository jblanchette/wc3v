const fs = require('fs'),
      path = require('path'),
      util = require('util');

const config = require("../config/config");
const { debugPlayer, logToConsole } = config;

let logDisabled = false,
    testMode = false,
    productionMode = false;

const Logger = class {
  constructor (logFile) {
    const self = this;
    
    this.outputFile = `${__dirname}/../client/logs/${path.basename(logFile)}.log`;

    this.logDisabled = false;
    this.logStream = null;

    console.logger = (...args) => {
      if (logDisabled || testMode || productionMode) {
        return;
      }

      const msg = args.map((arg, ind) => {
        if (Array.isArray(arg) || typeof(arg) === 'object') {
          return util.inspect(arg, true, 7);  
        } else if (arg && arg.toString) {
          return arg.toString();
        }
        
        return arg
      });

      this.logStream.write(msg.join(' ') + '\n');

      if (logToConsole) {
        console.log(args);
      }
    }
  }

  init () {
    try {
      // remove the old log file
      fs.unlinkSync(this.outputFile);
    } catch (err) { /* no op */ }

    this.logStream = fs.createWriteStream(this.outputFile, { flags: 'a' });
  }

};

const WorkerTracer = class {
  constructor () {
    this.traces = [];
    this.enabled = false;
  }

  enable () {
    this.enabled = true;
  }

  record (entry) {
    if (!this.enabled) return;
    this.traces.push({
      timestamp: Date.now(),
      ...entry
    });
  }

  traceWorkerMutation ({ gameTime, playerId, unitUuid, unitName, field, oldValue, newValue, caller }) {
    this.record({
      type: 'mutation',
      gameTime, playerId, unitUuid, unitName,
      field, oldValue, newValue, caller
    });
  }

  traceSnapshot ({ gameTime, playerId, counts }) {
    this.record({
      type: 'snapshot',
      gameTime, playerId,
      counts: { ...counts }
    });
  }

  getSummary () {
    const byPlayer = {};
    for (const trace of this.traces) {
      const pid = trace.playerId || 'unknown';
      if (!byPlayer[pid]) {
        byPlayer[pid] = { mutations: 0, snapshots: 0, lastSnapshot: null };
      }
      if (trace.type === 'mutation') {
        byPlayer[pid].mutations++;
      } else if (trace.type === 'snapshot') {
        byPlayer[pid].snapshots++;
        byPlayer[pid].lastSnapshot = trace.counts;
      }
    }
    return byPlayer;
  }

  writeToFile (outputPath) {
    fs.writeFileSync(outputPath, JSON.stringify(this.traces, null, 2));
  }

  printSummary () {
    const summary = this.getSummary();
    console.log('\n=== Worker Tracer Summary ===');
    for (const [playerId, data] of Object.entries(summary)) {
      console.log(`  Player ${playerId}: ${data.mutations} mutations, ${data.snapshots} snapshots`);
      if (data.lastSnapshot) {
        console.log(`    Final counts:`, data.lastSnapshot);
      }
    }
    console.log(`  Total trace entries: ${this.traces.length}`);
  }
};

let _tracer = new WorkerTracer();

const getTracer = () => _tracer;
const resetTracer = () => { _tracer = new WorkerTracer(); };

const setLogger = (filename) => {
  _logger = new Logger(filename);
};

const getLogger = () => {
  return _logger;
};

const setDisabledState = (state) => {
  logDisabled = state;
};

const setTestMode = () => {
  testMode = true;
}

const setProductionMode = () => {
  productionMode = true;
};

module.exports = {
  setLogger,
  getLogger,
  setDisabledState,
  setTestMode,
  setProductionMode,
  getTracer,
  resetTracer
};
