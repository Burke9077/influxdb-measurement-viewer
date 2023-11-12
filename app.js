/*
    Initial app configuration and loading settings
*/

// Configure our app wide configurations
const express = require('express');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { engine } = require('express-handlebars');

// Load the application wide configuration file
const configPath = path.join(__dirname, 'config.yml');
const config = yaml.load(fs.readFileSync(configPath, 'utf8'));

// Initialize and configure influxdb
const InfluxAPI = require('./helpers/InfluxAPI');
InfluxAPI.initialize(config.influxdb);
let queryApi = InfluxAPI.getInstance();


/*
    Initialize the webserver
*/

// Configure our webserver (express)
const app = express();
const hostname = config.server.hostname; // Use hostname from the config
const port = config.server.port;

// Register '.mustache' extension with Express
app.engine('hbs', engine({ 
	extname: '.hbs', 
	defaultLayout: 'main',
	layoutsDir: __dirname + '/views/layouts/',
	partialsDir: __dirname + '/views/partials/'
}));
app.set('view engine', 'hbs');

// Serve static files from the "public" directory
app.use(express.static('public'));

// Configure livereload
const livereload = require('livereload');
const connectLivereload = require('connect-livereload');
const liveReloadServer = livereload.createServer();
liveReloadServer.watch(__dirname, "views");
liveReloadServer.watch(__dirname, "public");
app.use(connectLivereload());


/*
    InfluxDB setup and initial data load
*/

// InfluxDB client setup, make a simple query to check the connection
queryApi.queryRaw('buckets()', {
	org: config.influxdb.org,
})
.then(result => {
	console.log('Successfully connected to InfluxDB');
})
.catch(error => {
	console.error('Error connecting to InfluxDB', error);
});


/*
	Define helper functions for our routes
*/
/*
	getAllMeasurements
	input: queryApi (influxDB object)
	bucketName: influx DB bucket name (String)
	callback: function (err, data)
*/
function getAllMeasurements(queryApi, bucketName, callback) {
	let query = `
	import "influxdata/influxdb/schema"

	schema.measurements(bucket: "${bucketName}")
	`;
	let measurementsArray = [];
	queryApi.queryRows(query, {
		next(row, tableMeta) {
			let o = tableMeta.toObject(row);
			measurementsArray.push(o._value);
		},
		error(error) {
			console.error("\nMeasurement list retrieved with error: \n" + error);
			return callback(error, measurementsArray);
		},
		complete() {
			return callback(null, measurementsArray);
		},
	}); 
};


/*
	Load the chart and metrics configuration
*/
const ChartConfig = require('./helpers/ChartConfig');
const chartConfigPath = path.join(__dirname, 'chart-config.yml');
let chartConfig = new ChartConfig(configPath, chartConfigPath);

// Endpoint to update chart settings
app.post('/api/chart-config', (req, res) => {
	try {
		// Update the config with data sent from client
		chartConfig.update(req.body);
		res.send({ status: 'success' });
	} catch (error) {
		res.status(500).send({ status: 'error', message: error.message });
	}
});


/*
    Serve up web routes
*/

// Serve main index page
app.get('/', (req, res) => {
	res.render('home', { 
		config: config,
		navbar: {home: true},
		pageName: 'Home'
	});
});

// Data trends page
app.get('/data-trends', (req, res) => {
	res.render('data-trends', {
		config: config,
		navbar: {datatrends: true},
		pageName: 'Data Trends'
	});
});


/*
	Finally, start the web server
*/

app.listen(port, hostname, () => {
	console.log(`Server is running on http://${hostname}:${port}`);
});

// Listen for 
process.on('SIGINT', () => {
    console.log('Received SIGINT. Shutting down gracefully.');
    server.close(() => {
        console.log('Server shut down.');
    });
});
