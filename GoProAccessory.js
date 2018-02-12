const packageJSON = require('./package.json')
const GoProSource = require('./GoProSource')

module.exports = (hap, Accessory, log) => class GoProAccessory extends Accessory {
	constructor (conf) {
		conf = conf || {}
		const name = conf.name || 'GoPro Hero'
		const id = conf.id || name
		const uuid = hap.uuid.generate('homebridge-gopro-hero:' + id)
		super(name, uuid, hap.Accessory.Categories.CAMERA) // hap.Accessory.Categories.CAMERA only required for homebridge - ignored by hap-nodejs (standalone)
		this.getService(hap.Service.AccessoryInformation)
			.setCharacteristic(hap.Characteristic.Manufacturer, 'GoPro')
			.setCharacteristic(hap.Characteristic.Model, 'Hero 4')
			.setCharacteristic(hap.Characteristic.SerialNumber, '42')
			.setCharacteristic(hap.Characteristic.FirmwareRevision, packageJSON.version)
		this.on('identify', function (paired, callback) { log('**identify**'); callback() })
		const gpSource = new GoProSource(hap, conf)
		this.configureCameraSource(gpSource)
	}
}