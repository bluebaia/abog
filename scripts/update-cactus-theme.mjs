import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizedCactusContents } from './cactus-adapter.mjs'

const repository = 'https://github.com/chrismwilliams/astro-theme-cactus.git'
const metadataPath = '.template/theme-source.json'
const compatibilityPath = '.template/cactus-compatibility.json'
const catalogPath = '.template/theme-catalog.json'

function git(directory, args) {
  return execFileSync('git', ['-C', directory, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function hash(contents) {
  const canonical = contents.includes(0)
    ? contents
    : Buffer.from(contents.toString('utf8').replace(/\r\n/g, '\n'))
  return createHash('sha256').update(canonical).digest('hex')
}

function safePath(value) {
  return typeof value === 'string' &&
    !path.isAbsolute(value) &&
    !value.includes('\\') &&
    value.split('/').every(part => part && part !== '.' && part !== '..' && !part.includes(':'))
}

function regularFile(root, relativePath) {
  let current = root
  const parts = relativePath.split('/')
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part)
    let info
    try {
      info = lstatSync(current)
    } catch (error) {
      if (error.code === 'ENOENT') return false
      throw error
    }
    if (index === parts.length - 1 ? !info.isFile() : !info.isDirectory()) return false
  }
  return true
}

function readJson(root, relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'))
}

function readMetadata(root) {
  const metadata = readJson(root, metadataPath)
  if (
    metadata.formatVersion !== 1 ||
    metadata.theme !== 'astro-cactus' ||
    metadata.repository !== repository ||
    !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(metadata.ref) ||
    !/^[0-9a-f]{40}$/.test(metadata.commit) ||
    !metadata.files || Array.isArray(metadata.files) || typeof metadata.files !== 'object' ||
    !metadata.adapterFiles || Array.isArray(metadata.adapterFiles) || typeof metadata.adapterFiles !== 'object' ||
    !Object.keys(metadata.files).length ||
    [...Object.entries(metadata.files), ...Object.entries(metadata.adapterFiles)].some(([file, digest]) => !safePath(file) || !/^[0-9a-f]{64}$/.test(digest))
  ) {
    throw new Error(`Active Astro Cactus source metadata is invalid: ${metadataPath}`)
  }
  return metadata
}

function readRegistry(root) {
  const registry = readJson(root, compatibilityPath)
  if (
    registry.formatVersion !== 1 ||
    registry.theme !== 'astro-cactus' ||
    registry.repository !== repository ||
    !Array.isArray(registry.verifiedReleases) ||
    registry.verifiedReleases.length === 0 ||
    registry.verifiedReleases.some(release =>
      !release ||
      !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(release.ref) ||
      !/^[0-9a-f]{40}$/.test(release.commit),
    ) ||
    new Set(registry.verifiedReleases.map(release => release.ref)).size !== registry.verifiedReleases.length
  ) {
    throw new Error(`Astro Cactus compatibility registry is invalid: ${compatibilityPath}`)
  }
  return registry
}

function verifyManagedFiles(root, metadata) {
  const files = { ...metadata.files, ...metadata.adapterFiles }
  const changed = Object.entries(files)
    .filter(([file, expected]) => {
      const target = path.join(root, 'blog', file)
      return !regularFile(root, `blog/${file}`) || hash(readFileSync(target)) !== expected
    })
    .map(([file]) => file)
  if (changed.length) {
    throw new Error(`Astro Cactus files differ from the recorded source and need manual conflict resolution:\n${changed.join('\n')}`)
  }
}

export function recordCurrentCactusRelease(destination) {
  const root = path.resolve(destination)
  const metadata = readMetadata(root)
  verifyManagedFiles(root, metadata)
  const registry = readRegistry(root)
  const catalog = readJson(root, catalogPath)
  const theme = catalog.themes?.['astro-cactus']
  if (!theme || theme.repository !== repository || theme.id !== 'astro-cactus') {
    throw new Error(`Astro Cactus is missing from ${catalogPath}.`)
  }
  const existing = registry.verifiedReleases.find(release => release.ref === metadata.ref)
  if (existing) {
    if (existing.commit !== metadata.commit) throw new Error(`Release tag ${metadata.ref} is already pinned to another commit in ${compatibilityPath}.`)
    if (theme.ref === metadata.ref && theme.commit === metadata.commit) {
      process.stdout.write(`Astro Cactus ${metadata.ref} (${metadata.commit}) is already verified.\n`)
      return false
    }
  }

  if (!existing) {
    writeFileSync(path.join(root, compatibilityPath), `${JSON.stringify({
      ...registry,
      verifiedReleases: [...registry.verifiedReleases, { ref: metadata.ref, commit: metadata.commit }],
    }, null, 2)}\n`)
  }
  writeFileSync(path.join(root, catalogPath), `${JSON.stringify({
    ...catalog,
    themes: {
      ...catalog.themes,
      'astro-cactus': { ...theme, ref: metadata.ref, commit: metadata.commit },
    },
  }, null, 2)}\n`)
  process.stdout.write(`Recorded verified Astro Cactus release ${metadata.ref} (${metadata.commit}).\n`)
  return true
}

export function updateCactusThemeFromSource({ destination, source, sourceRef, proposeRelease = false }) {
  const root = path.resolve(destination)
  const metadata = readMetadata(root)
  if (git(source, ['status', '--porcelain'])) throw new Error('Astro Cactus source must have a clean working tree.')
  if (git(source, ['remote', 'get-url', 'origin']) !== repository) throw new Error('Unexpected Astro Cactus source repository.')
  const sourceCommit = git(source, ['rev-parse', 'HEAD'])
  const registry = readRegistry(root)
  const approved = registry.verifiedReleases.find(release => release.ref === sourceRef)
  if (approved && approved.commit !== sourceCommit) throw new Error(`Release tag ${sourceRef} is already pinned to another commit in ${compatibilityPath}.`)
  if (!approved && !proposeRelease) {
    process.stdout.write(`Skipped ${sourceRef} (${sourceCommit}): this release is not in ${compatibilityPath}.\n`)
    return false
  }
  if (sourceCommit === metadata.commit && sourceRef === metadata.ref) {
    process.stdout.write(`Astro Cactus is already current at ${sourceRef} (${sourceCommit}).\n`)
    return false
  }
  if (git(root, ['status', '--porcelain'])) throw new Error('Template working tree must be clean before a theme update.')
  verifyManagedFiles(root, metadata)

  const knownFiles = Object.keys(metadata.files)
  const tracked = new Set(git(source, ['ls-files', '-z', '--', ...knownFiles.map(file => `:(literal)${file}`)]).split('\0').filter(Boolean))
  const selectedFiles = knownFiles.filter(file => tracked.has(file)).sort()
  const removedFiles = knownFiles.filter(file => !tracked.has(file))
  for (const file of selectedFiles) {
    if (!regularFile(source, file)) throw new Error(`Allowlisted Astro Cactus path is not a regular file: ${file}`)
  }
  const normalizedFiles = new Map(selectedFiles.map(file => [file, normalizedCactusContents(readFileSync(path.join(source, file)), file)]))
  const unchanged = removedFiles.length === 0 && selectedFiles.length === knownFiles.length &&
    selectedFiles.every(file => hash(normalizedFiles.get(file)) === metadata.files[file])
  if (unchanged) {
    process.stdout.write(`No allowlisted Astro Cactus files changed in ${sourceRef} (${sourceCommit}); no update is needed.\n`)
    return false
  }

  for (const file of removedFiles) rmSync(path.join(root, 'blog', file))
  for (const [file, contents] of normalizedFiles) {
    const target = path.join(root, 'blog', file)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, contents)
  }
  const nextMetadata = {
    ...metadata,
    ref: sourceRef,
    commit: sourceCommit,
    files: Object.fromEntries(selectedFiles.map(file => [file, hash(normalizedFiles.get(file))])),
  }
  writeFileSync(path.join(root, metadataPath), `${JSON.stringify(nextMetadata, null, 2)}\n`)
  process.stdout.write(`Updated Astro Cactus files from ${sourceRef} (${sourceCommit}). Review the working tree and commit the changes.\n`)
  return true
}

