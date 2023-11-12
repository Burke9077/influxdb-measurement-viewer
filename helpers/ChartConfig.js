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
		  console.log(`Discovered ${this.chartConfigFilePath}, loading settings as defined.`);
		  this.load();
		} else {
		  // Create default settings
		  console.log(`Chart config file ${this.chartConfigFilePath} was not found, creating default settings.`);
		  this.createDefaultSettings();
		}
	}
	
	loadConfig() {
		const fileContents = fs.readFileSync(this.configFilePath, 'utf8');
		const configData = yaml.load(fileContents);
		this.bucket = configData.influxdb.bucket;
	}

	load() {
        try {
            const fileContents = fs.readFileSync(this.chartConfigFilePath, 'utf8');
            const data = yaml.load(fileContents);
            this.measurements = data.measurements || [];
        } catch (e) {
            console.error(`Failed to load chart config from ${this.chartConfigFilePath}:`, e);
            this.measurements = []; // Reset to empty if there's an error
        }
    }
	
	save() {
		try {
			const yamlStr = yaml.dump({ measurements: this.measurements });
			fs.writeFileSync(this.chartConfigFilePath, yamlStr, 'utf8');
		} catch (e) {
			console.error(`Failed to save config to ${this.filePath}:`, e);
			throw e;
		}
	}

	// Update settings and save the file
	update(newSettings) {
		Object.assign(this.metrics, newSettings);
		this.save();
	}

	// Function to load measurements and their min/max values
	createDefaultSettings() {
		console.log(`Creating default settings.`)
		const measurementsQuery = `
			import "influxdata/influxdb/v1"
			v1.measurements(bucket: "${this.bucket}")`;
	
		this.executeFluxQuery(measurementsQuery)
			.then(measurements => {
				return Promise.all(measurements.map(measurement => {
					console.log(`Discovered measurement for default settings: ${measurement._value}`);
					const minMaxQuery = `
						from(bucket: "${this.bucket}")
						|> range(start: -1y)
						|> filter(fn: (r) => r._measurement == "${measurement._value}")
						|> map(fn: (r) => ({ r with _value: float(v: r._value) })) // Convert all values to floats
						|> reduce(
							fn: (r, accumulator) => ({
								min: if r._value < accumulator.min then r._value else accumulator.min,
								max: if r._value > accumulator.max then r._value else accumulator.max
							}),
							identity: {min: float(v: 9999999999), max: float(v: -9999999999)} // Use large numbers for initialization
						)`;
					return this.executeFluxQuery(minMaxQuery)
						.then(minMaxValues => {
							console.log(`Discovered min/max values for ${measurement._value}.`);
							if (minMaxValues.length > 0) {
								const { min, max } = minMaxValues[0];
								return {
									name: measurement._value,
									min: min,
									max: max,
									measurementDisplayType: "linear"
								};
							}
						});
				}));
			})
			.then(measurementResults => {
				this.measurements = measurementResults.filter(Boolean);
				console.log(`Successfully created default settings.`);
				this.save(); // Save after all measurements have been updated
			})
			.catch(error => {
				console.error('Error creating default settings:', error);
			});
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
