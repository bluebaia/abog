import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizedCactusContents } from './cactus-adapter.mjs'
import { validateBlogConfiguration } from './blog-config.mjs'
import { normalizedThemeContents } from './update-blog-template.mjs'

const themeSourceMetadataPath = '.template/theme-source.json'
const themeCatalogPath = '.template/theme-catalog.json'

function git(directory, args) {
  return execFileSync('git', ['-C', directory, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function sha256(contents) {
  const canonical = contents.includes(0)
    ? contents
    : Buffer.from(contents.toString('utf8').replace(/\r\n/g, '\n'))
  return createHash('sha256').update(canonical).digest('hex')
}

function safeRelativePath(value) {
  return typeof value === 'string' &&
    !path.isAbsolute(value) &&
    !value.includes('\\') &&
    value.split('/').every(part => part && part !== '.' && part !== '..' && !part.includes(':'))
}

function isRegularFile(root, relativePath) {
  let current = root
  for (const [index, segment] of relativePath.split('/').entries()) {
    current = path.join(current, segment)
    let info
    try {
      info = lstatSync(current)
    } catch (error) {
      if (error.code === 'ENOENT') return false
      throw error
    }
    if (index === relativePath.split('/').length - 1 ? !info.isFile() : !info.isDirectory()) return false
  }
  return true
}

function readJson(projectRoot, relativePath) {
  return JSON.parse(readFileSync(path.join(projectRoot, relativePath), 'utf8'))
}

function readArguments(args) {
  const options = {}
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]
    if (!['--theme', '--project-root', '--source'].includes(option)) throw new Error(`Unknown option: ${option}`)
    const value = args[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Expected a value after ${option}`)
    const key = option.slice(2)
    if (options[key]) throw new Error(`Option provided more than once: ${option}`)
    options[key] = value
    index += 1
  }
  if (!options.theme) throw new Error('Usage: node scripts/switch-blog-theme.mjs --theme <astro-paper|astro-cactus>')
  return { ...options, projectRoot: path.resolve(options.projectRoot ?? process.cwd()) }
}

function themeFilesFromSource(source, manifest) {
  if (git(source, ['status', '--porcelain'])) throw new Error('Theme source must have a clean working tree.')
  const tracked = new Set(git(source, ['ls-files', '-z']).split('\0').filter(Boolean))
  const missing = manifest.filter(file => !tracked.has(file))
  if (missing.length) throw new Error(`Theme source is missing allowlisted files: ${missing.join(', ')}`)
  for (const file of manifest) {
    if (!isRegularFile(source, file)) throw new Error(`Allowlisted theme path is not a regular file: ${file}`)
  }
  return manifest
}

function adapterFilesFor(themeId) {
  if (themeId === 'astro-paper') {
    return new Map([['astro-paper.config.ts', Buffer.from(`import { defineAstroPaperConfig } from "./src/types/config";
import config from "../.blog/config.json";
import { resolveBlogConfiguration } from "../scripts/blog-config.mjs";

const resolved = resolveBlogConfiguration(config);
export const blogDeployment = resolved.deployment;
export const blogHome = resolved.themeConfig.home;
export default defineAstroPaperConfig(resolved.themeConfig);
`)]])
  }
  if (themeId === 'astro-cactus') {
    return new Map([
      ['src/utils/blog-template.ts', normalizedCactusContents(Buffer.from(''), 'src/utils/blog-template.ts')],
      ['content/notes/.gitkeep', Buffer.alloc(0)],
      ['content/tags/.gitkeep', Buffer.alloc(0)],
    ])
  }
  throw new Error(`Unsupported theme adapter: ${themeId}`)
}

function validateSourceMetadata(projectRoot, activeTheme, metadata, catalog) {
  const recorded = { ...metadata.files, ...(metadata.adapterFiles ?? {}) }
  const expectedPaths = [...Object.keys(metadata.files), ...Object.keys(metadata.adapterFiles ?? {})]
  if (
    metadata.formatVersion !== 1 ||
    metadata.theme !== activeTheme ||
    metadata.repository !== catalog.repository ||
    metadata.commit !== catalog.commit ||
    metadata.ref !== catalog.ref ||
    !metadata.files ||
    typeof metadata.files !== 'object' ||
    Array.isArray(metadata.files) ||
    !metadata.adapterFiles ||
    typeof metadata.adapterFiles !== 'object' ||
    Array.isArray(metadata.adapterFiles) ||
    Object.keys(metadata.files).some(file => !safeRelativePath(file)) ||
    Object.keys(metadata.adapterFiles).some(file => !safeRelativePath(file)) ||
    Object.values(recorded).some(hash => !/^[0-9a-f]{64}$/.test(hash))
  ) {
    throw new Error(`Active theme metadata is invalid: ${themeSourceMetadataPath}`)
  }
  const changed = expectedPaths.filter(file => {
    const fullPath = path.join(projectRoot, 'blog', file)
    return !isRegularFile(projectRoot, `blog/${file}`) || sha256(readFileSync(fullPath)) !== recorded[file]
  })
  if (changed.length) {
    throw new Error(`Active theme files differ from their recorded source and cannot be switched safely:\n${changed.join('\n')}`)
  }
}

async function sourceCheckout(theme, suppliedSource) {
  if (suppliedSource) {
    const source = path.resolve(suppliedSource)
    if (git(source, ['remote', 'get-url', 'origin']) !== theme.repository) throw new Error(`Unexpected theme source repository for ${theme.id}.`)
    return { source, temporaryDirectory: undefined }
  }

  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'blogkit-theme-'))
  const source = path.join(temporaryDirectory, theme.id)
  try {
    execFileSync('git', ['clone', '--quiet', '--depth', '1', '--branch', theme.ref, theme.repository, source], { stdio: 'inherit' })
    const commit = git(source, ['rev-parse', 'HEAD'])
    if (commit !== theme.commit) throw new Error(`Theme tag ${theme.ref} resolved to ${commit}, expected ${theme.commit}.`)
    return { source, temporaryDirectory }
  } catch (error) {
    rmSync(temporaryDirectory, { recursive: true, force: true })
    throw error
  }
}

export async function switchBlogTheme({ projectRoot = process.cwd(), themeId, sourceDirectory } = {}) {
  const root = path.resolve(projectRoot)
  const currentConfig = readJson(root, '.blog/config.json')
  const config = structuredClone(currentConfig)
  config.theme.id = themeId
  const configErrors = validateBlogConfiguration(config)
  if (configErrors.length) throw new Error(configErrors.map(error => `${error.path}: ${error.message}`).join('\n'))

  const catalog = readJson(root, themeCatalogPath)
  const theme = catalog.themes?.[themeId]
  if (
    catalog.schemaVersion !== 1 ||
    !theme ||
    theme.id !== themeId ||
    !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(theme.ref) ||
    !/^[0-9a-f]{40}$/.test(theme.commit) ||
    !safeRelativePath(theme.fileManifest)
  ) {
    throw new Error(`The requested theme is not in the verified theme catalog: ${themeId}`)
  }

  const metadata = readJson(root, themeSourceMetadataPath)
  const activeThemeId = metadata.theme
  const activeTheme = catalog.themes?.[activeThemeId]
  if (!activeTheme) throw new Error(`The active theme is missing from ${themeCatalogPath}.`)
  validateSourceMetadata(root, activeThemeId, metadata, activeTheme)
  if (activeThemeId === themeId && metadata.ref === theme.ref && metadata.commit === theme.commit) return false

  if (git(root, ['status', '--porcelain', '--', 'blog'])) {
    throw new Error('Save or revert edits under blog/ before switching themes.')
  }

  const manifest = readJson(root, theme.fileManifest)
  if (
    !Array.isArray(manifest) ||
    manifest.length === 0 ||
    manifest.some(file => !safeRelativePath(file)) ||
    new Set(manifest).size !== manifest.length
  ) {
    throw new Error(`The theme file manifest is invalid: ${theme.fileManifest}`)
  }

  const checkout = await sourceCheckout(theme, sourceDirectory)
  const stageName = `.template/theme-stage-${process.pid}`
  const stageRoot = path.join(root, stageName)
  const backupRoot = `${path.join(root, 'blog')}.previous-${process.pid}`
  const blogRoot = path.join(root, 'blog')
  try {
    if (git(checkout.source, ['rev-parse', 'HEAD']) !== theme.commit) throw new Error(`Theme source does not match the verified commit ${theme.commit}.`)
    const selectedFiles = themeFilesFromSource(checkout.source, manifest)
    const outputFiles = new Map(selectedFiles.map(file => [file, themeId === 'astro-cactus'
      ? normalizedCactusContents(readFileSync(path.join(checkout.source, file)), file)
      : normalizedThemeContents(readFileSync(path.join(checkout.source, file)), file)]))
    const adapterFiles = adapterFilesFor(themeId)
    for (const [file, contents] of adapterFiles) outputFiles.set(file, contents)
    rmSync(stageRoot, { recursive: true, force: true })
    mkdirSync(stageRoot, { recursive: true })
    for (const [file, contents] of outputFiles) {
      if (!safeRelativePath(file)) throw new Error(`Adapter generated an unsafe path: ${file}`)
      const destination = path.join(stageRoot, file)
      mkdirSync(path.dirname(destination), { recursive: true })
      writeFileSync(destination, contents)
    }

    const files = Object.fromEntries(selectedFiles.map(file => [file, sha256(outputFiles.get(file))]))
    const adapterFileHashes = Object.fromEntries([...adapterFiles].map(([file, contents]) => [file, sha256(contents)]))
    const nextMetadata = {
      formatVersion: 1,
      theme: themeId,
      repository: theme.repository,
      ref: theme.ref,
      commit: theme.commit,
      files,
      adapterFiles: adapterFileHashes,
    }
    const oldMetadataPath = path.join(root, themeSourceMetadataPath)
    const oldConfigContents = readFileSync(path.join(root, '.blog/config.json'))
    const configContents = Buffer.from(`${JSON.stringify(config, null, 2)}\n`)
    const backupConfig = `${oldConfigContents}`
    const backupMetadata = readFileSync(oldMetadataPath)
    rmSync(backupRoot, { recursive: true, force: true })
    renameSync(blogRoot, backupRoot)
    try {
      renameSync(stageRoot, blogRoot)
      writeFileSync(path.join(root, '.blog/config.json'), configContents)
      writeFileSync(oldMetadataPath, `${JSON.stringify(nextMetadata, null, 2)}\n`)
    } catch (error) {
      rmSync(blogRoot, { recursive: true, force: true })
      renameSync(backupRoot, blogRoot)
      writeFileSync(path.join(root, '.blog/config.json'), backupConfig)
      writeFileSync(oldMetadataPath, backupMetadata)
      throw error
    }
    rmSync(backupRoot, { recursive: true, force: true })
  } finally {
    rmSync(stageRoot, { recursive: true, force: true })
    if (checkout.temporaryDirectory) rmSync(checkout.temporaryDirectory, { recursive: true, force: true })
  }
  return true
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = readArguments(process.argv.slice(2))
    const changed = await switchBlogTheme({
      projectRoot: options.projectRoot,
      themeId: options.theme,
      sourceDirectory: options.source,
    })
    process.stdout.write(changed ? `Prepared ${options.theme} from its pinned source.\n` : `${options.theme} is already active at its pinned source.\n`)
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
