import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const importReceiptPath = '.blog/imports/receipt.json'
const supportedExtensions = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.mp3', '.mp4', '.pdf', '.png', '.svg', '.webm', '.webp'])
const knownFields = new Set([
  'author', 'canonicalURL', 'coverImage', 'date', 'description', 'draft',
  'featured', 'hideEditPost', 'heroImage', 'id', 'modDatetime', 'ogImage', 'pinned',
  'pubDatetime', 'pubDate', 'publishDate', 'publishedAt', 'sample', 'slug',
  'tags', 'timezone', 'title', 'updatedDate', 'updatedDatetime',
])

function fail(message) {
  throw new Error(message)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function splitYamlList(value) {
  const values = []
  let current = ''
  let quote = ''
  for (const character of value) {
    if ((character === '"' || character === "'") && (!quote || quote === character)) quote = quote ? '' : character
    if (character === ',' && !quote) {
      values.push(current.trim())
      current = ''
    } else {
      current += character
    }
  }
  if (current.trim()) values.push(current.trim())
  return values
}

function yamlScalar(value) {
  const text = value.trim()
  if (!text) return ''
  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      return JSON.parse(text)
    } catch {
      return text.slice(1, -1)
    }
  }
  if (text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1).replaceAll("''", "'")
  if (text.startsWith('[') && text.endsWith(']')) return splitYamlList(text.slice(1, -1)).map(yamlScalar)
  if (text === 'true') return true
  if (text === 'false') return false
  if (text === 'null' || text === '~') return null
  return text
}

function parseFrontmatter(contents, sourcePath) {
  const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)
  if (!match) return { body: contents, fields: {}, issues: [{ blocking: true, sourcePath, message: 'Markdown frontmatter is missing or unsupported.' }] }
  const lines = match[1].split(/\r?\n/)
  const fields = {}
  const issues = []
  let listField
  let objectField
  for (const line of lines) {
    if (!line.trim() || /^\s*#/.test(line)) continue
    const listItem = line.match(/^\s+-\s+(.+)$/)
    if (listItem && listField) {
      if (!Array.isArray(fields[listField])) fields[listField] = []
      fields[listField].push(yamlScalar(listItem[1]))
      continue
    }
    const nestedField = line.match(/^\s+([A-Za-z][A-Za-z0-9_-]*):(?:\s*(.*))?$/)
    if (nestedField && objectField) {
      fields[objectField][nestedField[1]] = yamlScalar(nestedField[2] ?? '')
      continue
    }
    const field = line.match(/^([A-Za-z][A-Za-z0-9_-]*):(?:\s*(.*))?$/)
    if (!field) {
      issues.push({ blocking: true, sourcePath, message: 'Nested or malformed frontmatter is not supported.' })
      listField = undefined
      objectField = undefined
      continue
    }
    const [, name, rawValue = ''] = field
    if (Object.hasOwn(fields, name)) {
      issues.push({ blocking: true, sourcePath, message: 'Frontmatter field is repeated: ' + name })
      listField = undefined
      objectField = undefined
      continue
    }
    if (rawValue === '|' || rawValue === '>') {
      fields[name] = undefined
      issues.push({ blocking: false, sourcePath, field: name, message: 'Multi-line YAML value will be omitted.' })
      listField = undefined
      objectField = undefined
      continue
    }
    if (!rawValue.trim() && ['coverImage', 'heroImage', 'ogImage'].includes(name)) {
      fields[name] = {}
      objectField = name
      listField = undefined
    } else {
      fields[name] = yamlScalar(rawValue)
      objectField = undefined
      listField = rawValue.trim() ? undefined : name
    }
    if (!knownFields.has(name)) issues.push({ blocking: false, sourcePath, field: name, message: 'Theme-specific field is not copied: ' + name })
  }
  return { body: contents.slice(match[0].length), fields, issues }
}

function findContentDirectories(sourceRoot) {
  const candidates = [
    ['src/content/blog'],
    ['src/content/post'],
    ['src/content/posts'],
    ['blog/src/content/blog'],
    ['blog/src/content/post'],
    ['blog/src/content/posts'],
    ['content/posts', 'content/notes'],
    ['.blog/content/posts'],
  ]
  for (const group of candidates) {
    const directories = group
      .map(candidate => path.join(sourceRoot, candidate))
      .filter(directory => existsSync(directory) && lstatSync(directory).isDirectory())
    if (directories.length) return directories
  }
  if (readdirSync(sourceRoot, { withFileTypes: true }).some(entry => entry.isFile() && /\.md$/i.test(entry.name))) return [sourceRoot]
  fail('No supported Markdown content directory was found. Pass the blog root or its posts directory.')
}

