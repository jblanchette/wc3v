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

		console.log("adding event: ", eventItem.uuid);

		this.events.push(eventItem);
		return eventItem;
	}

	updateTime (gameTime) {
		this.timer.lastGameTime = this.timer.gameTime;
		this.timer.gameTime = gameTime;
		this.timer.delta = (gameTime - this.timer.lastGameTime);
	}

	cancelEvent (eventItem) {
		console.log("cancelling event: ", eventItem.uuid);
		console.log("run data - start: ", eventItem.startTime, "time: ", eventItem.time, "runLength: ", eventItem.runLength);
		console.log("event time left: ", (eventItem.runLength - eventItem.time));

		eventItem.cancelled = true;
	}

	process (newGameTime) {
		this.updateTime(newGameTime);
		const { gameTime, lastGameTime } = this.timer;

		this.events.forEach(item => {
			const delta = (gameTime - item.startTime);
			item.time += delta;

			if (item.cancelled) {
				item.completed = true;

				console.log("running onComplete for cancelled item", item);
				item.onComplete(false);
				return;
			}

			if (item.time >= item.runLength) {
				const { startTime, runLength, time } = item;

				item.completed = true;
				item.onComplete(true);
			} else {
				item.onTick(gameTime, delta);
			}
		});

		this.events = this.events.filter(item => {
			return !item.completed;
		})
	}


};

module.exports = EventTimer;