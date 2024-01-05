# InfluxDB_Data_Plotter

This is a web app that can load and plot data in a browser from an influx database. It's purpose is to integrate into a TwinCAT HMI to plot logged data from the PLC stored in an Influx database.

# Setting Up Development
Install node.js 20.10.0 LTS and npm, ideally using nvm, node version manager: https://docs.npmjs.com/downloading-and-installing-node-js-and-npm#using-a-node-version-manager-to-install-nodejs-and-npm
`nvm install --lts` should get the latest LTS version of node.js and npm and install it. 

It is recommended to use VS Code as the development environment. Clone the repository and open the folder in VS Code. Open a terminal in VS code in the project directory and enter `npm install`. This will install the required packages listed in the package.json file. For development purposes, it is helpful to run the app with nodemon. nodemon will watch files for changes on save and automatically restart the webserver for you. Install it with `npm install -g nodemon`. To run the program, enter `nodemon app.js` in the terminal.

# Setting up config.yml
Create a config.yml file in the project folder with the following structure, replacing the fields necessary for your test environment (influxdb url and token most likely):
```yml
# config.yml
app:
  appName: "Coater M Trends"
  authentication: 
    requireAuthentication: false
    username: 'Administrator'

server:
  hostname: '127.0.0.1'
  port: 3005

influxdb:
  url: 'http://localhost:8086'
  token: 'zvPR7KJNzx1-3-X3Ux8bq7S9T52sez-cvif-shZLCjorRw8NnlY3ZKjOA4A6XjRwQC-PlrAJU7D-06kifcVVLQ=='
  org: 'Optimax'
  bucket: 'DBTest'
  ```

  Do not add this yml file to version control as it will be different for all developers!
