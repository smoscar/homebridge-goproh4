
let Accessory, hap;

//To expose homebridge to the module
module.exports = function (homebridge) {
	Accessory = homebridge.platformAccessory
	hap = homebridge.hap
	homebridge.registerPlatform('homebridge-gopro-hero', 'gopro-hero', Platform, true)
}

//Create the platform for the integration
function Platform (log, config, api) {
	this.GoProAccessory = require('./GoProAccessory')(hap, Accessory, log)
	this.config = config || {}
	this.api = api
	if (!api || api.version < 2.1) { throw new Error('Unexpected API version.') }
	api.on('didFinishLaunching', this.didFinishLaunching.bind(this))
}

Platform.prototype.configureAccessory = function (accessory) {}

//Function triggered when the API finished launching
Platform.prototype.didFinishLaunching = function () {
	if (!this.config.cameras) return
 	const configuredAccessories = this.config.cameras.map(conf => new this.GoProAccessory(conf))
	this.api.publishCameraAccessories('gopro-hero', configuredAccessories)
}
