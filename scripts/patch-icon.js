const path = require('path')
const fs = require('fs')
const rcedit = require('rcedit')

async function main() {
  try {
    const exe = path.resolve(__dirname, '..', 'dist', 'win-unpacked', 'GAD QR Scanner.exe')
    const ico = path.resolve(__dirname, '..', 'build', 'qr.ico')
    if (!fs.existsSync(exe)) throw new Error(`${exe} not found — was the build successful?`)
    if (!fs.existsSync(ico)) throw new Error(`${ico} not found — run npm run make-icon first`)
    console.log('Patching icon on', exe)
    await rcedit(exe, { icon: ico })
    console.log('Patched icon successfully')
  } catch (e) {
    console.error('Failed to patch icon:', e)
    process.exitCode = 1
  }
}

main()
