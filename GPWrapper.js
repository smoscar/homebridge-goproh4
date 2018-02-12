const fs = require('fs')
const rd = require('readline')
const path = require('path')
const http = require('http')
const https = require('https')
const url = require('url')

const wifi = require('node-wifi')
const GoPro = require('goproh4')
const chp = require('child_process')
const { recognizeFaces, trainModel, cropFaces } = require('./faceDetection')
const { getDataPath, getAppdataPath, ensureAppdataDirExists } = require('./commons')

const ifaceName = 'wlan0' //network interface, set it to NULL for random
const gpConfigFile = `gp_nw.json`


//Function that gets the config file
const getConfig = function(){
	const gpFilePath = path.resolve(getAppdataPath(), gpConfigFile)
	let config = false
		
	//Make sure the config file exists
	if (fs.existsSync(gpFilePath)) {
		config = require(gpFilePath)
	}
	
	return config
};

//Function that saves the config file
const saveConfig = function(config){
	const gpFilePath = path.resolve(getAppdataPath(), gpConfigFile)
	fs.writeFileSync(gpFilePath, JSON.stringify(config))
};

//Function that sets up a new GoPro
const setupGoPro = function(){
	//Initialize wifi interface
	wifi.init({
		ilface: ifaceName
	})
	
	//Utility function that scans networks
	const startScan = function(){
		wifi.scan((err, networks) => {
			if (err){
				console.log("There was an error while scanning for the WiFi:\n" + err + "\n Make sure your WiFi is enabled and try again.")		
			}
			else {
				const ssidList = networks.map( nw => nw.ssid )
			
				//Let the user choose the GoPro WiFi			
				console.log('Available WiFi networks:')
				ssidList.forEach( (name, i) => {
					console.log( (i+1) + '. ' + name)
				});
				console.log("")
				
				// Ask the user for the person's name
				let rl = rd.createInterface( process.stdin, process.stdout )
				rl.setPrompt("Type in your ssid or choose your GoPro's from the list [1-"+ ssidList.length + "] (Hit enter to refresh the list) > " )
				rl.prompt()
			
				//Once the name was received
				rl.on('line', (line) => {
					rl.close()
					
					//If we need to refresh
					if (line == "") {
						startScan()
					}
					else {
						//Connect to the selected Network
						if (typeof ssidList[ parseInt(line -1) ] != "undefined"){
							connectToSSID(networks[ parseInt(line -1) ].ssid)
						}
						//If the ssid was provided
						else {
							connectToSSID( line )
						}
					}
				})
			}
		})	
	};
	
	//Utility function that connects to a GoPro
	const connectToSSID = function( network ){
		console.log("Connecting to: " + network)
		
		// Ask the user for the password
		let rl = rd.createInterface( process.stdin, process.stdout )
		rl.setPrompt("Enter your GoPro's WiFi password > " )
		rl.prompt()
			
		//Once the name was received
		rl.on('line', (line) => {
			rl.close()
			
			//We try to connect to the network
			wifi.connect( { ssid: network, password: line }, (err) => {
				if (err){
					console.log(err)
					return false;
				}
				
				//We store the GoPro's details
				ensureAppdataDirExists() 
				let config = { ssid: network, password: line }
				
				saveConfig(config)
				firstTimeConn(config)
			})
		})
	};
	
	//Manage first time connection
	const firstTimeConn = function(config){
		
		// Provide the user with further instructions
		let rl = rd.createInterface( process.stdin, process.stdout )
		rl.setPrompt("Now turn andd keep the GoPro on by pressing its Menu button (Hit enter when the GoPro's screen is on) > " )
		rl.prompt()
			
		//Once enter was hit
		rl.on('line', (line) => {
			rl.close()
			
			//We get the rest of the needed details from the GoPro
			http.get('http://10.5.5.9/gp/gpControl', res => {
				let body = "";
				res.on("data", data => {
					body += data
				});
				res.on("end", () => {
					body = JSON.parse(body)
					console.log("The GoPro has been successfully added!")
					
					config.ap_mac = body.info.ap_mac.replace(/([0-9a-zA-Z]{2})(?=.)/g, "$1:")
					config.config = body
					
					//We save the camera's details
					saveConfig(config)
				})
			})
		});
	};
	
	//We start scanning for WiFi networks
	startScan()
}

