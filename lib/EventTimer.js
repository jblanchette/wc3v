const utils = require("../helpers/utils");

const EventTimer = class {
  constructor () {
    this.timer = {
      gameTime: 0,
      lastGameTime: 0,
      delta: 0
    };

    this.events = [];
  }

  addEvent (runLength, onTick, onComplete) {
    const startTime = this.timer.gameTime;

    const eventItem = {
      uuid: utils.uuidv4(),
      startTime: startTime,
      endTime: startTime + runLength,
      runLength: runLength,
      time: 0,
      onTick: onTick,
      onComplete: onComplete,
      cancelled: false,
      completed: false
    };

    this.events.push(eventItem);
    return eventItem;
  }

  updateTime (gameTime) {
    this.timer.lastGameTime = this.timer.gameTime;
    this.timer.gameTime = gameTime;
    this.timer.delta = (gameTime - this.timer.lastGameTime);
  }

  cancelEvent (eventItem) {
    eventItem.endTime = this.timer.gameTime;
    eventItem.cancelled = true;
    eventItem.completed = true;

    eventItem.onComplete(false);
  }

  process (newGameTime) {
    this.updateTime(newGameTime);
    const { gameTime, lastGameTime, delta } = this.timer;

    this.events.forEach(item => {
      if (item.completed) {
        return;
      }

      item.time += delta;

      if (gameTime >= item.endTime) {
        const { startTime, runLength, time } = item;

        item.completed = true;
        item.onComplete(true);
      } else {
        item.onTick(gameTime, delta);
      }
    });

    const beforeCount = this.events.length;
    this.events = this.events.filter(item => {
      return !item.completed;
    });

    const afterCount = this.events.length;
    if (beforeCount > afterCount) {
      console.logger(`removed ${(beforeCount - afterCount)} events`);
    }
  }


};

module.exports = EventTimer;
