class MissingMapError extends Error {
  constructor(message, mapData) {
    super("missing-map-data");
    this.name = "MissingMapError";

    this.data = mapData;
  }
};

module.exports = MissingMapError;
