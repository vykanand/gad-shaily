const fs = require('fs')
const path = require('path')
const fsp = fs.promises

async function copyDir(src, dest) {
  await fsp.mkdir(dest, { recursive: true })
  const entries = await fsp.readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath)
    } else if (entry.isFile()) {
      await fsp.copyFile(srcPath, destPath)
    }
  }
}

async function main() {
  try {
    const repoRoot = path.resolve(__dirname, '..')
    const src = path.join(repoRoot, 'build')
    const dest = path.join(repoRoot, 'dist', 'win-unpacked')
    if (!fs.existsSync(src)) {
      console.error('Source build folder not found:', src)
      process.exit(0)
    }
    if (!fs.existsSync(dest)) {
      console.error('Destination not found (run build first):', dest)
      process.exit(1)
    }
    await copyDir(src, dest)
    console.log('Copied build/* to', dest)
  } catch (e) {
    console.error('Copy failed:', e)
    process.exitCode = 1
  }
}

main()
