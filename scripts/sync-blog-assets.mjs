import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  copyFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function safeAssetName(name, relativePath) {
  if (
    !name ||
    /[<>:"|?*\u0000-\u001f]/.test(name) ||
    /[. ]$/.test(name) ||
    /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)
  ) {
    throw new Error(`Asset path is not safe to check out on all supported platforms: ${relativePath}`)
  }
}

function collectAssets(sourceRoot, currentDirectory = sourceRoot, assets = [], normalizedPaths = new Set()) {
  const entries = readdirSync(currentDirectory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') throw new Error(`Asset directory contains unsupported data: ${entry.name}`)
    const absolutePath = path.join(currentDirectory, entry.name)
    const relativePath = path.relative(sourceRoot, absolutePath).split(path.sep).join('/')
    safeAssetName(entry.name, relativePath)
    const normalizedPath = relativePath.normalize('NFC').toLocaleLowerCase('en-US')
    if (normalizedPaths.has(normalizedPath)) throw new Error(`Asset paths collide on a supported file system: ${relativePath}`)
    normalizedPaths.add(normalizedPath)
    const info = lstatSync(absolutePath)
    if (info.isSymbolicLink()) throw new Error(`Asset symlinks are not supported: ${relativePath}`)
    if (info.isDirectory()) {
      collectAssets(sourceRoot, absolutePath, assets, normalizedPaths)
    } else if (info.isFile() && entry.name !== '.gitkeep' && entry.name !== '.DS_Store') {
      assets.push(relativePath)
    } else if (!info.isFile()) {
      throw new Error(`Asset is not a regular file or directory: ${relativePath}`)
    }
  }
  return assets
}

export function syncBlogAssets(projectRoot = process.cwd()) {
  const root = path.resolve(projectRoot)
  const sourceRoot = path.join(root, '.blog', 'assets')
  const destinationRoot = path.join(root, 'blog', 'public', 'assets')
  const sourceInfo = lstatSync(sourceRoot)
  if (!sourceInfo.isDirectory()) throw new Error('.blog/assets must be a directory.')
  if (existsSync(destinationRoot) && !lstatSync(destinationRoot).isDirectory()) {
    throw new Error('blog/public/assets must be a directory before syncing assets.')
  }
  const assets = collectAssets(sourceRoot)
  rmSync(destinationRoot, { recursive: true, force: true })
  mkdirSync(destinationRoot, { recursive: true })
  for (const relativePath of assets) {
    const destination = path.join(destinationRoot, relativePath)
    mkdirSync(path.dirname(destination), { recursive: true })
    copyFileSync(path.join(sourceRoot, relativePath), destination)
  }
  process.stdout.write(`Synchronized ${assets.length} public asset${assets.length === 1 ? '' : 's'}.\n`)
  return assets.length
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    syncBlogAssets()
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