function parseArguments(args) {
  const options = {}
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]
    if (!['--destination', '--ref', '--commit', '--latest', '--propose', '--record-current'].includes(option)) throw new Error(`Unknown option: ${option}`)
    if (option === '--latest' || option === '--propose' || option === '--record-current') {
      const key = option.slice(2)
      if (options[key]) throw new Error(`Option provided more than once: ${option}`)
      options[key] = true
      continue
    }
    const value = args[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Expected a value after ${option}`)
    const key = option.slice(2)
    if (options[key]) throw new Error(`Option provided more than once: ${option}`)
    options[key] = value
    index += 1
  }
  if (Boolean(options.ref) !== Boolean(options.commit)) throw new Error('Provide both --ref and --commit, or use --latest.')
  if (options.latest && options.ref) throw new Error('--latest cannot be combined with --ref or --commit.')
  if (options.recordCurrent && (options.latest || options.ref || options.commit || options.propose)) throw new Error('--record-current cannot be combined with a source version option.')
  if (options.propose && !options.latest && !options.ref) throw new Error('--propose requires --latest or a version supplied with --ref and --commit.')
  if (options.ref && !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(options.ref)) throw new Error(`Expected a version tag such as v8.3.0: ${options.ref}`)
  if (options.commit && !/^[0-9a-f]{40}$/.test(options.commit)) throw new Error(`Expected a full 40-character commit SHA: ${options.commit}`)
  return options
}

async function latestRelease() {
  const response = await fetch('https://api.github.com/repos/chrismwilliams/astro-theme-cactus/releases/latest', {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'blogkit-template-updater', 'X-GitHub-Api-Version': '2022-11-28' },
  })
  if (!response.ok) throw new Error(`Could not read the latest Astro Cactus release: HTTP ${response.status}`)
  const release = await response.json()
  if (typeof release.tag_name !== 'string') throw new Error('The latest Astro Cactus release has no version tag.')
  return release.tag_name
}

async function run(options) {
  const destination = path.resolve(options.destination ?? process.cwd())
  if (options.recordCurrent) return recordCurrentCactusRelease(destination)
  const sourceRef = options.latest ? await latestRelease() : options.ref
  if (!sourceRef) throw new Error('Choose --latest, --record-current, or provide --ref and --commit.')
  const temporaryDirectory = path.resolve(os.tmpdir(), `blogkit-cactus-${process.pid}`)
  const source = path.join(temporaryDirectory, 'source')
  try {
    rmSync(temporaryDirectory, { recursive: true, force: true })
    mkdirSync(temporaryDirectory, { recursive: true })
    execFileSync('git', ['clone', '--quiet', '--depth', '1', '--branch', sourceRef, repository, source], { stdio: 'inherit' })
    if (options.commit && git(source, ['rev-parse', 'HEAD']) !== options.commit) throw new Error(`Astro Cactus tag ${sourceRef} does not point to ${options.commit}.`)
    updateCactusThemeFromSource({ destination, source, sourceRef, proposeRelease: Boolean(options.propose) })
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await run(parseArguments(process.argv.slice(2)))
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
