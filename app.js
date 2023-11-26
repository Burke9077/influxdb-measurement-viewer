/*
    Initial app configuration and loading settings
*/

// Configure our app wide configurations
const express = require('express');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { engine } = require('express-handlebars');
const moment = require('moment');

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

// Create HTTP server and integrate with socket.io
const http = require('http');
const { Server } = require('socket.io');
const server = http.createServer(app);
const io = new Server(server);

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
	// Tweak our chartconfig as needed
	let modifiedChartConfig = JSON.parse(JSON.stringify(chartConfig));
	modifiedChartConfig.variablegroups.forEach(group => {
		group.isSelected = (group.name === "All Variables");
	});

	/* 
		Our datepickers need reasonable defaults, what's the current date and the date 
		from 3 days ago (formatted yyyy-MM-dd) that we can send in as defaults?
	*/
	let defaultSearchRange = {
		threeDaysAgo: moment().subtract(3, 'days').format('YYYY-MM-DD'),
		currentDate: moment().format('YYYY-MM-DD')
	};
		
	res.render('data-trends', {
		config: config,
		chartconfig: modifiedChartConfig,
		navbar: {datatrends: true},
		pageName: 'Data Trends',
		defaultSearchRange: defaultSearchRange
	});
});


/*
	Finally, start the web server
*/

server.listen(port, hostname, () => {
	console.log(`Server is running on http://${hostname}:${port}`);
});

// Configure our socket.io server for live events and updating
io.on('connection', (socket) => {
    console.log('A socket.io user connected');
    socket.on('disconnect', () => {
        console.log('A socket.io user disconnected');
    });

    /*
		Listen for data requests from users
	*/

	// Request a historical (date & time range) chart
    socket.on('historical-chart', (data) => {
		let dataf = JSON.stringify(data, null, 4);
		console.log(`Historical chart requested: ${dataf}`);
        // Process the data and emit a response
        io.emit('some response', { some: 'data' });
    });

	// Request a relative (live) chart
    socket.on('relative-chart', (data) => {
		let dataf = JSON.stringify(data, null, 4);
		console.log(`Relative chart requested: ${dataf}`);
        // Process the data and emit a response
        io.emit('some response', { some: 'data' });
    });
});