//Function that checks if there's an active connection
const verifyConnection = function (callback) {
	console.log("Verifying Connection") //debug
	//Initialize wifi interface
	wifi.init({
		ilface: ifaceName
	});
	
	// Get the the config file
	let config = getConfig()
	let connected = false
		
	//Make sure the config file exists
	if (!config) {
		console.log("No devices have been configured. Try setting up your device first")
		
		// Execute the callback
			if (typeof callback == "function")
				callback(connected)
	}
	else {
		
		console.log("Getting current wifi connections") //debug
		
		//We check for current connections
		wifi.getCurrentConnections( (err, currentConnections) => {
			if (err){
				console.log(err)
			}
			
			//We check if we are currently connected to the GoPro
			currentConnections.forEach( conn => {
				connected = connected || conn.ssid == config.ssid 
			})
			
			// Execute the callback with the connections
			if (typeof callback == "function")
				callback(connected)
		})	
	}
};
	
//Function that disconnects from the GoPro
const disconnectFromGoPro = function(){
	wifi.disconnect( (err) => {
		if (err){
				console.log(err)
			}
			console.log("Disconnected")
	});
};

//Function that turns off the camera
const poweroff = function(){
	// Get the the config file
	let config = getConfig();

	//We instantiate the camera 
	cam = new GoPro.Camera({
		mac: config.ap_mac
	});
		
	cam.ready().then(function () {
		// Turn the camera off
		return cam.powerOff();
	});
}

//Function that powers on the camera
const powerOn = function(usrCallback, confirmConnection){
	// Get the the config file
	let config = getConfig();
	let maximumTries = 50;
	let internalInterval
	let cam
	
	//The Hero 4 Session takes a little bit to register clients connected.
	//When needed the connection will be confirmed with the camera (Streaming)
	confirmConnection = typeof confirmConnection == "undefined" ? false : confirmConnection
	confirmConnection = confirmConnection && ( config.config.info.firmware_version.indexOf("HX") >= 0 )
	
	//Since the poweron function does not return a promise we creat a utility function that waits for the camera to be ready 
	const whenCamReady = function(callback){
		
		cam.status().then(function (status) {
			//We check for the connection
			if (confirmConnection){
				if (status.status[31] > 0) {
					console.log("Status received") //debug
					callback(cam, status)
				}
				else if (maximumTries > 0){
					maximumTries--
					setTimeout( function(){ whenCamReady( callback ) }, 100 );
				}
			}
			else {
				console.log("Status received") //debug
				callback(cam, status)
			}
		}, function(e){
			if (maximumTries > 0){
				maximumTries--
				setTimeout( function(){ whenCamReady( callback ) }, 100 );
			}
			else {
				console.log("ERROR");
			}
			
			console.log("Error ") //debug
			});
	};	
		
	//If there's no config available
	if (!config) {
		console.log("No devices have been configured. Try setting up your device first")
		
		// Execute the callback
			if (typeof usrCallback == "function")
				usrCallback(false)
	}
	else {
		
		console.log("Instantiating GoPro: " + config.ap_mac) //debug
		
		//We instantiate the camera 
		cam = new GoPro.Camera({
			mac: config.ap_mac
		});
		
		cam.ready().then(function () {
			
			console.log("GoPro ready, powering on") //debug
			cam.powerOn()
			console.log("Getting cam status:" ) //debug
			
			whenCamReady((cam, status)=>{
				usrCallback(cam, status);
			}) 
		});
	}
};

//Function that takes a picture 
const takePicture = function(callback){
	//We verify there's a connection to the GoPro
	verifyConnection( (isConnected) => {
		// If there's an active connection
		if (isConnected){
			//We wake up the GoPro
			powerOn( (cam) => {
				// Set camera mode
				cam.mode(GoPro.Settings.Modes.Photo, GoPro.Settings.Submodes.Photo.Single).then(function () {
					// Execute the callback
					if (typeof callback == "function")
						callback(cam.start())
					else 
						return cam.start()
				})
			});
		}
	})
};

//Function that lists the GoPro contents
const listContents = function() {
	//We verify there's a connection to the GoPro
	verifyConnection( (isConnected) => {
		// If there's an active connection
		if (isConnected){
			//We wake up the GoPro
			powerOn( (cam) => {

				cam.listMedia().then(function (result) {

					//For each directory the camera has
					result.media.forEach(function (directory) {
						
						console.log('[directory] =', directory.d);
						// For each file in this directory
						directory.fs.forEach(function (file) {

							var dateTaken = new Date(file.mod * 1000); /* x1000 timestamp unix > timestamp ms */
							var size = file.s / 1000000; /* byte to mb */
							var name = file.n; /* filename */

							if (file.g !== undefined) { // burst
								var burstId = file.g;
								var startingId = file.b;
								var endId = file.l;

								var numberOfPics = (endId - startingId) + 1;
							}
							console.log('[url] = ', 'http://' + cam._ip + '/videos/DCIM/' + directory.d + '/' + file.n);
						});
					});
					});
			});
		}
	})
};

