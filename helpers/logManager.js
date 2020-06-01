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
    const outputFile = `${__dirname}/../client/logs/${path.basename(logFile)}.log`;

    this.logDisabled = false;

    try {
      // remove the old log file
      fs.unlinkSync(outputFile);
    } catch (err) { /* no op */ }

    this.logStream = productionMode ? fs.createWriteStream(outputFile, { flags: 'a' }) : {};

    console.logger = (...args) => {
      if (logDisabled || testMode) {
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

      if (!productionMode) {
        this.logStream.write(msg.join(' ') + '\n');
      }

      if (logToConsole) {
        console.log(args);
      }
    }
  }


};

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
  setProductionMode
};
