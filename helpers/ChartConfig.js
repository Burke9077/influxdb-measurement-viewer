import fs from 'fs';
import yaml from 'js-yaml';
import InfluxAPI from './InfluxAPI.js';

class ChartConfig {
	constructor(configFilePath, chartConfigFilePath) {
		this.configFilePath = configFilePath;
		this.chartConfigFilePath = chartConfigFilePath;
		this.measurements = [];
		this.variablegroups = [];
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
			this.variablegroups = data.variablegroups || [];
        } catch (e) {
            console.error(`Failed to load chart config from ${this.chartConfigFilePath}:`, e);
            this.measurements = []; // Reset to empty if there's an error
        }
    }
	
	save() {
		try {
			const yamlStr = yaml.dump({ measurements: this.measurements, variablegroups: this.variablegroups });
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
		console.log(`Creating default settings.`);
		const defaultSearchWindow = `-30d`;
		const colorPalette = ['#3366cc', '#ff9900', '#109618', '#b3e3f0', '#dd4477', '#66aa00', '#316395'];

		const fieldsQuery = `
			from(bucket: "${this.bucket}")
			|> range(start: ${defaultSearchWindow})
			|> filter(fn: (r) => r._measurement == "plc_data")
			|> keep(columns: ["VariableName"])
			|> distinct(column: "VariableName")`;
		
		this.executeFluxQuery(fieldsQuery).then(fields => {
			// Use the VariableName property from the query results
			return Promise.all(fields.map((field, index) => {
				// Assign a color from the palette, cycling through if necessary
				const color = colorPalette[index % colorPalette.length];

				const minMaxQuery = `
					from(bucket: "${this.bucket}")
					|> range(start: ${defaultSearchWindow})
					|> filter(fn: (r) => r._measurement == "plc_data" and r.VariableName == "${field.VariableName}")
					|> map(fn: (r) => ({ r with _value: float(v: r._value) }))
					|> reduce(
						fn: (r, accumulator) => ({
						min: if r._value < accumulator.min then r._value else accumulator.min,
						max: if r._value > accumulator.max then r._value else accumulator.max
						}),
						identity: {min: float(v: 9999999999), max: float(v: -9999999999)}
					)`;
		
				return this.executeFluxQuery(minMaxQuery)
				.then(minMaxValues => {
					if (minMaxValues.length > 0) {
						const { min, max } = minMaxValues[0];
						return {
							name: field.VariableName, // Use VariableName as the name
							ymin: min,
							ymax: max,
							yAxisDisplayType: "linear",
							color: color,
							units: "undefined",
							numericFormat: "%.2f"
						};
					} else {
						return null;
					}
				});
			}));
		}).then(measurementResults => {
			this.measurements = measurementResults.filter(Boolean); // Filter out null results
			let defaultVariableGroup = {
				name: "All Variables",
				variables: this.measurements.map(m => m.name) // Map to the names of the measurements
			};
			this.variablegroups = [defaultVariableGroup];
			this.save(); // Save after all measurements have been updated
		}).catch(error => {
			console.error('Error creating default settings:', error);
		});
	}

	// Method to get variables by group name
	getVariablesByGroupName(groupName) {
		const group = this.variablegroups.find(g => g.name === groupName);
		return group ? group.variables : [];
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

export default ChartConfig;