//Function that retrieves the GoPro media
const getLatestContent = function(callback){
	//We verify there's a connection to the GoPro
	verifyConnection( (isConnected) => {
		// If there's an active connection
		if (isConnected){
			//We wake up the GoPro
			powerOn( (cam) => {
				
				cam.listMedia().then(function (result) {

					var lastDirectory = result.media[result.media.length - 1];
					var lastFile = lastDirectory.fs[lastDirectory.fs.length - 1];
					// get last media
					cam.getMedia(lastDirectory.d, lastFile.n, getDataPath() + '/photos/' + lastFile.n).then(function (filename) {
						// Execute the callback
						if (typeof callback == "function")
							callback(getDataPath() + '/photos/' + lastFile.n)
					});
					});
			});
		}
	})
};

//Function to delete the latest media in the GoPro
const deleteLatestContent = function(callback){
	//We verify there's a connection to the GoPro
	verifyConnection( (isConnected) => {
		// If there's an active connection
		if (isConnected){
			//We wake up the GoPro
			powerOn( (cam) => {
				//The latest media gets deleted
				cam.deleteLast().then(function () {
					
					console.log('Last media deleted'); //debug

					// Execute the callback
					if (typeof callback == "function")
						callback()
				});
			});
		}
	})
};

//Function that deletes all the media in the GoPro
const deleteAllContent = function(callback){
	//We verify there's a connection to the GoPro
	verifyConnection( (isConnected) => {
		// If there's an active connection
		if (isConnected){
			//We wake up the GoPro
			powerOn( (cam) => {
				//The latest media gets deleted
				cam.deleteAll().then(function () {

					console.log('Storage cleared'); //debug

					// Execute the callback
					if (typeof callback == "function")
						callback()
				});
			});
		}
	})
};

//Function that initializes the video streaming
const startStreaming = function( config ){
	
	//We verify there's a connection to the GoPro
	verifyConnection( (isConnected) => {
		// If there's an active connection
		if (isConnected){
			//We wake up the GoPro
			powerOn( (cam) => {
				//The media stream gets started
				cam.restartStream().then(function () {

					console.log('Stream initiated'); //debug
		
					var spawn_process = function () {
						var ffmpeg = chp.spawn("ffmpeg", config.options);
						var helpBuffer = Buffer(0)
						
						ffmpeg.stdout.pipe(process.stdout);
						ffmpeg.stderr.pipe(process.stdout);
						ffmpeg.on('exit', function () {
							spawn_process(); 
						});
						
						//If there's a callback on data stdout
						if (typeof config.onStdoutData == "function")
							ffmpeg.stdout.on('data', function (data) { config.onStdoutData( data, helpBuffer ) })
							
						//If there's a callback on close
						if (typeof config.onClose == "function")
							ffmpeg.on('close', function (code) { config.onClose(imageBuffer) });
						
						//If there's a callback on ready
						if (typeof config.onReady == "function")
							onReady( ffmpeg )
					};
					spawn_process(); 
	
				});
			}, true);
		}
	});
};

//The functions are exported
exports.setupGoPro = setupGoPro
exports.takePicture = takePicture
exports.listContents = listContents
exports.poweroff = poweroff
exports.getLatestContent = getLatestContent
exports.deleteLatestContent = deleteLatestContent
exports.deleteAllContent = deleteAllContent
exports.startStreaming = startStreaming

//###### USAGE ######

//Use this when initial setup is needed
//setupGoPro()

//Use this to take pictures
//takePicture(function(res){
//	console.log(res)
//})

//Use this function to list media
//listContents()

//Use this function to turnoff the GoPro
//poweroff()

//Use this function to download media into the dest folder
//getLatestContent((filePath) => {
//	console.log(filePath)
//})

//Use this function to delete the latest photo or video
//deleteLatestContent(() => {
//	console.log("Last Item Deleted")
//})

//Use this function to delete all media in the GoPro
//deleteAllContent(() => {
//	console.log("Every Item Deleted")
//})

//Use this function to stream the GoPro
/*startStreaming( 
	{ "options": [
		"-i",
		"udp://:8554", // Stream input coming from the GoPro
		"-probesize", //probing size to lower latency
		"8192",
		"-f",
		"mpeg1video",
		"-b",
		"800k",
		"-r",
		"30",
		("http://127.0.0.1:8082/publish")
	]}
)*/

//verifyConnection( (isConnected) => {
	// If there's an active connection
//	if (isConnected){
//		//We wake up the GoPro
//		powerOn( (cam) => {
//		})
//	}
//})
