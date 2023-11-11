const fs = require('fs');
const yaml = require('js-yaml');
const InfluxAPI = require('./InfluxAPI');


class ChartConfig {
	constructor(configFilePath, chartConfigFilePath) {
		this.configFilePath = configFilePath;
		this.chartConfigFilePath = chartConfigFilePath;
		this.measurements = [];
		this.loadConfig();
		this.queryApi = InfluxAPI.getInstance();
	
		// Check if the chart config file exists, otherwise make it
		if (fs.existsSync(this.chartConfigFilePath)) {
		  // Load settings from file
		  this.load();
		} else {
		  // Create default settings
		  this.createDefaultSettings();
		}
	}
	
	loadConfig() {
		const fileContents = fs.readFileSync(this.configFilePath, 'utf8');
		const configData = yaml.load(fileContents);
		this.bucket = configData.influxdb.bucket;
	}
	
	save() {
		try {
			const yamlStr = yaml.dump({ measurements: this.measurements });
			fs.writeFileSync(this.filePath, yamlStr, 'utf8');
		} catch (e) {
			console.error(`Failed to save config to ${this.filePath}:`, e);
			throw e;
		}
	}

	update(newSettings) {
		// Update settings and save the file
		Object.assign(this.metrics, newSettings);
		this.save();
	}

	// Function to load measurements and their min/max values
	async createDefaultSettings() {
		// Query to retrieve all measurements from the bucket
		const measurementsQuery = `
			from(bucket: "${this.bucket}")
			|> range(start: -30d)
			|> filter(fn: (r) => r._field == "_measurement")
			|> keep(columns: ["_measurement"])
			|> distinct(column: "_measurement")
			|> group()`;

		try {
			const measurements = await this.executeFluxQuery(measurementsQuery);
			for (let measurement of measurements) {
				// For each measurement, find the min and max values
				const minMaxQuery = `from(bucket: "${this.bucket}")
					|> range(start: -30d) // adjust the range as needed
					|> filter(fn: (r) => r._measurement == "${measurement}")
					|> group()
					|> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
					|> keep(columns: ["_time", "min", "max"])
					|> aggregateWindow(every: v.windowPeriod, fn: min, createEmpty: false)
					|> yield(name: "min")
					|> aggregateWindow(every: v.windowPeriod, fn: max, createEmpty: false)
					|> yield(name: "max")`;

				const minMaxValues = await this.executeFluxQuery(minMaxQuery);
				// Save min and max in your config
				this.measurements.push({
					name: measurement,
					min: minMaxValues[0], // assuming first yield is min
					max: minMaxValues[1]  // assuming second yield is max
				});
			}
		} catch (error) {
			console.error('Error creating default settings:', error);
		}
	}

	// Helper function to execute flux query
	async executeFluxQuery(query) {
		try {
			const results = [];
			const result = await this.queryApi.collectRows(query);
			result.forEach(row => {
			results.push(row);
			});
			return results;
		} catch (error) {
			console.error('Error executing flux query:', error);
			throw error;
		}
	}
	
}



module.exports = ChartConfig;