function collectMarkdown(directory, currentDirectory = directory, files = [], skipped = []) {
  for (const entry of readdirSync(currentDirectory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(currentDirectory, entry.name)
    const relativePath = path.relative(directory, absolutePath).split(path.sep).join('/')
    if (entry.isSymbolicLink()) {
      skipped.push({ sourcePath: relativePath, reason: 'symbolic links are not imported' })
    } else if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.')) continue
      collectMarkdown(directory, absolutePath, files, skipped)
    } else if (entry.isFile() && /\.mdx?$/i.test(entry.name)) {
      if (entry.name.startsWith('_')) {
        skipped.push({ sourcePath: relativePath, reason: 'helper and sample files beginning with _ are not imported' })
      } else if (/\.mdx$/i.test(entry.name)) {
        skipped.push({ sourcePath: relativePath, reason: 'MDX uses theme-specific components and needs manual conversion' })
      } else {
        files.push({ absolutePath, relativePath })
      }
    }
  }
  return { files, skipped }
}

function portableAssetName(name) {
  const extension = path.extname(name).toLowerCase()
  const base = path.basename(name, path.extname(name))
    .normalize('NFC')
    .replace(/[^A-Za-z0-9\u0080-\uFFFF_-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '') || 'asset'
  return base + extension
}

function resourcePath(sourceRoot, postAbsolutePath, value) {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const raw = value.trim()
  if (/^(?:https?:|data:|mailto:|tel:|#)/i.test(raw)) return undefined
  const pathPart = raw.split(/[?#]/, 1)[0]
  if (!pathPart || !/\.[A-Za-z0-9]{2,6}$/.test(pathPart)) return undefined
  if (!supportedExtensions.has(path.extname(pathPart).toLowerCase())) return undefined
  let decoded
  try {
    decoded = decodeURIComponent(pathPart)
  } catch {
    return { error: 'Resource path has invalid URL encoding: ' + raw }
  }
  const candidates = decoded.startsWith('/')
    ? [
        path.join(sourceRoot, 'public', decoded.slice(1)),
        path.join(sourceRoot, 'blog/public', decoded.slice(1)),
      ]
    : decoded.startsWith('@/') || decoded.startsWith('~/')
      ? [path.join(sourceRoot, 'src/assets', decoded.slice(2))]
      : [path.resolve(path.dirname(postAbsolutePath), decoded)]
  const candidate = candidates.find(existsSync)
  if (!candidate) return { error: 'Local resource is missing: ' + raw }
  let actualPath
  try {
    if (lstatSync(candidate).isSymbolicLink() || !lstatSync(candidate).isFile()) return { error: 'Local resource is not a regular file: ' + raw }
    actualPath = realpathSync(candidate)
  } catch {
    return { error: 'Local resource cannot be read: ' + raw }
  }
  const relativePath = path.relative(sourceRoot, actualPath)
  if (relativePath === '..' || relativePath.startsWith('..' + path.sep) || path.isAbsolute(relativePath)) {
    return { error: 'Local resource resolves outside the source repository: ' + raw }
  }
  return { absolutePath: actualPath, relativePath: relativePath.split(path.sep).join('/') }
}

function normalizeSlug(value, relativePath) {
  let inferred = path.basename(relativePath, path.extname(relativePath))
  const parentPath = path.dirname(relativePath)
  const indexFile = inferred.toLowerCase() === 'index'
  if (indexFile) inferred = path.basename(parentPath)
  const explicitSlug = typeof value === 'string' && value.trim()
  const slug = explicitSlug ? value.trim() : inferred.replace(/^\d{4}[-_]\d{2}[-_]\d{2}[-_]/, '')
  if (!explicitSlug && parentPath !== '.' && (!indexFile || parentPath.includes(path.sep))) {
    return { slug, error: 'Nested source route needs an explicit single-segment slug: ' + relativePath }
  }
  if (!slug || slug === '.' || slug === '..' || /[\\/?#\u0000-\u001f\s]/.test(slug)) {
    return { slug, error: 'Article slug is not a stable single URL segment: ' + String(slug) }
  }
  return { slug }
}

function visibleDescription(body) {
  const text = body
    .replace(/\x60{3}[\s\S]*?\x60{3}/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[>#*_~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return Array.from(text).slice(0, 180).join('')
}

function isoDate(value) {
  if (value instanceof Date) return Number.isNaN(value.valueOf()) ? undefined : value.toISOString()
  if (typeof value !== 'string' || !value.trim()) return undefined
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString()
}

function getConfig(projectRoot) {
  try {
    return JSON.parse(readFileSync(path.join(projectRoot, '.blog/config.json'), 'utf8'))
  } catch {
    fail('The target blog configuration is missing or invalid. Run the setup workflow first.')
  }
}

function postPlan({ sourceRoot, file, config, assetIndex, slugs, sourceUrl }) {
  const sourcePath = path.relative(sourceRoot, file.absolutePath).split(path.sep).join('/')
  const sourceContents = readFileSync(file.absolutePath, 'utf8')
  const parsed = parseFrontmatter(sourceContents, sourcePath)
  const issues = [...parsed.issues]
  const metadata = parsed.fields
  const knownThemeRepository = sourceUrl === 'https://github.com/chrismwilliams/astro-theme-cactus'
    || sourceUrl === 'https://github.com/satnaing/astro-paper'
  const samplePath = /(?:^|\/)(?:examples?|samples?|testing)(?:\/|$)/i.test(file.relativePath)
  const testTag = Array.isArray(metadata.tags) && metadata.tags.some(tag => typeof tag === 'string' && tag.toLowerCase() === 'test')
  if (metadata.draft === true || metadata.sample === true || knownThemeRepository || samplePath || testTag) {
    const reason = metadata.draft === true
      ? 'marked as a draft'
      : 'recognized as theme sample content'
    return { skipped: { sourcePath, reason } }
  }
  const title = typeof metadata.title === 'string' && metadata.title.trim()
    ? metadata.title.trim()
    : path.basename(sourcePath, path.extname(sourcePath)).replace(/^\d{4}[-_]\d{2}[-_]\d{2}[-_]/, '').replace(/[-_]+/g, ' ')
  if (!(typeof metadata.title === 'string' && metadata.title.trim())) issues.push({ blocking: false, sourcePath, field: 'title', message: 'Title is inferred from the filename.' })
  const publishedAt = isoDate(metadata.pubDatetime ?? metadata.publishDate ?? metadata.publishedAt ?? metadata.pubDate ?? metadata.date)
  if (!publishedAt) issues.push({ blocking: true, sourcePath, field: 'pubDatetime', message: 'A valid publication date is required to preserve the article timeline.' })
  const slugResult = normalizeSlug(metadata.slug, file.relativePath)
  if (slugResult.error) issues.push({ blocking: true, sourcePath, field: 'slug', message: slugResult.error })
  const slug = slugResult.slug
  if (slug && slugs.has(slug)) issues.push({ blocking: true, sourcePath, field: 'slug', message: 'Another article already uses this slug: ' + slug })
  if (slug) slugs.add(slug)
  if (!Array.isArray(metadata.tags) && metadata.tags !== undefined && metadata.tags !== null) {
    if (typeof metadata.tags === 'string') metadata.tags = metadata.tags.split(',').map(tag => tag.trim()).filter(Boolean)
    else issues.push({ blocking: false, sourcePath, field: 'tags', message: 'Unsupported tags format is omitted.' })
  }
  const tags = Array.isArray(metadata.tags) ? metadata.tags.filter(tag => typeof tag === 'string' && tag.trim()).map(tag => tag.trim()) : []
  const identity = sha256(sourcePath).slice(0, 40)
  const destinationPath = '.blog/content/posts/imported-' + identity + '.md'
  const sourceDigest = sha256(sourceContents)
  const references = []
  const addResource = (raw, field) => {
    const result = resourcePath(sourceRoot, file.absolutePath, raw)
    if (!result) return
    if (result.error) {
      issues.push({ blocking: true, sourcePath, field, message: result.error })
      return
    }
    let asset = assetIndex.get(result.relativePath)
    if (!asset) {
      const bytes = readFileSync(result.absolutePath)
      const assetId = sha256(result.relativePath).slice(0, 12)
      const assetPath = '.blog/assets/imported/' + assetId + '-' + portableAssetName(path.basename(result.relativePath))
      asset = { sourcePath: result.relativePath, absolutePath: result.absolutePath, destinationPath: assetPath, sha256: sha256(bytes) }
      assetIndex.set(result.relativePath, asset)
    }
    const suffix = raw.slice(raw.split(/[?#]/, 1)[0].length)
    references.push({ source: raw, destination: '../../assets/' + asset.destinationPath.split('.blog/assets/')[1] + suffix })
  }
  for (const match of parsed.body.matchAll(/(!?\[[^\]]*\]\()(<[^>]+>|[^)\s]+)([^)]*\))/g)) addResource(match[2].replace(/^<|>$/g, ''), 'body')
  for (const match of parsed.body.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) addResource(match[1], 'body')
  const coverField = metadata.ogImage ?? metadata.heroImage ?? metadata.coverImage
  const cover = typeof coverField === 'string' ? coverField : coverField?.src
  if (coverField !== undefined && coverField !== null) {
    if (typeof cover !== 'string') {
      issues.push({ blocking: true, sourcePath, field: 'heroImage', message: 'Object-based cover image references need a string src value.' })
    } else {
      addResource(cover, 'heroImage')
    }
  }
  const article = {
    author: typeof metadata.author === 'string' && metadata.author.trim() ? metadata.author.trim() : config.site.author,
    canonicalURL: typeof metadata.canonicalURL === 'string' ? metadata.canonicalURL : undefined,
    description: typeof metadata.description === 'string' && metadata.description.trim() ? metadata.description.trim() : visibleDescription(parsed.body),
    featured: metadata.featured === true || metadata.pinned === true,
    hideEditPost: metadata.hideEditPost === true,
    identity: { kind: 'imported', id: identity },
    modDatetime: isoDate(metadata.modDatetime ?? metadata.updatedDatetime ?? metadata.updatedDate),
    ogImage: typeof cover === 'string' ? references.find(item => item.source === cover)?.destination ?? cover : undefined,
    pubDatetime: publishedAt,
    slug,
    sourceDigest,
    sourcePath,
    tags,
    title,
    timezone: typeof metadata.timezone === 'string' && metadata.timezone.trim() ? metadata.timezone.trim() : config.site.timezone,
    body: parsed.body,
    references,
    destinationPath,
    issues,
  }
  if (metadata.modDatetime || metadata.updatedDatetime || metadata.updatedDate) {
    if (!article.modDatetime) issues.push({ blocking: false, sourcePath, field: 'modDatetime', message: 'Invalid modification date was omitted.' })
  }
  if (metadata.canonicalURL !== undefined && typeof metadata.canonicalURL !== 'string') {
    issues.push({ blocking: false, sourcePath, field: 'canonicalURL', message: 'Unsupported canonical URL value was omitted.' })
    article.canonicalURL = undefined
  }
  if (metadata.hideEditPost !== undefined && typeof metadata.hideEditPost !== 'boolean') {
    issues.push({ blocking: false, sourcePath, field: 'hideEditPost', message: 'Unsupported edit-post setting was omitted.' })
    article.hideEditPost = false
  }
  if (metadata.featured !== undefined && typeof metadata.featured !== 'boolean') {
    issues.push({ blocking: false, sourcePath, field: 'featured', message: 'Unsupported featured value was treated as false.' })
    article.featured = false
  }
  return { article, issues }
}

function currentSlugs(projectRoot) {
  const directory = path.join(projectRoot, '.blog/content/posts')
  const slugs = new Set()
  if (!existsSync(directory)) return slugs
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.md$/i.test(entry.name)) continue
    const match = readFileSync(path.join(directory, entry.name), 'utf8').match(/^slug:\s*(.+)$/m)
    if (match) slugs.add(String(yamlScalar(match[1])))
  }
  return slugs
}

function publicArticle(article) {
  return {
    author: article.author,
    canonicalURL: article.canonicalURL,
    description: article.description,
    destinationPath: article.destinationPath,
    featured: article.featured,
    hideEditPost: article.hideEditPost,
    identity: article.identity,
    issues: article.issues,
    modDatetime: article.modDatetime,
    ogImage: article.ogImage,
    pubDatetime: article.pubDatetime,
    references: article.references,
    slug: article.slug,
    sourceDigest: article.sourceDigest,
    sourcePath: article.sourcePath,
    tags: article.tags,
    title: article.title,
    timezone: article.timezone,
  }
}

export function createBlogImportPlan({ sourceRoot, projectRoot = process.cwd(), sourceUrl, sourceCommit } = {}) {
  const root = realpathSync(path.resolve(sourceRoot))
  const target = path.resolve(projectRoot)
  const config = getConfig(target)
  const contentDirectories = findContentDirectories(root)
  const files = []
  const skipped = []
  for (const directory of contentDirectories) {
    const collected = collectMarkdown(directory)
    files.push(...collected.files)
    skipped.push(...collected.skipped)
  }
  const assetIndex = new Map()
  const slugs = currentSlugs(target)
  const posts = []
  const unsupported = []
  const conflicts = []
  for (const file of files) {
    const planned = postPlan({ sourceRoot: root, file, config, assetIndex, slugs, sourceUrl })
    if (planned.skipped) {
      skipped.push(planned.skipped)
      continue
    }
    posts.push(publicArticle(planned.article))
    unsupported.push(...planned.issues)
    conflicts.push(...planned.issues
      .filter(issue => issue.blocking)
      .map(issue => issue.sourcePath + ': ' + issue.message))
    if (existsSync(path.join(target, planned.article.destinationPath))) {
      conflicts.push('Target article already exists: ' + planned.article.destinationPath)
    }
  }
  const assets = [...assetIndex.values()].map(asset => ({
    sourcePath: asset.sourcePath,
    destinationPath: asset.destinationPath,
    sha256: asset.sha256,
  })).sort((left, right) => left.sourcePath.localeCompare(right.sourcePath))
  for (const asset of assets) {
    if (existsSync(path.join(target, asset.destinationPath))) conflicts.push('Target resource already exists: ' + asset.destinationPath)
  }
  if (existsSync(path.join(target, importReceiptPath))) conflicts.push('This blog has already imported content once.')
  if (!posts.length) conflicts.push('No importable Markdown articles were found.')
  const source = {
    repository: sourceUrl ?? null,
    commit: sourceCommit ?? null,
    contentDirectory: contentDirectories.map(directory => path.relative(root, directory).split(path.sep).join('/')).join(', '),
    targetCommit: (() => {
      try {
        return git(target, ['rev-parse', 'HEAD'])
      } catch {
        return null
      }
    })(),
    configurationSha256: sha256(readFileSync(path.join(target, '.blog/config.json'))),
  }
  const planData = { schemaVersion: 1, source, posts, assets, skipped, unsupported, conflicts }
  const planSha256 = sha256(JSON.stringify(planData))
  const blockingIssues = unsupported.some(issue => issue.blocking)
  return { ...planData, planSha256, canApply: !blockingIssues && conflicts.length === 0 }
}

function articleMarkdown(article) {
  const fields = [
    'identity: ' + JSON.stringify(article.identity),
    'slug: ' + JSON.stringify(article.slug),
    'author: ' + JSON.stringify(article.author),
    'pubDatetime: ' + article.pubDatetime,
    'timezone: ' + JSON.stringify(article.timezone),
    'title: ' + JSON.stringify(article.title),
    'description: ' + JSON.stringify(article.description),
    'tags: ' + JSON.stringify(article.tags),
    'featured: ' + String(article.featured),
  ]
  if (article.modDatetime) fields.splice(4, 0, 'modDatetime: ' + article.modDatetime)
  if (article.ogImage) fields.push('ogImage: ' + JSON.stringify(article.ogImage))
  if (article.canonicalURL) fields.push('canonicalURL: ' + JSON.stringify(article.canonicalURL))
  if (article.hideEditPost) fields.push('hideEditPost: true')
  const rewrittenBody = article.references.reduce(
    (body, reference) => body.split(reference.source).join(reference.destination),
    article.body,
  )
  return '---\n' + fields.join('\n') + '\n---\n\n' + rewrittenBody.trimEnd() + '\n'
}

function writePreviewSummary(plan, env = process.env, stdout = process.stdout) {
  const lines = [
    '# One-time content import preview',
    '',
    '- Plan SHA-256: ' + plan.planSha256,
    '- Source: ' + (plan.source.repository ?? plan.source.contentDirectory),
    '- Articles to add: ' + plan.posts.length,
    '- Resources to add: ' + plan.assets.length,
    '- Can apply: ' + (plan.canApply ? 'yes' : 'no'),
    '',
  ]
  if (plan.posts.length) {
    lines.push('## Article changes', '')
    for (const post of plan.posts) lines.push('- ' + post.destinationPath + ' — ' + post.title + ' (' + post.slug + ')')
    lines.push('')
  }
  if (plan.assets.length) {
    lines.push('## Resource changes', '')
    for (const asset of plan.assets) lines.push('- ' + asset.destinationPath + ' from ' + asset.sourcePath)
    lines.push('')
  }
  if (plan.skipped.length) {
    lines.push('## Skipped', '')
    for (const item of plan.skipped) lines.push('- ' + item.sourcePath + ': ' + item.reason)
    lines.push('')
  }
  if (plan.unsupported.length) {
    lines.push('## Unsupported fields or content', '')
    for (const item of plan.unsupported) lines.push('- ' + item.sourcePath + (item.field ? ' (' + item.field + ')' : '') + ': ' + item.message)
    lines.push('')
  }
  if (plan.conflicts.length) {
    lines.push('## Conflicts', '')
    for (const conflict of plan.conflicts) lines.push('- ' + conflict)
    lines.push('')
  }
  const summary = lines.join('\n')
  stdout.write(summary + '\n')
  if (env.GITHUB_STEP_SUMMARY) writeFileSync(env.GITHUB_STEP_SUMMARY, summary + '\n', { flag: 'a' })
  if (env.GITHUB_OUTPUT) writeFileSync(env.GITHUB_OUTPUT, 'plan_sha256=' + plan.planSha256 + '\n', { flag: 'a' })
}

export function applyBlogImport({ sourceRoot, projectRoot = process.cwd(), expectedPlanSha256, sourceUrl, sourceCommit } = {}) {
  const plan = createBlogImportPlan({ sourceRoot, projectRoot, sourceUrl, sourceCommit })
  if (plan.planSha256 !== expectedPlanSha256) fail('The source or target changed since preview. Create a new preview and review it before applying.')
  if (!plan.canApply) fail('The reviewed import plan has blocking conflicts or unsupported content. Resolve them before applying.')
  const root = realpathSync(path.resolve(sourceRoot))
  const contentDirectories = findContentDirectories(root)
  const target = path.resolve(projectRoot)
  const files = new Map(contentDirectories.flatMap(directory => collectMarkdown(directory).files).map(file => [path.relative(root, file.absolutePath).split(path.sep).join('/'), file]))
  const created = []
  try {
    for (const post of plan.posts) {
      const sourceFile = files.get(post.sourcePath)
      const parsed = parseFrontmatter(readFileSync(sourceFile.absolutePath, 'utf8'), post.sourcePath)
      const outputPath = path.join(target, post.destinationPath)
      mkdirSync(path.dirname(outputPath), { recursive: true })
      writeFileSync(outputPath, articleMarkdown({ ...post, body: parsed.body }), { flag: 'wx' })
      created.push(outputPath)
    }
    for (const asset of plan.assets) {
      const sourceFile = path.join(root, asset.sourcePath)
      const outputPath = path.join(target, asset.destinationPath)
      mkdirSync(path.dirname(outputPath), { recursive: true })
      copyFileSync(sourceFile, outputPath, 0)
      created.push(outputPath)
    }
    const receiptPath = path.join(target, importReceiptPath)
    mkdirSync(path.dirname(receiptPath), { recursive: true })
    writeFileSync(receiptPath, JSON.stringify({
      schemaVersion: 1,
      planSha256: plan.planSha256,
      source: plan.source,
      articles: plan.posts.map(post => ({ sourcePath: post.sourcePath, destinationPath: post.destinationPath, slug: post.slug, sourceSha256: post.sourceDigest })),
      resources: plan.assets,
      importedAt: new Date().toISOString(),
    }, null, 2) + '\n', { flag: 'wx' })
    created.push(receiptPath)
  } catch (error) {
    for (const file of created.reverse()) rmSync(file, { force: true })
    throw error
  }
  return { importedPosts: plan.posts.length, importedAssets: plan.assets.length, planSha256: plan.planSha256 }
}

function git(directory, args) {
  return execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function validateSourceUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    fail('Enter a public GitHub repository URL.')
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.username || url.password || url.search || url.hash) {
    fail('The source must be a public https://github.com/OWNER/REPOSITORY URL.')
  }
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length !== 2 || !/^[A-Za-z0-9_.-]+$/.test(parts[0]) || !/^[A-Za-z0-9_.-]+(?:\.git)?$/.test(parts[1])) {
    fail('The source URL must point directly to a GitHub repository.')
  }
  const repository = parts[1].replace(/\.git$/i, '')
  if (!repository) fail('The source URL must include a repository name.')
  return { repository: 'https://github.com/' + parts[0] + '/' + repository, cloneUrl: url.href.replace(/\/$/, '') }
}

function validateSubdirectory(value) {
  if (!value) return ''
  const segments = value.split('/')
  if (path.isAbsolute(value) || value.includes('\\') || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    fail('The source subdirectory must be a safe path relative to the repository root.')
  }
  return value
}

function parseArguments(args) {
  const options = {}
  const valueOptions = new Set(['--source', '--source-url', '--subdirectory', '--ref', '--project-root', '--expected-plan-sha'])
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index]
    if (name === '--preview' || name === '--apply') {
      if (options.preview || options.apply) fail('Choose either --preview or --apply.')
      options[name.slice(2)] = true
    } else if (valueOptions.has(name)) {
      const value = args[index + 1]
      if (!value || value.startsWith('--')) fail('Expected a value after ' + name)
      if (options[name]) fail('Option provided more than once: ' + name)
      options[name] = value
      index += 1
    } else {
      fail('Unknown option: ' + name)
    }
  }
  if (!options.preview && !options.apply) fail('Choose --preview or --apply.')
  if (Boolean(options['--source']) === Boolean(options['--source-url'])) fail('Provide exactly one of --source or --source-url.')
  if (options.apply && !/^[0-9a-f]{64}$/.test(options['--expected-plan-sha'] ?? '')) fail('--apply requires the 64-character --expected-plan-sha from a reviewed preview.')
  if (options['--ref'] && !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(options['--ref'])) fail('The source ref contains unsupported characters.')
  options.subdirectory = validateSubdirectory(options['--subdirectory'])
  return options
}

function runCli(args) {
  const options = parseArguments(args)
  const projectRoot = path.resolve(options['--project-root'] ?? process.cwd())
  let sourceRoot
  let temporaryDirectory
  let sourceUrl
  let sourceCommit
  try {
    if (options['--source-url']) {
      const validated = validateSourceUrl(options['--source-url'])
      sourceUrl = validated.repository
      temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'blogkit-import-'))
      const checkout = path.join(temporaryDirectory, 'source')
      const command = ['clone', '--quiet', '--depth', '1']
      if (options['--ref']) command.push('--branch', options['--ref'])
      command.push(validated.cloneUrl, checkout)
      execFileSync('git', command, { stdio: 'inherit' })
      sourceCommit = git(checkout, ['rev-parse', 'HEAD'])
      sourceRoot = path.resolve(checkout, options.subdirectory)
      if (!sourceRoot.startsWith(checkout + path.sep) && sourceRoot !== checkout) fail('The source subdirectory resolves outside the checkout.')
    } else {
      sourceRoot = path.resolve(options['--source'])
    }
    if (!existsSync(sourceRoot) || !lstatSync(sourceRoot).isDirectory()) fail('The selected source directory does not exist.')
    const plan = createBlogImportPlan({ sourceRoot, projectRoot, sourceUrl, sourceCommit })
    if (options.preview) {
      writePreviewSummary(plan)
      if (!plan.canApply) process.stderr.write('This plan cannot be applied until blocking items are resolved.\n')
      return
    }
    writePreviewSummary(plan)
    const result = applyBlogImport({
      sourceRoot,
      projectRoot,
      sourceUrl,
      sourceCommit,
      expectedPlanSha256: options['--expected-plan-sha'],
    })
    process.stdout.write('Import receipt recorded with plan ' + result.planSha256 + '.\n')
  } finally {
    if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(error.message + '\n')
    process.exitCode = 1
  }
}
