var ip = require('ip')
var spawn = require('child_process').spawn
const {setupGoPro, takePicture, listContents, poweroff, getLatestContent, deleteLatestContent, deleteAllContent, startStreaming} = require('./GPWrapper.js')

//Main Camera object
function GoPro (hap, conf) {
	this.hap = hap
	this.conf = conf
	this.services = []
	this.streamControllers = []

	this.pendingSessions = {}
	this.ongoingSessions = {}

	let options = {
		proxy: false, // Requires RTP/RTCP MUX Proxy
		disable_audio_proxy: false, // If proxy = true, you can opt out audio proxy via this
		srtp: true, // Supports SRTP AES_CM_128_HMAC_SHA1_80 encryption
		video: {
			resolutions: [ //OSCAR - get data	from gp_nw.config.modes[0].settings[2]
				//[1920, 1440, 30],
				//[1920, 1080, 30],
				[1280, 960, 30], // Width, Height, framerate
				[1280, 720, 30],
				[848, 480, 30],
				[320, 240, 15] // Apple Watch requires this configuration
				/*[640, 480, 30],
				[640, 360, 30],
				[480, 360, 30],
				[480, 270, 30],
				[320, 240, 30],
				[320, 180, 30]*/
			],
			codec: {
				profiles: [0, 1, 2], // Enum, please refer StreamController.VideoCodecParamProfileIDTypes
				levels: [0, 1, 2] // Enum, please refer StreamController.VideoCodecParamLevelTypes
			}
		},
		audio: {
			comfort_noise: false,
			codecs: [
				{
					type: 'OPUS', // Audio Codec
					samplerate: 24 // 8, 16, 24 KHz
				},
				{
					type: 'AAC-eld',
					samplerate: 16
				}
			]
		}
	}
	this.createGoProControlService()
	this.createStreamControllers(2, options)
}

//Function that handles HomeKit snapshot requests
GoPro.prototype.handleSnapshotRequest = function (request, callback) {
	startStreaming({
		"options": [
			"-video_size",
			(request.width + "x" + request.height),
			"-i",
			"udp://:8554",
			"-vframes",
			"1",
			"-f",
			"mjpeg"
		],
		"onClose": function(buffer) { callback(undefined, buffer) },
		"onStdoutData": function(data, imageBuffer) { imageBuffer = Buffer.concat([imageBuffer, data]) }
	});
}

//Function that handles the closing event
GoPro.prototype.handleCloseConnection = function (connectionID) {
	this.streamControllers.forEach(function (controller) {
		controller.handleCloseConnection(connectionID)
	})
}

//Function invoked when iOS device requires stream
GoPro.prototype.prepareStream = function (request, callback) {

	var sessionInfo = {}
	let sessionID = request['sessionID']
	let targetAddress = request['targetAddress']

	sessionInfo['address'] = targetAddress

	var response = {}

	let videoInfo = request['video']
	if (videoInfo) {
		let targetPort = videoInfo['port']
		let srtpKey = videoInfo['srtp_key']
		let srtpSalt = videoInfo['srtp_salt']

		let videoResp = {
			port: targetPort,
			ssrc: 1,
			srtp_key: srtpKey,
			srtp_salt: srtpSalt
		}

		response['video'] = videoResp

		sessionInfo['video_port'] = targetPort
		sessionInfo['video_srtp'] = Buffer.concat([srtpKey, srtpSalt])
		sessionInfo['video_ssrc'] = 1
	}

	let audioInfo = request['audio']
	if (audioInfo) {
		let targetPort = audioInfo['port']
		let srtpKey = audioInfo['srtp_key']
		let srtpSalt = audioInfo['srtp_salt']

		let audioResp = {
			port: targetPort,
			ssrc: 1,
			srtp_key: srtpKey,
			srtp_salt: srtpSalt
		}

		response['audio'] = audioResp

		sessionInfo['audio_port'] = targetPort
		sessionInfo['audio_srtp'] = Buffer.concat([srtpKey, srtpSalt])
		sessionInfo['audio_ssrc'] = 1
	}

	let currentAddress = ip.address()
	var addressResp = {
		address: currentAddress
	}

	if (ip.isV4Format(currentAddress)) {
		addressResp['type'] = 'v4'
	} else {
		addressResp['type'] = 'v6'
	}

	response['address'] = addressResp
	this.pendingSessions[this.hap.uuid.unparse(sessionID)] = sessionInfo

	callback(response)
}

//Function that handles HomeKit stream requests
GoPro.prototype.handleStreamRequest = function (request) {
	var sessionID = request['sessionID']
	var requestType = request['type']
	if (!sessionID) return
	let sessionIdentifier = this.hap.uuid.unparse(sessionID)

	if (requestType === 'start' && this.pendingSessions[sessionIdentifier]) {
		var width = 1280
		var height = 720
		var fps = 30
		var bitrate = 300

		if (request['video']) {
			width = request['video']['width']
			height = request['video']['height']
			fps = Math.min(fps, request['video']['fps']) // TODO define max fps
			bitrate = request['video']['max_bit_rate']
		}

		//this._v4l2CTLSetCTRL('video_bitrate', `${bitrate}000`)

		let srtp = this.pendingSessions[sessionIdentifier]['video_srtp'].toString('base64')
		let address = this.pendingSessions[sessionIdentifier]['address']
		let port = this.pendingSessions[sessionIdentifier]['video_port']
		let ffmpegCommand = `\
-video_size ${width}x${height} -framerate ${fps} -i udp://:8554 \
-vcodec copy -an -payload_type 99 -ssrc 1 -f rtp \
-srtp_out_suite AES_CM_128_HMAC_SHA1_80 -srtp_out_params ${srtp} \
srtp://${address}:${port}?rtcpport=${port}&localrtcpport=${port}&pkt_size=1378`
		let _that = this

		startStreaming({
			"options": ffmpegCommand.split(' '),
			"onClose": function(buffer) { callback(undefined, buffer) },
			"onStdoutData": function(data, imageBuffer) { imageBuffer = Buffer.concat([imageBuffer, data]) },
			"onReady": function( ffmpeg ) { _that.ongoingSessions[sessionIdentifier] = ffmpeg }
		});

		delete this.pendingSessions[sessionIdentifier]
	}
	if (requestType === 'stop' && this.ongoingSessions[sessionIdentifier]) {
		this.ongoingSessions[sessionIdentifier].kill('SIGKILL')
		delete this.ongoingSessions[sessionIdentifier]
	}
}

//Function that creates characteristics
GoPro.prototype.createGoProControlService = function () {
	var controlService = new this.hap.Service.CameraControl()

	// Characteristic to recognize people's faces

	this.services.push(controlService)
}

// Utility function to create stream controllers
GoPro.prototype.createStreamControllers = function (maxStreams, options) {
	let self = this

	for (var i = 0; i < maxStreams; i++) {
		var streamController = new this.hap.StreamController(i, options, self)

		self.services.push(streamController.service)
		self.streamControllers.push(streamController)
	}
}

module.exports = GoPro