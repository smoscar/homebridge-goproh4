const path = require('path')
const fs = require('fs')
const cv = require('opencv4nodejs')
const fr = require('face-recognition').withCv(cv)

exports.cv = cv
exports.fr = fr

exports.drawRects = (win, rects) =>
  rects.forEach(rect => win.addOverlay(rect))

exports.rescaleRect = (rect, f) =>
  new fr.Rect(rect.left * f, rect.top * f, rect.right * f, rect.bottom * f)


const dataPath = path.resolve(__dirname, './data')
const appdataPath = path.resolve(__dirname, './appdata')

exports.getDataPath = () => dataPath

exports.getAppdataPath = () => appdataPath

exports.ensureDataDirExists = () => {
  if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath);
  }
}

exports.ensureAppdataDirExists = () => {
  if (!fs.existsSync(appdataPath)) {
    fs.mkdirSync(appdataPath);
  }
}

