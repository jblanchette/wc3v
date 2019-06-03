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
			onCancel: () => {
				eventItem.cancelled = true;
			},
			cancelled: false,
			completed: false
		};

		console.log("Added timer event: ", eventItem.uuid, " at: ", this.timer.gameTime);
		this.events.push(eventItem);

		return eventItem;
	}

	updateTime (gameTime) {
		this.timer.lastGameTime = this.timer.gameTime;
		this.timer.gameTime = gameTime;
		this.timer.delta = (gameTime - this.timer.lastGameTime);
	}

	cancelEvent (eventItem) {
		eventItem.onCancel();
	}

	process (newGameTime) {
		this.updateTime(newGameTime);
		const { gameTime, lastGameTime } = this.timer;

		this.events.forEach(item => {
			const delta = (gameTime - item.startTime);
			item.time += delta;

			if (item.cancelled) {
				console.log("event cancelled", item.uuid);
				item.completed = true;
				return;
			}

			if (item.time >= item.runLength) {
				console.log("event finished", item.uuid);
				console.log("start: ", item.startTime, "goal: ", item.runLength, "complete: ", item.time);

				item.completed = true;
				item.onComplete();
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