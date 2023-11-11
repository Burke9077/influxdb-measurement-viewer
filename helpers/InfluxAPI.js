// InfluxAPI.js
const { InfluxDB } = require('@influxdata/influxdb-client');

class InfluxAPI {
	constructor() {
		if (!InfluxAPI.instance) {
			throw new Error('Cannot instantiate directly.');
		}
	}

	static initialize(config) {
		const influxDB = new InfluxDB({
			url: config.url,
			token: config.token,
		});
		InfluxAPI.instance = influxDB.getQueryApi(config.org);
	}

	static getInstance() {
		if (!InfluxAPI.instance) {
			throw new Error('InfluxAPI is not initialized.');
		}
		return InfluxAPI.instance;
	}
}

module.exports = InfluxAPI;
