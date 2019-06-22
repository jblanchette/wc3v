const fs = require('fs'),
      path = require('path');

const simpleLogger = require('simple-node-logger');

const Logger = class {
  constructor (logFile, logToConsole = false) {
    const outputFile = `./logs/${path.basename(logFile)}.log`;

    try {
      fs.unlinkSync(outputFile);
    } catch (err) { /* no op */ }

    this.logger = simpleLogger.createSimpleFileLogger(
      outputFile
    );

    this.logToConsole = logToConsole;
    console.logger = this.logger;
  }

  log () {
    const args = Array.from(arguments);

    this.logger.info.apply(null, args);

    if (this.logToConsole) {
      console.log.apply(null, args);
    }
  }
};

const setLogger = (filename) => {
  console.log("making logger");
  
  _logger = new Logger(filename);
};

const getLogger = () => {
  return _logger;
};

module.exports = {
  setLogger: setLogger,
  getLogger: getLogger
};
