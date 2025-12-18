const fs = require('fs')
const path = require('path')
const sharp = require('sharp')
const pngToIco = require('png-to-ico')

const SRC = path.resolve(__dirname, '..', 'build', 'qr.jpeg')
const OUT_DIR = path.resolve(__dirname, '..', 'build')
const OUT_ICO = path.join(OUT_DIR, 'qr.ico')
async function main() {
  try {
    if (!fs.existsSync(SRC)) throw new Error(`${SRC} not found`)
    const p256 = path.join(OUT_DIR, `qr_256.png`)
    await sharp(SRC).resize(256, 256, { fit: 'cover' }).png().toFile(p256)
    const buf = fs.readFileSync(p256)
    const icoBuffer = await pngToIco(buf)
    fs.writeFileSync(OUT_ICO, icoBuffer)
    fs.unlinkSync(p256)
    console.log('Created', OUT_ICO)
  } catch (e) {
    console.error('Failed to create ico:', e)
    process.exitCode = 1
  }
}

main()
