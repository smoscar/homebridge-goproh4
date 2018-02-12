const fs = require('fs')
const rd = require('readline')
const path = require('path')
const { fr, getDataPath, getAppdataPath, ensureDataDirExists, ensureAppdataDirExists, cv } = require('./commons')

//Function that makes sure the window kills process on exit and the directories exist
const faceInit = function() {
	fr.winKillProcessOnExit()
	ensureDataDirExists()
	ensureAppdataDirExists()
}

//Utility function to get files in directory
const getFaceFiles = function( callback ){
	ensureDataDirExists()
	let srcPath = getDataPath() + '/faces/' 
	
	fs.readdir(srcPath, (err, items) => {
		items = items.map(file => (srcPath + file))
		// Execute the callback with the files
		if (typeof callback == "function")
			callback(items)
	})
}

//Function that detects and saves faces
const detectFaces = function( srcPath, rescaleFactor ){
	faceInit();
	rescaleFactor = typeof rescaleFactor == "undefined" ? 1 : rescaleFactor	
	
	const detector = fr.FaceDetector()
	const cvMat = cv.imread( srcPath ).rescale(rescaleFactor)
	const img = fr.CvImage(cvMat)

	console.log('detecting faces')
	const faceRects = detector.locateFaces(img) 

	const faces = faceRects
   	 .map( mmodRect => fr.toCvRect( mmodRect.rect ))
   	 .map( cvRect => cvMat.getRegion(cvRect).copy().resizeToMax(150) ) 
	
	// If no faces were detected 
	if (faces.length == 0) {
		return false;	
	}
	
	return faces
}

// Function that crops and saves faces found in photos
const cropFaces = function( srcPath ){
	// We load the requested image
	const faces = detectFaces( srcPath )
	
	const winNameReg = srcPath.match( RegExp('[a-zA-Z0-9]+(?=\.JPG)', 'gi') )
	faces.forEach((face, i) => {
   	//cv.imshow( winNameReg + "-" + i, face)
   	cv.imwrite( getDataPath() + '/faces/' + winNameReg + '.jpg', face )
	});
}

//Function that recognizes faces
const recognizeFaces = function( srcPath, rescaleFactor ){
	faceInit();
	console.log('Recognizing faces')
	
	// We loook for faces in image provided
	const faces = detectFaces( srcPath, rescaleFactor )
	const unkownThreshold = 0.6
			
	// Set the path of the trained model
	const trainedModelFile = `faceRecognition1Model_150.json`
	const trainedModelFilePath = path.resolve(getAppdataPath(), trainedModelFile)
	const recognizer = fr.FaceRecognizer()
	
	//Make sure the trained model exists
	if (fs.existsSync(trainedModelFilePath)) {
		
		recognizer.load( require( trainedModelFilePath ) )
		console.log(faces.length + " faces found in image. Beginning recognition...")
		
		faces.forEach((cvMat, i) => {
			const img = fr.CvImage(cvMat)
			const prediction = recognizer.predictBest(img, unkownThreshold)
 			console.log('Face %d: %s (%s)', i, prediction.className, prediction.distance)
 			
 			cv.imshow( "Face " + i, cvMat)
 			cv.waitKey()
 		})
 		
 		return true
	}
	else {
		console.log("Trained model not found")
		return false;
	}
}

//Function that trains the system
const trainModel = function(){
	//We ask an input for each file
	getFaceFiles((files) => {
		let names = []
		let filesCopy = files.slice()
		//If images were found
		if (files.length > 0) {
			
			//We  load previously created models
			const trainedDictFile = `faceRecognition1ModelDict_150.json`
			const trainedDictFilePath = path.resolve(getAppdataPath(), trainedDictFile)
			const recognizer = fr.FaceRecognizer()
			let prevData = {"images": {}, "names": []}
	
			//We load previously created models
			if (fs.existsSync(trainedDictFilePath)) {
				prevData = require(trainedDictFilePath)
			}
	
			//We process every file sequentially
			let seqProcess = file => {
				//We show the picture 
				let cvMat = cv.imread( file )
				cv.imshow( "Who is this?", cvMat)
				
				// We get the name suggestion
				let imgName = file.replace( ( getDataPath() + '/faces/' ), '' )
				let possibleName = typeof prevData[ 'images' ][ imgName ] !== "undefined" ? prevData['names'][ prevData[ 'images' ][ imgName ] ] : ( names.length > 0 ? names[ names.length -1 ]  : '' )
			
				// Ask the user for the person's name
				let rl = rd.createInterface( process.stdin, process.stdout )
				rl.setPrompt('What is the name of the person in the picture ' + ( possibleName != "" ? ('( Hit enter for ' + possibleName + ' ) ') : '') + '> ')
				rl.prompt()
			
				//Once the name was received
				rl.on('line', (line) => {
					
					names.push( ( possibleName != "" ? possibleName : line ) )
					rl.close()
					cv.destroyAllWindows()

					// If there are still files to process
					if (files.length > 0){
						seqProcess(files.shift())					
					}
					else {
						//We start the training process
						beginTraining(filesCopy, names)				
					}
				})
				cv.waitKey()
			}
			
			//Start the process
			seqProcess(files.shift())
		}
	})
}

//Function that generates a model with the input received
const beginTraining = function(files, names) {
	
	ensureAppdataDirExists()	
	console.log('Starting training')
		
	// Set the path of the trained models
	const trainedModelFile = `faceRecognition1Model_150.json`
	const trainedDictFile = `faceRecognition1ModelDict_150.json`
	const trainedModelFilePath = path.resolve(getAppdataPath(), trainedModelFile)
	const trainedDictFilePath = path.resolve(getAppdataPath(), trainedDictFile)
	const recognizer = fr.FaceRecognizer()
	
	//We load each image into its classifier
	let imagesByClass = {}
	let imagesByName = {}
	files.forEach((file, i) => {
		imagesByClass[ names[i] ] = typeof imagesByClass[ names[i] ] == "undefined" ? [] : imagesByClass[ names[i] ]
		imagesByClass[ names[i] ].push( fr.loadImage(file) )
		
		const imgName = file.replace( ( getDataPath() + '/faces/' ), '' )
		imagesByName[ imgName  ] = i
	})
	
	//We add each face to the recognizer
	Object.keys(imagesByClass).forEach( name => {
		recognizer.addFaces(imagesByClass[name], name)
	})
	
	//We save both files
	fs.writeFileSync(trainedModelFilePath, JSON.stringify(recognizer.serialize()))
	fs.writeFileSync(trainedDictFilePath, JSON.stringify( {"images": imagesByName, "names": names} ))
}

//The functions are exported
exports.recognizeFaces = recognizeFaces
exports.trainModel = trainModel
exports.cropFaces = cropFaces

//###### USAGE ######

//Use to recognize faces in one miage
//recognizeFaces( getDataPath() + '/photos/bbt1.jpg', 0.7 ) //50%
//recognizeFaces( getDataPath() + '/photos/bbt2.jpg' ) //50%
//recognizeFaces( getDataPath() + '/photos/bbt3.jpg' ) //WEIRD - only detects 1 face
//recognizeFaces( getDataPath() + '/photos/bbt4.jpg' ) //100%
//recognizeFaces( getDataPath() + '/photos/bbt5.jpg' ) //50%
//recognizeFaces( getDataPath() + '/photos/GOPR0287.JPG', 0.2  )

//Use to train the model using the images on file
//trainModel()

//Use this while retrieving a picture from the gopro 
//let index = 287;
//for (let i=0; i<1; i++){
//	cropFaces( getDataPath() + '/photos/GOPR0' + (index++) + '.JPG' )
//}

