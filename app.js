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
    socket.on('historical-chart', async (data) => {
		let dataf = JSON.stringify(data, null, 4);
		console.log(`Historical chart requested: ${dataf}`);

		// Get the variables we need given the variblegroup
		let variablesRequested = chartConfig.getVariablesByGroupName(data.variableGroup);

		// Prepare the Flux query
        let fluxQuery = buildFluxQuery(variablesRequested, data);
        try {
            // Execute the query
            let results = await queryApi.collectRows(fluxQuery);

			// Modify these results so they can be consumed by the client's chart
			let chartData = transformResultsToChartData(results);

            // Emit the results back to the client
            socket.emit('historical-data', chartData);
        } catch (error) {
            console.error('Error executing flux query:', error);
            // Emit error back to the client
            socket.emit('error', 'Error fetching data');
        }
    });

	// Request a relative (live) chart
    socket.on('relative-chart', async (data) => {
        console.log(`Relative chart requested: ${JSON.stringify(data, null, 4)}`);
    
        // Get variables for the relative chart
        let variablesRequested = chartConfig.getVariablesByGroupName(data.variableGroup);
    
        // Modify the Flux query for relative data
        let fluxQuery = buildFluxQueryRelative(variablesRequested, data); // This function should be defined to handle relative/live data
    
        try {
            let results = await queryApi.collectRows(fluxQuery);
    
            let chartData = transformResultsToChartData(results);
            socket.emit('relative-data', chartData);
        } catch (error) {
            console.error('Error executing relative flux query:', error);
            socket.emit('error', 'Error fetching relative data');
        }
    });
});

// Function to build the Flux query for relative data
function buildFluxQueryRelative(variables, data) {
    // Define the time range for relative data
    const timeRange = data.searchType;
    const [amount, unit] = interpretTimeRange(timeRange);
    const relativeStartDateTime = moment().subtract(amount, unit).toISOString();
    const relativeEndDateTime = moment().toISOString(); // Current time
    const windowPeriodRelative = calculateWindowPeriod(relativeStartDateTime, relativeEndDateTime);

    // Start building the Flux query
    let fluxQuery = `
        from(bucket: "${config.influxdb.bucket}")
        |> range(start: ${timeRange})
        |> filter(fn: (r) => r["_measurement"] == "plc_data")`;

    // Add variable filters similar to the historical query
    if (variables.length > 0) {
        const variableFilters = variables.map(v => `r["VariableName"] == "${v}"`).join(' or ');
        fluxQuery += `
        |> filter(fn: (r) => ${variableFilters})`;
    }

    // Add field filter and any other transformations needed
    fluxQuery += `
        |> filter(fn: (r) => r["_field"] == "value")
        |> aggregateWindow(every: ${windowPeriodRelative}, fn: mean, createEmpty: false)
        |> yield(name: "mean")
        // Add any other transformations or aggregations here
    `;
    return fluxQuery;
};

// Function to interpret time range from a format like "-60s" or "-5m"
function interpretTimeRange(timeRange) {
    const amount = parseInt(timeRange.slice(1, -1));
    const unit = timeRange.slice(-1);

    switch (unit) {
        case 's': return [amount, 'seconds'];
        case 'm': return [amount, 'minutes'];
        case 'h': return [amount, 'hours'];
        case 'd': return [amount, 'days'];
        default: throw new Error('Invalid time range unit');
    }
}

// Function to build the Flux query
function buildFluxQuery(variables, data) {
    // Convert date and time to ISO format
    const startDateTime = moment(`${data.startDate} ${data.startTime}`).toISOString();
    const endDateTime = moment(`${data.endDate} ${data.endTime}`).toISOString();
    const windowPeriodHistorical = calculateWindowPeriod(startDateTime, endDateTime);

    // Start building the Flux query
    let fluxQuery = `
        from(bucket: "${config.influxdb.bucket}")
        |> range(start: ${startDateTime}, stop: ${endDateTime})
        |> filter(fn: (r) => r["_measurement"] == "plc_data")`;

    // Add variable filters
    if (variables.length > 0) {
        const variableFilters = variables.map(v => `r["VariableName"] == "${v}"`).join(' or ');
        fluxQuery += `
        |> filter(fn: (r) => ${variableFilters})`;
    }

    // Add field filter and any other transformations needed
    fluxQuery += `
        |> filter(fn: (r) => r["_field"] == "value")
        |> aggregateWindow(every: ${windowPeriodHistorical}, fn: mean, createEmpty: false)
        |> yield(name: "mean")
        // Add any other transformations or aggregations here
    `;
    return fluxQuery;
};

function calculateWindowPeriod(startDateTime, endDateTime, numDataPoints = 100) {
    // Convert start and end times to moments
    const start = moment(startDateTime);
    const end = moment(endDateTime);

    // Calculate total duration in seconds
    const durationInSeconds = end.diff(start, 'seconds');

    // Calculate window period based on the number of data points
    const windowPeriodInSeconds = Math.ceil(durationInSeconds / numDataPoints);

    // Convert window period to a Flux-friendly format (e.g., 10s, 1m, 1h)
    if (windowPeriodInSeconds < 60) {
        return `${windowPeriodInSeconds}s`;
    } else if (windowPeriodInSeconds < 3600) {
        const windowPeriodInMinutes = Math.ceil(windowPeriodInSeconds / 60);
        return `${windowPeriodInMinutes}m`;
    } else {
        const windowPeriodInHours = Math.ceil(windowPeriodInSeconds / 3600);
        return `${windowPeriodInHours}h`;
    }
}

function transformResultsToChartData(results) {
    // Group results by VariableName
    const groupedResults = results.reduce((acc, item) => {
        if (!acc[item.VariableName]) {
            acc[item.VariableName] = [];
        }
        acc[item.VariableName].push(item);
        return acc;
    }, {});

    // Map each group to a dataset
    const datasets = Object.keys(groupedResults).map((variableName, index) => {
        // Map each data point to the required format
        const dataPoints = groupedResults[variableName].map(item => ({
            x: item._time,
            y: item._value
        }));

        return {
            label: variableName,
            yAxisID: `y${index + 1}`,
            data: dataPoints
        };
    });

    // Generate yAxis options
    const yAxisOptions = datasets.reduce((acc, dataset, index) => {
        acc[`y${index + 1}`] = {
            type: 'linear',
            min: 0,
            max: 200,
            display: true
        };
        return acc;
    }, {});

    // Construct the chart data object
    const chartData = {
        type: 'line',
        data: {
            datasets: datasets
        },
        options: {
            responsive: true,
            scales: yAxisOptions
        }
    };

    return chartData;
};